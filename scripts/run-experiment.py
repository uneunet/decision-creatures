#!/usr/bin/env python3
"""Verify finalized v1 11-question S-rank prompt plan + derived HP/DEF/Rarity on LiquidAI/d1-2B-ONNX."""

from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
from PIL import Image

PLAN_PATH = Path("src/inference/prompt-plan.json")
IMG_DIR = Path(".cache/experiment-images")
REPORT_PATH = Path(".cache/experiment-v1-results.json")

SUBSTANCE_HARDNESS = {
    "metal": 1.0,
    "stone": 0.95,
    "botanical": 0.55,
    "flesh": 0.45,
    "fabric": 0.35,
    "liquid": 0.25,
    "energy": 0.10,
}


def smart_resize(h: int, w: int, factor: int = 32, min_px: int = 65_536, max_px: int = 524_288) -> tuple[int, int]:
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


def preprocess_image(path: Path) -> tuple[np.ndarray, int, int]:
    img = Image.open(path).convert("RGB")
    w, h = img.size
    rh, rw = smart_resize(h, w)
    img = img.resize((rw, rh), Image.Resampling.BICUBIC)
    arr = np.asarray(img, dtype=np.float32) * (2.0 / 255.0) - 1.0
    arr = np.transpose(arr, (2, 0, 1))
    gh, gw = rh // 32, rw // 32
    patches = arr.reshape(3, gh, 2, 16, gw, 2, 16).transpose(1, 4, 2, 5, 0, 3, 6)
    patches = np.repeat(patches[:, :, :, :, :, None, :, :], 2, axis=5)
    return np.ascontiguousarray(patches.reshape(gh, gw, 2, 2, 1536).astype(np.float32)), rw, rh


def norm_h(probs: list[float]) -> float:
    k = len(probs)
    if k <= 1:
        return 0.0
    return max(0.0, min(1.0, -sum(p * math.log(p) for p in probs if p > 1e-12) / math.log(k)))


def derive_stats(by_id: dict[str, Any], uncertainty: float) -> dict[str, int]:
    size = by_id["size_7"]["scalar"]
    mass = by_id["mass_5"]["scalar"]
    living = by_id["is_living"]["scalar"]
    warmth = by_id["warmth"]["scalar"]
    power = by_id["power"]["scalar"]
    agility = by_id["agility"]["scalar"]
    mystique = by_id["mystique"]["scalar"]

    # Expected substance hardness weighted by full substance probability distribution
    subst_probs = by_id["substance"]["probs"]
    hardness = sum(SUBSTANCE_HARDNESS[k] * p for k, p in subst_probs.items())
    density = max(0.0, min(1.0, (mass - size + 1.0) / 2.0))

    hp_raw = 0.45 * size + 0.35 * mass + 0.10 * living + 0.10 * warmth
    def_raw = 0.45 * mass + 0.25 * density + 0.30 * hardness

    bonus = max(0.0, min(1.0, (uncertainty - 0.25) / 0.45)) * 8.0
    to_stat = lambda v: round(20 + max(0.0, min(1.0, v)) * 72 + bonus)

    return {
        "hp": to_stat(hp_raw),
        "atk": to_stat(power),
        "def": to_stat(def_raw),
        "spd": to_stat(agility),
        "sp": to_stat(mystique),
    }


