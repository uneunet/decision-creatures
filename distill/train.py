#!/usr/bin/env python3
"""Step 3: Train `CreatureDistillHead` via KL distillation, export ONNX, and evaluate on held-out 12 images."""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch.utils.data import DataLoader, Dataset

from model import (
    NUM_QUESTIONS,
    QUESTION_SIZES,
    QUESTION_SPECS,
    TOTAL_LOGITS,
    CreatureDistillHead,
    kl_distillation_loss,
)

DATASET_DIR = Path(".cache/distill/dataset")
VAL12_PATH = Path(".cache/distill/val12.npz")
RUNS_DIR = Path(".cache/distill/runs")
PLAN_PATH = Path("src/inference/prompt-plan.json")

SUBSTANCE_HARDNESS = {
    "metal": 1.0,
    "stone": 0.95,
    "botanical": 0.55,
    "flesh": 0.45,
    "fabric": 0.35,
    "liquid": 0.25,
    "energy": 0.10,
}


class FeatureDataset(Dataset):
    def __init__(self, samples: list[tuple[np.ndarray, np.ndarray, str]], augment: bool) -> None:
        self.samples = samples
        self.augment = augment

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        feat_fp16, probs, _ = self.samples[idx]
        x = torch.from_numpy(feat_fp16.astype(np.float32))  # [N, 2048]
        y = torch.from_numpy(probs.astype(np.float32))      # [60]
        if self.augment:
            # Random patch token dropout (simulates variable crops / aspect ratios)
            n = x.shape[0]
            if n > 32:
                keep_prob = random.uniform(0.75, 1.0)
                keep_n = max(32, int(round(n * keep_prob)))
                if keep_n < n:
                    perm = torch.randperm(n)[:keep_n]
                    x = x[perm]
            # Mild Gaussian feature jitter
            x = x + torch.randn_like(x) * 0.015
        return x, y


def collate_padded(batch: list[tuple[torch.Tensor, torch.Tensor]]) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    max_n = max(x.shape[0] for x, _ in batch)
    dim = batch[0][0].shape[1]
    b = len(batch)
    xs = torch.zeros((b, max_n, dim), dtype=torch.float32)
    mask = torch.zeros((b, max_n), dtype=torch.bool)
    ys = torch.stack([y for _, y in batch], dim=0)
    for i, (x, _) in enumerate(batch):
        n = x.shape[0]
        xs[i, :n] = x
        mask[i, :n] = True
    return xs, mask, ys


def norm_h(probs: list[float]) -> float:
    k = len(probs)
    if k <= 1:
        return 0.0
    return max(0.0, min(1.0, -sum(p * math.log(p) for p in probs if p > 1e-12) / math.log(k)))


def rarity_tier(u: float) -> str:
    if u >= 0.53:
        return "MYTHIC"
    if u >= 0.48:
        return "EPIC"
    if u >= 0.42:
        return "RARE"
    if u >= 0.34:
        return "UNCOMMON"
    return "COMMON"


def decode_60_probs(probs_60: np.ndarray, plan_questions: list[dict[str, Any]]) -> dict[str, Any]:
    by_id: dict[str, Any] = {}
    offset = 0
    for (qid, group, kind, k), q_plan in zip(QUESTION_SPECS, plan_questions):
        probs = [float(x) for x in probs_60[offset : offset + k]]
        offset += k
        options = q_plan["options"]
        order = sorted(range(k), key=lambda idx: probs[idx], reverse=True)
        ev = None
        if kind == "score":
            ev = sum(idx * pr for idx, pr in enumerate(probs)) / (k - 1)
        elif kind == "noul":
            ev = probs[0]
        by_id[qid] = {
            "group": group,
            "kind": kind,
            "top": options[order[0]],
            "topProb": probs[order[0]],
            "scalar": ev,
            "entropy": norm_h(probs),
            "probs": dict(zip(options, probs)),
        }

    type_h = float(np.mean([v["entropy"] for v in by_id.values() if v["group"] == "type" and v["kind"] == "choice"]))
    scalar_h = float(np.mean([v["entropy"] for v in by_id.values() if v["group"] == "scalar"]))
    unc = 0.6 * type_h + 0.4 * scalar_h

    size = by_id["size_7"]["scalar"]
    mass = by_id["mass_5"]["scalar"]
    living = by_id["is_living"]["scalar"]
    warmth = by_id["warmth"]["scalar"]
    power = by_id["power"]["scalar"]
    agility = by_id["agility"]["scalar"]
    mystique = by_id["mystique"]["scalar"]
    hardness = sum(SUBSTANCE_HARDNESS[k] * p for k, p in by_id["substance"]["probs"].items())
    density = max(0.0, min(1.0, (mass - size + 1.0) / 2.0))
    hp_raw = 0.45 * size + 0.35 * mass + 0.10 * living + 0.10 * warmth
    def_raw = 0.45 * mass + 0.25 * density + 0.30 * hardness
    bonus = max(0.0, min(1.0, (unc - 0.25) / 0.45)) * 8.0
    to_stat = lambda v: round(20 + max(0.0, min(1.0, v)) * 72 + bonus)
    stats = {
        "hp": to_stat(hp_raw),
        "atk": to_stat(power),
        "def": to_stat(def_raw),
        "spd": to_stat(agility),
        "sp": to_stat(mystique),
    }
    return {"by_id": by_id, "unc": unc, "tier": rarity_tier(unc), "stats": stats}


