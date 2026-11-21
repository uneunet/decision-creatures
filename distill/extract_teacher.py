#!/usr/bin/env python3
"""Step 2: Extract frozen `vision_encoder_q8` features + teacher `d1-2B` soft probabilities.

Uses the lossless 490-vocab pruned `decoder_q4f16_pruned.onnx` (verified 0.0000 diff vs
official `decoder_q4f16.onnx`) when available, falling back to official `decoder_q4f16.onnx`.

Outputs (all under `.cache/distill/`, git-ignored):
  - `.cache/distill/dataset/<id>.npz`  (features: float16 [N, 2048], probs: float32 [60])
  - `.cache/distill/val12.npz`         (held-out 12 experiment images, never used in training)

Fully resumable: already-extracted `.npz` files are skipped.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

MANIFEST_PATH = Path(".cache/distill/images_manifest.json")
DATASET_DIR = Path(".cache/distill/dataset")
VAL12_PATH = Path(".cache/distill/val12.npz")
EXP_IMG_DIR = Path(".cache/experiment-images")

OFFICIAL_PLAN_PATH = Path("src/inference/prompt-plan.json")
PRUNED_PLAN_PATH = Path(".cache/quantized/prompt-plan-pruned.json")
PRUNED_DECODER_PATH = Path(".cache/quantized/pruned_only/decoder_q4f16_pruned.onnx")


def smart_resize(h: int, w: int, factor: int = 32, min_px: int = 65_536, max_px: int = 262_144) -> tuple[int, int]:
    hb = max(factor, round(h / factor) * factor)
    wb = max(factor, round(w / factor) * factor)
    if hb * wb > max_px:
        beta = math.sqrt((h * w) / max_px)
        hb = max(factor, math.floor(h / beta / factor) * factor)
        wb = max(factor, math.floor(w / beta / factor) * factor)
    elif hb * wb < min_px:
        beta = math.sqrt(min_px / (h * w))
        hb = math.ceil(h * beta / factor) * factor
        wb = math.ceil(w * beta / factor) * factor
    return hb, wb


def preprocess_image(path: Path, max_px: int = 262_144) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    w, h = img.size
    rh, rw = smart_resize(h, w, max_px=max_px)
    img = img.resize((rw, rh), Image.Resampling.BICUBIC)
    arr = np.asarray(img, dtype=np.float32) * (2.0 / 255.0) - 1.0
    arr = np.transpose(arr, (2, 0, 1))
    gh, gw = rh // 32, rw // 32
    patches = arr.reshape(3, gh, 2, 16, gw, 2, 16).transpose(1, 4, 2, 5, 0, 3, 6)
    patches = np.repeat(patches[:, :, :, :, :, None, :, :], 2, axis=5)
    return np.ascontiguousarray(patches.reshape(gh, gw, 2, 2, 1536).astype(np.float32))


def readout_soft_probs(plan: dict[str, Any], logits: np.ndarray) -> np.ndarray:
    """Return concatenated 60-dim calibrated probability vector across all 11 questions."""
    parts: list[float] = []
    for i, q in enumerate(plan["questions"]):
        row = logits[i]
        t = q["temperature"] or 1.0
        scores = [max(float(row[tid]) for tid in forms) / t for forms in q["readoutIds"]]
        m = max(scores)
        exps = [math.exp(s - m) for s in scores]
        tot = sum(exps)
        parts.extend(e / tot for e in exps)
    return np.asarray(parts, dtype=np.float32)


def run_teacher_one(
    vis_sess: Any,
    dec_sess: Any,
    plan: dict[str, Any],
    img_path: Path,
    max_px: int,
) -> tuple[np.ndarray, np.ndarray]:
    pv = preprocess_image(img_path, max_px=max_px)
    num_img = pv.shape[0] * pv.shape[1]
    (feats,) = vis_sess.run(["image_features"], {"pixel_values": pv})
    feats_f32 = feats.astype(np.float32)

    state_ids = plan["prefixBeforeImage"] + [plan["imageTokenId"]] * num_img + plan["prefixAfterImage"]
    state_len = len(state_ids)
    full_ids = state_ids + plan["suffixIds"]
    seq_len = len(full_ids)
    q_ids = [-1] * state_len + plan["suffixQuestionIds"]
    slots = [state_len + off for off in plan["slotOffsets"]]

    (logits,) = dec_sess.run(
        ["logits"],
        {
            "input_ids": np.array([full_ids], dtype=np.int64),
            "attention_mask": np.ones((1, seq_len), dtype=np.int64),
            "position_ids": np.arange(seq_len, dtype=np.int64)[None, :],
            "image_features": feats_f32,
            "video_features": np.zeros((0, plan["hiddenSize"]), dtype=np.float32),
            "question_ids": np.array([q_ids], dtype=np.int64),
            "slot_positions": np.array(slots, dtype=np.int64),
        },
    )
    probs = readout_soft_probs(plan, logits)
    return feats_f32.astype(np.float16), probs


def load_teacher_sessions() -> tuple[Any, Any, dict[str, Any]]:
    import onnxruntime as ort

    official_plan = json.loads(OFFICIAL_PLAN_PATH.read_text())
    cache_onnx = Path(".cache/d1-2B-ONNX") / official_plan["revision"] / "onnx"
    vis_path = cache_onnx / "vision_encoder_q8.onnx"

    if PRUNED_DECODER_PATH.exists() and PRUNED_PLAN_PATH.exists():
        dec_path = PRUNED_DECODER_PATH
        plan = json.loads(PRUNED_PLAN_PATH.read_text())
        print(f"Teacher decoder: {dec_path} (lossless 490-vocab pruned)")
    else:
        dec_path = cache_onnx / "decoder_q4f16.onnx"
        plan = official_plan
        print(f"Teacher decoder: {dec_path} (official)")

    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    n_threads = os.cpu_count() or 8
    opts.intra_op_num_threads = n_threads
    opts.inter_op_num_threads = 1

    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    vis_sess = ort.InferenceSession(str(vis_path), sess_options=opts, providers=providers)
    dec_sess = ort.InferenceSession(str(dec_path), sess_options=opts, providers=providers)
    print(f"ORT active providers: vision={vis_sess.get_providers()[0]}, decoder={dec_sess.get_providers()[0]} (threads={n_threads})")
    return vis_sess, dec_sess, plan


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Max images to extract (0 = all in manifest)")
    parser.add_argument("--max-pixels", type=int, default=262_144, help="Vision max pixels (default 262144)")
    parser.add_argument("--val12-only", action="store_true", help="Only extract held-out 12 experiment images")
    args = parser.parse_args()

    vis_sess, dec_sess, plan = load_teacher_sessions()
    DATASET_DIR.mkdir(parents=True, exist_ok=True)

    # Always ensure held-out 12 experiment images are extracted at matching max_pixels
    if not VAL12_PATH.exists():
        print(f"\nExtracting held-out 12 experiment images -> {VAL12_PATH}...")
        exp_paths = sorted(EXP_IMG_DIR.glob("*.jpg"))
        val_dict: dict[str, Any] = {"names": np.array([p.name for p in exp_paths])}
        for idx, p in enumerate(exp_paths):
            feats_fp16, probs = run_teacher_one(vis_sess, dec_sess, plan, p, args.max_pixels)
            val_dict[f"f_{idx}"] = feats_fp16
            val_dict[f"p_{idx}"] = probs
        np.savez_compressed(VAL12_PATH, **val_dict)
        print(f"  Saved {len(exp_paths)} held-out images to {VAL12_PATH}")

    if args.val12_only:
        return

    manifest = json.loads(MANIFEST_PATH.read_text())
    if args.limit > 0:
        manifest = manifest[: args.limit]

    todo = [e for e in manifest if not (DATASET_DIR / f"{e['id']}.npz").exists()]
    done_before = len(manifest) - len(todo)
    print(f"\nDataset extraction: {done_before} cached, {len(todo)} remaining (total {len(manifest)})")

    t0 = time.perf_counter()
    extracted = 0
    failed = 0
    for idx, entry in enumerate(todo, start=1):
        out_file = DATASET_DIR / f"{entry['id']}.npz"
        try:
            feats_fp16, probs = run_teacher_one(vis_sess, dec_sess, plan, Path(entry["path"]), args.max_pixels)
            np.savez(
                out_file,
                features=feats_fp16,
                probs=probs,
                source=np.array(entry["source"]),
                image_id=np.array(entry["id"]),
            )
            extracted += 1
        except Exception as err:
            failed += 1
            print(f"  [warn] failed {entry['id']}: {err}")

        if idx % 10 == 0 or idx == len(todo):
            elapsed = time.perf_counter() - t0
            rate = idx / max(elapsed, 1e-6)
            eta_min = (len(todo) - idx) / max(rate, 1e-6) / 60.0
            print(
                f"  [{done_before + idx:4d}/{len(manifest)}] "
                f"rate={rate:.2f} img/s ({1/max(rate,1e-6):.2f}s/img) | "
                f"elapsed={elapsed/60:.1f}m | ETA={eta_min:.1f}m | fail={failed}",
                flush=True,
            )

    print(f"\nExtraction finished: +{extracted} new ({done_before + extracted} total), failed={failed}")


if __name__ == "__main__":
    main()
