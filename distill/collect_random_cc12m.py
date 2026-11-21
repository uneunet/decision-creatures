#!/usr/bin/env python3
"""Collect a purely random photo dataset from Hugging Face `pixparse/cc12m-wds` shards.

Streams `.tar` shards directly over HTTP (no API rate limits, no category curation),
decodes images on the fly, filters out corrupt / tiny / extreme-aspect images, and
saves normalized RGB JPEGs (max side 640 px) into `.cache/distill/images_random/`.

Fully resumable and deterministic for a given `--seed`.
"""

from __future__ import annotations

import argparse
import io
import json
import random
import tarfile
import time
import urllib.request
from pathlib import Path

from PIL import Image

OUT_DIR = Path(".cache/distill/images_random")
MANIFEST_PATH = Path(".cache/distill/images_random_manifest.json")
DATASET_REPO = "pixparse/cc12m-wds"
# cc12m-wds has shards cc12m-train-0000.tar .. cc12m-train-2175.tar
MAX_SHARD_IDX = 2175


def stream_shard_images(
    shard_idx: int,
    take_count: int,
    out_dir: Path,
    rng: random.Random,
    max_side: int = 640,
) -> list[dict[str, str]]:
    """Stream one tar shard and save up to `take_count` randomly subsampled images."""
    shard_name = f"cc12m-train-{shard_idx:04d}.tar"
    url = f"https://huggingface.co/datasets/{DATASET_REPO}/resolve/main/{shard_name}"
    req = urllib.request.Request(url, headers={"User-Agent": "decision-creatures-distill/1.0"})

    saved: list[dict[str, str]] = []
    seen_imgs = 0
    # Each shard has ~4,500 images; subsample with probability ~ take_count / 3500 so we spread across the shard
    keep_prob = min(1.0, (take_count * 1.4) / 3500.0)

    with urllib.request.urlopen(req, timeout=60) as resp:
        with tarfile.open(fileobj=resp, mode="r|*") as tf:
            for member in tf:
                if len(saved) >= take_count:
                    break
                if not member.isfile():
                    continue
                lower = member.name.lower()
                if not (lower.endswith(".jpg") or lower.endswith(".jpeg") or lower.endswith(".png") or lower.endswith(".webp")):
                    continue
                seen_imgs += 1
                if rng.random() > keep_prob:
                    continue

                fobj = tf.extractfile(member)
                if fobj is None:
                    continue
                raw = fobj.read()
                try:
                    img = Image.open(io.BytesIO(raw)).convert("RGB")
                except Exception:
                    continue

                w, h = img.size
                if min(w, h) < 96:
                    continue
                if max(w, h) / max(1, min(w, h)) > 4.0:
                    continue

                if max(w, h) > max_side:
                    scale = max_side / max(w, h)
                    img = img.resize((max(32, round(w * scale)), max(32, round(h * scale))), Image.Resampling.BICUBIC)

                stem = Path(member.name).stem
                img_id = f"cc12m_{shard_idx:04d}_{stem}"
                dest = out_dir / f"{shard_idx:04d}" / f"{img_id}.jpg"
                dest.parent.mkdir(parents=True, exist_ok=True)
                img.save(dest, format="JPEG", quality=90)
                saved.append({"id": img_id, "source": f"cc12m_{shard_idx:04d}", "path": str(dest)})

    return saved


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--total", type=int, default=10000, help="Total random images to collect")
    parser.add_argument("--per-shard", type=int, default=500, help="Images to sample per random shard")
    parser.add_argument("--seed", type=int, default=2026)
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)

    # Resume from existing files if present
    manifest: list[dict[str, str]] = []
    if MANIFEST_PATH.exists():
        existing = json.loads(MANIFEST_PATH.read_text())
        manifest = [e for e in existing if Path(e["path"]).exists()]
        if len(manifest) >= args.total:
            print(f"Already have {len(manifest)} random images in {OUT_DIR}")
            return

    used_shards = {e["source"] for e in manifest}
    all_shards = list(range(MAX_SHARD_IDX + 1))
    rng.shuffle(all_shards)

    t0 = time.perf_counter()
    for shard_idx in all_shards:
        if len(manifest) >= args.total:
            break
        src_key = f"cc12m_{shard_idx:04d}"
        if src_key in used_shards:
            continue
        need = min(args.per_shard, args.total - len(manifest))
        t_s = time.perf_counter()
        print(f"[shard {shard_idx:04d}] Streaming up to {need} random images (total {len(manifest)}/{args.total})...", flush=True)
        try:
            got = stream_shard_images(shard_idx, need, OUT_DIR, rng)
            manifest.extend(got)
            used_shards.add(src_key)
            MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
            print(f"  +{len(got)} images in {time.perf_counter() - t_s:.1f}s -> {len(manifest)}/{args.total}", flush=True)
        except Exception as err:
            print(f"  [warn] shard {shard_idx:04d} failed: {err}", flush=True)

    print(f"\nDone: {len(manifest)} purely random images saved in {time.perf_counter() - t0:.1f}s -> {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