def logits_to_probs_60(logits_60: np.ndarray) -> np.ndarray:
    out = np.zeros(TOTAL_LOGITS, dtype=np.float32)
    offset = 0
    for k in QUESTION_SIZES:
        seg = logits_60[offset : offset + k]
        seg = seg - np.max(seg)
        e = np.exp(seg)
        out[offset : offset + k] = e / np.sum(e)
        offset += k
    return out


def evaluate_val12(
    model: CreatureDistillHead,
    device: str,
    plan_questions: list[dict[str, Any]],
    verbose: bool = True,
) -> dict[str, Any]:
    val12 = np.load(VAL12_PATH, allow_pickle=True)
    names = list(val12["names"])
    cat_ids = ["substance", "biome", "archetype", "size_class", "is_living"]
    per_cat = {c: [0, 0] for c in cat_ids}
    stat_diffs: list[int] = []
    t_uncs: list[float] = []
    s_uncs: list[float] = []
    tier_ok = 0
    kl_list: list[float] = []
    rows = []

    model.eval()
    with torch.no_grad():
        for idx, name in enumerate(names):
            feat = torch.from_numpy(val12[f"f_{idx}"].astype(np.float32)).to(device)
            t_probs = val12[f"p_{idx}"].astype(np.float32)
            logits = model(feat)
            kl = float(kl_distillation_loss(logits.unsqueeze(0), torch.from_numpy(t_probs).unsqueeze(0).to(device)).item())
            kl_list.append(kl)
            s_probs = logits_to_probs_60(logits.cpu().numpy())

            t_dec = decode_60_probs(t_probs, plan_questions)
            s_dec = decode_60_probs(s_probs, plan_questions)
            t_uncs.append(t_dec["unc"])
            s_uncs.append(s_dec["unc"])
            if t_dec["tier"] == s_dec["tier"]:
                tier_ok += 1

            for cid in cat_ids:
                per_cat[cid][1] += 1
                if t_dec["by_id"][cid]["top"] == s_dec["by_id"][cid]["top"]:
                    per_cat[cid][0] += 1
            for sk in ("hp", "atk", "def", "spd", "sp"):
                stat_diffs.append(abs(t_dec["stats"][sk] - s_dec["stats"][sk]))

            rows.append({"image": str(name), "teacher": t_dec, "student": s_dec, "kl": kl})
            if verbose:
                tb, sb = t_dec["by_id"], s_dec["by_id"]
                ts, ss = t_dec["stats"], s_dec["stats"]
                print(
                    f"  {str(name):24s} | 2B: {tb['substance']['top']:9s}/{tb['biome']['top']:7s}·{tb['archetype']['top']:9s}({tb['size_class']['top']:10s}) "
                    f"U={t_dec['unc']:.3f} HP={ts['hp']:2d} ATK={ts['atk']:2d} DEF={ts['def']:2d} SPD={ts['spd']:2d} SP={ts['sp']:2d}"
                )
                print(
                    f"  {'':24s} | ST: {sb['substance']['top']:9s}/{sb['biome']['top']:7s}·{sb['archetype']['top']:9s}({sb['size_class']['top']:10s}) "
                    f"U={s_dec['unc']:.3f} HP={ss['hp']:2d} ATK={ss['atk']:2d} DEF={ss['def']:2d} SPD={ss['spd']:2d} SP={ss['sp']:2d}"
                )

    tot_ok = sum(v[0] for v in per_cat.values())
    tot_n = sum(v[1] for v in per_cat.values())
    u_corr = float(np.corrcoef(t_uncs, s_uncs)[0, 1]) if np.std(s_uncs) > 1e-8 else 0.0
    summary = {
        "val12_kl": round(float(np.mean(kl_list)), 4),
        "cat_ok": tot_ok,
        "cat_total": tot_n,
        "cat_acc_pct": round(100.0 * tot_ok / max(1, tot_n), 1),
        "per_cat": {c: f"{ok}/{n}" for c, (ok, n) in per_cat.items()},
        "stat_mae": round(float(np.mean(stat_diffs)), 2),
        "stat_max": int(max(stat_diffs)),
        "unc_mae": round(float(np.mean(np.abs(np.array(t_uncs) - np.array(s_uncs)))), 4),
        "unc_corr": round(u_corr, 3),
        "tier_match": f"{tier_ok}/{len(names)}",
        "rows": rows,
    }
    if verbose:
        print("\n=== HELD-OUT 12 IMAGES BENCHMARK (Student vs Teacher d1-2B) ===")
        print(f"  KL loss      : {summary['val12_kl']:.4f}")
        print(f"  Category acc : {tot_ok}/{tot_n} ({summary['cat_acc_pct']}%)  {summary['per_cat']}")
        print(f"  Stat MAE     : {summary['stat_mae']:.2f} (max {summary['stat_max']})")
        print(f"  Uncertainty  : MAE={summary['unc_mae']:.4f}, Pearson r={summary['unc_corr']:.3f}, tier={summary['tier_match']}")
    return summary


