#!/usr/bin/env python3
"""GPU-accelerated teacher feature + soft-label extractor using LiquidAI/d1-2B (BF16 on ROCm/CUDA).

Uses `state_attention` (exact d1 packed-set FlashAttention mask) and captures
`multi_modal_projector` output in the same forward pass so both `image_features`
([N, 2048] fp16) and 11-question calibrated soft probabilities ([60] fp32) are
extracted in a single GPU pass (~80-120 ms/image on RX 9070 XT).

Saves compressed shards (500 samples/shard) under `.cache/distill/dataset_random/`
with full resume support.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np
import torch
from transformers import AutoModel

from extract_teacher import preprocess_image, readout_soft_probs

warnings.filterwarnings("ignore", category=FutureWarning)

MANIFEST_PATH = Path(".cache/distill/images_random_manifest.json")
OUT_DIR = Path(".cache/distill/dataset_random")
VAL12_PATH = Path(".cache/distill/val12.npz")
PLAN_PATH = Path("src/inference/prompt-plan.json")


def get_state_attention_ctx(model: Any):
    """Retrieve LiquidAI/d1-2B's `state_attention` context manager from the loaded Hub module."""
    mod_name = model.__class__.__module__.rsplit(".", 1)[0] + ".attention"
    attn_mod = sys.modules[mod_name]
    return attn_mod.state_attention


def preprocess_job(entry: dict[str, str], max_px: int) -> tuple[dict[str, str], np.ndarray | None]:
    try:
        pv = preprocess_image(Path(entry["path"]), max_px=max_px)
        return entry, pv
    except Exception:
        return entry, None