def main() -> None:
    plan = json.loads(PLAN_PATH.read_text())
    cache_dir = Path(".cache/d1-2B-ONNX") / plan["revision"]
    vis_sess = ort.InferenceSession(str(cache_dir / "onnx/vision_encoder_q8.onnx"), providers=["CPUExecutionProvider"])
    dec_sess = ort.InferenceSession(str(cache_dir / "onnx/decoder_q4.onnx"), providers=["CPUExecutionProvider"])

    images = sorted(IMG_DIR.glob("*.jpg"))
    runs = []
    for p in images:
        pv, rw, rh = preprocess_image(p)
        num_img = pv.shape[0] * pv.shape[1]
        (feats,) = vis_sess.run(["image_features"], {"pixel_values": pv})

        state_ids = plan["prefixBeforeImage"] + [plan["imageTokenId"]] * num_img + plan["prefixAfterImage"]
        state_len = len(state_ids)
        full_ids = state_ids + plan["suffixIds"]
        seq_len = len(full_ids)
        q_ids = [-1] * state_len + plan["suffixQuestionIds"]
        slots = [state_len + off for off in plan["slotOffsets"]]

        t0 = time.perf_counter()
        (logits,) = dec_sess.run(
            ["logits"],
            {
                "input_ids": np.array([full_ids], dtype=np.int64),
                "attention_mask": np.ones((1, seq_len), dtype=np.int64),
                "position_ids": np.arange(seq_len, dtype=np.int64)[None, :],
                "image_features": feats.astype(np.float32),
                "video_features": np.zeros((0, plan["hiddenSize"]), dtype=np.float32),
                "question_ids": np.array([q_ids], dtype=np.int64),
                "slot_positions": np.array(slots, dtype=np.int64),
            },
        )
        dec_ms = (time.perf_counter() - t0) * 1000

        by_id = {}
        for i, q in enumerate(plan["questions"]):
            row = logits[i]
            t = q["temperature"]
            scores = [max(float(row[tid]) for tid in forms) / t for forms in q["readoutIds"]]
            m = max(scores)
            exps = [math.exp(s - m) for s in scores]
            tot = sum(exps)
            probs = [e / tot for e in exps]
            order = sorted(range(len(probs)), key=lambda idx: probs[idx], reverse=True)
            ev = None
            if q["kind"] == "score":
                ev = sum(idx * pr for idx, pr in enumerate(probs)) / (len(probs) - 1)
            elif q["kind"] == "noul":
                ev = probs[0]
            by_id[q["id"]] = {
                "group": q["group"],
                "kind": q["kind"],
                "top": q["options"][order[0]],
                "topProb": probs[order[0]],
                "second": q["options"][order[1]] if len(order) > 1 else None,
                "secondProb": probs[order[1]] if len(order) > 1 else 0.0,
                "scalar": ev,
                "entropy": norm_h(probs),
                "probs": dict(zip(q["options"], probs)),
            }

        type_h = float(np.mean([v["entropy"] for v in by_id.values() if v["group"] == "type" and v["kind"] == "choice"]))
        scalar_h = float(np.mean([v["entropy"] for v in by_id.values() if v["group"] == "scalar"]))
        unc = 0.6 * type_h + 0.4 * scalar_h
        stats = derive_stats(by_id, unc)
        runs.append({"image": p.name, "unc": unc, "typeH": type_h, "scalarH": scalar_h, "stats": stats, "by_id": by_id})

        print(
            f"{p.name:24s} | {by_id['substance']['top']:9s}/{by_id['biome']['top']:7s} · {by_id['archetype']['top']:9s} ({by_id['size_class']['top']:10s}) | "
            f"HP={stats['hp']:2d} ATK={stats['atk']:2d} DEF={stats['def']:2d} SPD={stats['spd']:2d} SP={stats['sp']:2d} | "
            f"U={unc:.3f} (tH={type_h:.2f}, sH={scalar_h:.2f}) | {dec_ms:.0f}ms"
        )

    uncs = sorted(r["unc"] for r in runs)
    print(f"\n11-question U distribution (12 imgs): {[round(u, 3) for u in uncs]}")
    print(f"min={min(uncs):.3f}, p25={np.percentile(uncs,25):.3f}, med={np.median(uncs):.3f}, p75={np.percentile(uncs,75):.3f}, max={max(uncs):.3f}")
    REPORT_PATH.write_text(json.dumps(runs, indent=2) + "\n")


if __name__ == "__main__":
    main()