def export_onnx(model: CreatureDistillHead, out_dir: Path) -> Path:
    model_cpu = model.to("cpu").eval()
    dummy = torch.randn(128, model_cpu.in_dim, dtype=torch.float32)
    out_onnx = out_dir / "creature_head.onnx"
    torch.onnx.export(
        model_cpu,
        (dummy,),
        str(out_onnx),
        input_names=["image_features"],
        output_names=["logits"],
        dynamic_axes={"image_features": {0: "num_image_tokens"}},
        opset_version=18,
        dynamo=False,
    )
    onnx_model = onnx.load(str(out_onnx))
    onnx.checker.check_model(onnx_model)

    # Verify numerical parity across multiple dynamic token counts N
    sess = ort.InferenceSession(str(out_onnx), providers=["CPUExecutionProvider"])
    max_diff = 0.0
    for test_n in (64, 120, 256):
        x = torch.randn(test_n, model_cpu.in_dim, dtype=torch.float32)
        with torch.no_grad():
            y_pt = model_cpu(x).numpy()
        (y_ort,) = sess.run(["logits"], {"image_features": x.numpy()})
        max_diff = max(max_diff, float(np.max(np.abs(y_pt - y_ort))))
    print(f"Exported ONNX: {out_onnx} ({out_onnx.stat().st_size / 1e6:.2f} MB) | ORT max_diff={max_diff:.2e}")
    assert max_diff < 1e-4, f"ONNX parity check failed: {max_diff}"
    return out_onnx


def load_samples_from_dir(dataset_dir: Path) -> list[tuple[np.ndarray, np.ndarray, str]]:
    """Load samples from either sharded `.npz` (`flat_features`+`lengths`) or per-image `.npz`."""
    files = sorted(p for p in dataset_dir.glob("*.npz") if not p.name.endswith(".tmp.npz"))
    assert files, f"No extracted .npz files found in {dataset_dir}"
    samples: list[tuple[np.ndarray, np.ndarray, str]] = []
    for f in files:
        d = np.load(f, allow_pickle=True)
        if "flat_features" in d:
            flat = d["flat_features"]
            lengths = d["lengths"]
            probs = d["probs"]
            sources = d["sources"]
            cursor = 0
            for i, ln in enumerate(lengths):
                ln_i = int(ln)
                feat = flat[cursor : cursor + ln_i]
                cursor += ln_i
                samples.append((feat, probs[i], str(sources[i])))
        else:
            src = str(d["source"].item()) if d["source"].ndim == 0 else str(d["source"])
            samples.append((d["features"], d["probs"], src))
    return samples