def run_one_gpu(
    model: Any,
    state_attention: Any,
    plan: dict[str, Any],
    pv: np.ndarray,
    captured: list[torch.Tensor],
    suffix_ids_t: torch.Tensor,
    suffix_qids_t: torch.Tensor,
    prefix_before_t: torch.Tensor,
    prefix_after_t: torch.Tensor,
    slot_offsets_t: torch.Tensor,
) -> tuple[np.ndarray, np.ndarray]:
    gh, gw = pv.shape[0], pv.shape[1]
    num_img = gh * gw
    pv_flat = torch.from_numpy(pv.reshape(-1, 1536)).to("cuda", dtype=torch.bfloat16, non_blocking=True)
    grid_thw = torch.tensor([[1, gh * 2, gw * 2]], dtype=torch.long)

    img_toks = torch.full((num_img,), plan["imageTokenId"], dtype=torch.long, device="cuda")
    state_ids = torch.cat([prefix_before_t, img_toks, prefix_after_t], dim=0)
    state_len = int(state_ids.shape[0])
    full_ids = torch.cat([state_ids, suffix_ids_t], dim=0).unsqueeze(0)
    seq_len = int(full_ids.shape[1])

    q_state = torch.full((state_len,), -1, dtype=torch.long, device="cuda")
    q_ids = torch.cat([q_state, suffix_qids_t], dim=0).unsqueeze(0)
    attention_mask = torch.ones((1, seq_len), dtype=torch.long, device="cuda")
    position_ids = torch.arange(seq_len, dtype=torch.long, device="cuda").unsqueeze(0)
    slot_positions = slot_offsets_t + state_len

    captured.clear()
    with torch.no_grad():
        with state_attention(model, torch.tensor([state_len], dtype=torch.long, device="cuda"), q_ids):
            out = model(
                input_ids=full_ids,
                attention_mask=attention_mask,
                position_ids=position_ids,
                pixel_values=pv_flat,
                image_grid_thw=grid_thw,
                use_cache=False,
            )
        slot_logits = out.logits[0, slot_positions].float().cpu().numpy()

    assert len(captured) == 1, f"Expected 1 captured vision projection, got {len(captured)}"
    feats = captured[0]
    if feats.ndim == 3:
        feats = feats[0]
    feats_fp16 = feats.to(torch.float16).cpu().numpy()
    probs = readout_soft_probs(plan, slot_logits)
    return feats_fp16, probs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--shard-size", type=int, default=500)
    parser.add_argument("--max-pixels", type=int, default=262_144)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    assert torch.cuda.is_available(), "CUDA/ROCm GPU not available!"
    print(f"GPU: {torch.cuda.get_device_name(0)} | PyTorch {torch.__version__}")

    t_load = time.perf_counter()
    model = AutoModel.from_pretrained(
        "LiquidAI/d1-2B",
        trust_remote_code=True,
        dtype=torch.bfloat16,
    ).to("cuda").eval()
    state_attention = get_state_attention_ctx(model)
    print(f"Loaded LiquidAI/d1-2B (BF16) in {time.perf_counter() - t_load:.1f}s | VRAM={torch.cuda.memory_allocated()/1e9:.2f} GB")

    # Capture multi_modal_projector output in the exact same forward pass
    captured: list[torch.Tensor] = []

    def _proj_hook(_module, _inp, output):
        t = output[0] if isinstance(output, (tuple, list)) else output
        captured.append(t.detach())

    hook_handle = model.model.multi_modal_projector.register_forward_hook(_proj_hook)

    plan = json.loads(PLAN_PATH.read_text())
    prefix_before_t = torch.tensor(plan["prefixBeforeImage"], dtype=torch.long, device="cuda")
    prefix_after_t = torch.tensor(plan["prefixAfterImage"], dtype=torch.long, device="cuda")
    suffix_ids_t = torch.tensor(plan["suffixIds"], dtype=torch.long, device="cuda")
    suffix_qids_t = torch.tensor(plan["suffixQuestionIds"], dtype=torch.long, device="cuda")
    slot_offsets_t = torch.tensor(plan["slotOffsets"], dtype=torch.long, device="cuda")

    # Sanity parity check on held-out 01_cat.jpg against ONNX reference
    if VAL12_PATH.exists():
        val12 = np.load(VAL12_PATH, allow_pickle=True)
        pv0 = preprocess_image(Path(".cache/experiment-images/01_cat.jpg"), max_px=args.max_pixels)
        f0, p0 = run_one_gpu(
            model, state_attention, plan, pv0, captured,
            suffix_ids_t, suffix_qids_t, prefix_before_t, prefix_after_t, slot_offsets_t,
        )
        ref_f = val12["f_0"].astype(np.float32)
        ref_p = val12["p_0"].astype(np.float32)
        f0_f32 = f0.astype(np.float32)
        cos = float(np.sum(f0_f32 * ref_f) / (np.linalg.norm(f0_f32) * np.linalg.norm(ref_f)))
        p_mae = float(np.mean(np.abs(p0 - ref_p)))
        p_max = float(np.max(np.abs(p0 - ref_p)))
        print(f"Parity check (01_cat.jpg vs ONNX q8/q4f16): vision_cos={cos:.6f}, probs_MAE={p_mae:.5f}, probs_max={p_max:.5f}", flush=True)
        assert cos > 0.99, f"Vision feature parity failed: {cos}"
        assert p_mae < 0.03, f"Teacher probability parity failed (mask mismatch?): MAE={p_mae}"

    manifest: list[dict[str, str]] = json.loads(args.manifest.read_text())
    if args.limit > 0:
        manifest = manifest[: args.limit]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    num_shards = (len(manifest) + args.shard_size - 1) // args.shard_size
    print(f"\nExtracting {len(manifest)} images into {num_shards} shards ({args.shard_size}/shard) -> {args.out_dir}", flush=True)

    t_all = time.perf_counter()
    total_done = 0
    total_new = 0
    total_fail = 0

    with ThreadPoolExecutor(max_workers=8) as pool:
        for s_idx in range(num_shards):
            shard_path = args.out_dir / f"shard_{s_idx:03d}.npz"
            slice_entries = manifest[s_idx * args.shard_size : (s_idx + 1) * args.shard_size]
            if shard_path.exists():
                total_done += len(slice_entries)
                continue

            t_s = time.perf_counter()
            preproc_results = list(pool.map(lambda e: preprocess_job(e, args.max_pixels), slice_entries))

            feats_list: list[np.ndarray] = []
            probs_list: list[np.ndarray] = []
            ids_list: list[str] = []
            sources_list: list[str] = []
            shard_fail = 0

            for entry, pv in preproc_results:
                if pv is None:
                    shard_fail += 1
                    continue
                try:
                    f_fp16, p_f32 = run_one_gpu(
                        model, state_attention, plan, pv, captured,
                        suffix_ids_t, suffix_qids_t, prefix_before_t, prefix_after_t, slot_offsets_t,
                    )
                    feats_list.append(f_fp16)
                    probs_list.append(p_f32)
                    ids_list.append(entry["id"])
                    sources_list.append(entry["source"])
                except Exception as err:
                    shard_fail += 1
                    if shard_fail <= 3:
                        print(f"  [warn] {entry['id']} failed: {err}", flush=True)

            # Pack variable-length features into flat array + offsets for fast single-array loading
            lengths = np.array([f.shape[0] for f in feats_list], dtype=np.int32)
            flat_feats = np.concatenate(feats_list, axis=0) if feats_list else np.zeros((0, 2048), dtype=np.float16)
            probs_arr = np.stack(probs_list, axis=0) if probs_list else np.zeros((0, 60), dtype=np.float32)

            tmp_path = shard_path.with_suffix(".tmp.npz")
            np.savez(
                tmp_path,
                flat_features=flat_feats,
                lengths=lengths,
                probs=probs_arr,
                ids=np.array(ids_list),
                sources=np.array(sources_list),
            )
            tmp_path.replace(shard_path)

            dt = time.perf_counter() - t_s
            total_done += len(slice_entries)
            total_new += len(feats_list)
            total_fail += shard_fail
            elapsed = time.perf_counter() - t_all
            rate = total_new / max(elapsed, 1e-6)
            rem = len(manifest) - total_done
            eta_min = rem / max(rate, 1e-6) / 60.0
            print(
                f"  [shard {s_idx+1:2d}/{num_shards}] +{len(feats_list)} imgs in {dt:.1f}s "
                f"({len(feats_list)/max(dt,1e-6):.1f} img/s) | total={total_done}/{len(manifest)} | "
                f"ETA={eta_min:.1f}m | fail={total_fail}",
                flush=True,
            )

    hook_handle.remove()
    print(f"\nGPU extraction complete: {total_new} new samples, {total_fail} failed, elapsed={(time.perf_counter()-t_all)/60:.1f}m")


if __name__ == "__main__":
    main()