def fit_temperature(model: CreatureDistillHead, val_loader: DataLoader, device: str) -> float:
    """Fit post-hoc calibration temperature on internal val set (minimizing KL loss)."""
    model.eval()
    model.temperature.fill_(1.0)
    all_logits: list[torch.Tensor] = []
    all_targets: list[torch.Tensor] = []
    with torch.no_grad():
        for xs, mask, ys in val_loader:
            xs, mask = xs.to(device), mask.to(device)
            all_logits.append(model.forward_batched(xs, mask).cpu())
            all_targets.append(ys.cpu())
    logits_cat = torch.cat(all_logits, dim=0)
    targets_cat = torch.cat(all_targets, dim=0)

    best_t = 1.0
    best_kl = float("inf")
    for t in np.linspace(0.50, 1.30, 81):
        kl = float(kl_distillation_loss(logits_cat / float(t), targets_cat).item())
        if kl < best_kl:
            best_kl = kl
            best_t = float(t)
    model.temperature.fill_(best_t)
    raw_kl = float(kl_distillation_loss(logits_cat, targets_cat).item())
    print(f"Post-hoc temperature calibration (internal val): T={best_t:.3f} (val_kl {raw_kl:.4f} -> {best_kl:.4f})")
    return best_t


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=DATASET_DIR)
    parser.add_argument("--run-name", type=str, default="poc")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--d-model", type=int, default=256)
    parser.add_argument("--dropout", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    print(f"Loading extracted teacher samples from {args.dataset_dir}...")
    all_samples = load_samples_from_dir(args.dataset_dir)
    print(f"Loaded {len(all_samples)} samples.")

    by_source: dict[str, list[tuple[np.ndarray, np.ndarray, str]]] = defaultdict(list)
    for item in all_samples:
        by_source[item[2]].append(item)

    train_samples: list[tuple[np.ndarray, np.ndarray, str]] = []
    val_samples: list[tuple[np.ndarray, np.ndarray, str]] = []
    for src, items in sorted(by_source.items()):
        rng = random.Random(args.seed)
        rng.shuffle(items)
        n_val = max(1, int(round(len(items) * 0.10)))
        val_samples.extend(items[:n_val])
        train_samples.extend(items[n_val:])
        if len(by_source) <= 10:
            print(f"  {src:12s}: {len(items)-n_val:4d} train / {n_val:3d} val")

    print(f"Total split ({len(by_source)} shards/sources): {len(train_samples)} train / {len(val_samples)} internal val")

    train_loader = DataLoader(
        FeatureDataset(train_samples, augment=True),
        batch_size=args.batch_size,
        shuffle=True,
        collate_fn=collate_padded,
    )
    val_loader = DataLoader(
        FeatureDataset(val_samples, augment=False),
        batch_size=args.batch_size,
        shuffle=False,
        collate_fn=collate_padded,
    )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = CreatureDistillHead(in_dim=2048, d_model=args.d_model, dropout=args.dropout).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"Model: CreatureDistillHead(d_model={args.d_model}) | params={n_params:,} (~{n_params*4/1e6:.2f} MB FP32) on {device}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=2e-2)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs, eta_min=args.lr * 0.02)

    run_dir = RUNS_DIR / args.run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    best_val_kl = float("inf")
    best_state = None
    t0 = time.perf_counter()

    for epoch in range(1, args.epochs + 1):
        model.train()
        tr_losses = []
        for xs, mask, ys in train_loader:
            xs, mask, ys = xs.to(device), mask.to(device), ys.to(device)
            optimizer.zero_grad(set_to_none=True)
            logits = model.forward_batched(xs, mask)
            loss = kl_distillation_loss(logits, ys)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            tr_losses.append(float(loss.item()))
        scheduler.step()

        model.eval()
        val_losses = []
        with torch.no_grad():
            for xs, mask, ys in val_loader:
                xs, mask, ys = xs.to(device), mask.to(device), ys.to(device)
                logits = model.forward_batched(xs, mask)
                val_losses.append(float(kl_distillation_loss(logits, ys).item()))

        tr_kl = float(np.mean(tr_losses))
        va_kl = float(np.mean(val_losses))
        improved = ""
        if va_kl < best_val_kl:
            best_val_kl = va_kl
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            improved = " *"
        if epoch == 1 or epoch % 5 == 0 or epoch == args.epochs:
            print(f"Epoch {epoch:3d}/{args.epochs} | train_kl={tr_kl:.4f} | val_kl={va_kl:.4f} | best={best_val_kl:.4f}{improved}", flush=True)

    print(f"\nTraining finished in {time.perf_counter() - t0:.1f}s (best internal val_kl={best_val_kl:.4f})")
    assert best_state is not None
    model.load_state_dict(best_state)
    fit_temperature(model, val_loader, device)
    torch.save(model.state_dict(), run_dir / "best_head.pt")

    # Export ONNX & check parity
    export_onnx(model, run_dir)

    # Evaluate on held-out 12 real experiment images (never seen during training or model selection)
    if VAL12_PATH.exists():
        plan = json.loads(PLAN_PATH.read_text())
        summary = evaluate_val12(model.to(device), device, plan["questions"], verbose=True)
        (run_dir / "val12_report.json").write_text(json.dumps(summary, indent=2) + "\n")


if __name__ == "__main__":
    main()
