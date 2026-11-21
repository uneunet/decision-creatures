#!/usr/bin/env python3
"""Experiment: Measuring physical object size & mass with LiquidAI/d1-2B-ONNX.

Compares 6 size/scale formulations in a single forward pass across diverse images
spanning 6+ orders of magnitude (insect ~1cm -> mug ~10cm -> cat ~40cm -> fern ~1m
-> car ~4m -> castle ~50m -> waterfall ~100m -> lightning/volcano ~km -> abstract).
"""

from __future__ import annotations

import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer

REPO = "LiquidAI/d1-2B-ONNX"
REVISION = "2fd61486312020c30a1e3aa5aa677424672b2b37"
CACHE_DIR = Path(".cache/d1-2B-ONNX") / REVISION
IMG_DIR = Path(".cache/experiment-images")

IM_START = "<|im_start|>"
IM_END = "<|im_end|>"
BOS = "<|startoftext|>"
VISION_START = "<|vision_start|>"
IMAGE_TOKEN = "<|image|>"
VISION_END = "<|vision_end|>"
LFM3_LEAD = "<think></think>"
LETTERS = tuple(chr(ord("A") + i) for i in range(26))

EXTRA_SCALE_IMAGES = {
    "11_ladybug_macro": "ladybug macro leaf",
    "12_sports_car": "red sports car street",
    "13_chair_wood": "wooden chair room",
}

SIZE_QUESTIONS: list[dict[str, Any]] = [
    # 1. 5-level log scale (0..4)
    {
        "id": "size_5",
        "kind": "score",
        "instructions": "Estimate the real-world physical size (largest dimension) of the main subject shown in this image.",
        "criteria": [
            "Tiny: smaller than a human hand (under 10 cm, like an insect, coin, or small berry)",
            "Small: hand-sized to lap-sized (10 cm to 50 cm, like a mug, duckling, or cat)",
            "Medium: human-scale (0.5 m to 3 m, like a chair, person, bush, or bicycle)",
            "Large: vehicle to building-scale (3 m to 50 m, like a car, tall tree, house, or castle)",
            "Colossal: landscape to planetary-scale (over 50 m, like a cliff, lightning bolt, mountain, or volcano)",
        ],
    },
    # 2. 7-level finer log scale (0..6, ~1 order of magnitude per step)
    {
        "id": "size_7",
        "kind": "score",
        "instructions": "Estimate the real-world physical length or height of the main subject on a logarithmic scale.",
        "criteria": [
            "Centimeter-scale (under 5 cm: insect, coin, button)",
            "Hand-scale (5 cm to 25 cm: mug, chick, smartphone, fruit)",
            "Pet-scale (25 cm to 1 m: cat, fern cluster, backpack)",
            "Human-scale (1 m to 3 m: chair, person, doorway, motorbike)",
            "Vehicle-scale (3 m to 15 m: car, bus, large tree, small house)",
            "Building-scale (15 m to 150 m: castle, waterfall, tall building)",
            "Geographic-scale (over 150 m: mountain, lightning storm, volcano, coastline)",
        ],
    },
    # 3. 10-level ultra-fine scale (0..9)
    {
        "id": "size_10",
        "kind": "score",
        "instructions": "Rate the physical real-world size of the primary subject from 0 (microscopic/millimeters) to 9 (planetary/kilometers).",
        "criteria": [
            "Under 2 cm (tiny insect, seed)",
            "2–8 cm (small bug, key, egg)",
            "8–20 cm (cup, apple, duckling)",
            "20–60 cm (cat, toaster, small plant)",
            "0.6–1.5 m (chair, dog, bush)",
            "1.5–4 m (person, car, doorway)",
            "4–15 m (truck, house, mature tree)",
            "15–80 m (castle, cliff, tall tower)",
            "80–500 m (skyscraper, huge waterfall, hill)",
            "Over 500 m (mountain, volcano, lightning bolt, ocean coast)",
        ],
    },
    # 4. Categorical size class WITH an explicit "no physical scale / abstract" option
    {
        "id": "size_class",
        "kind": "choice",
        "instructions": "Which real-world size category best describes the main subject in this image?",
        "criteria": {
            "tiny": "Tiny (< 10 cm, fits easily on a finger or palm)",
            "handheld": "Handheld / pet-sized (10 cm – 60 cm, can be picked up with hands)",
            "human": "Human / furniture-sized (0.6 m – 3 m)",
            "vehicle": "Vehicle / tree-sized (3 m – 15 m)",
            "monument": "Building / landmark-sized (15 m – 200 m)",
            "colossal": "Geographic / astronomical (> 200 m, landscape or atmospheric phenomenon)",
            "intangible": "Abstract pattern, texture, or graphic with no defined physical scale",
        },
    },
    # 5. Physical mass / weight (5-level log scale)
    {
        "id": "mass_5",
        "kind": "score",
        "instructions": "Estimate the real-world physical weight or mass of the main subject.",
        "criteria": [
            "Featherlight or weightless (under 50 g, or intangible light/pattern)",
            "Light handheld (50 g to 1 kg, like a duckling, mug, or small branch)",
            "Carryable (1 kg to 30 kg, like a cat, chair, or potted plant)",
            "Heavy (30 kg to 5 tons, like a person, motorcycle, car, or boulder)",
            "Immense (over 5 tons, like a stone castle, cliff, waterfall, or volcano)",
        ],
    },
    # 6. Native d1 `number` (Estimate 0..100 scale, testing d1_numbers=true directly!)
    {
        "id": "size_num_0_100",
        "kind": "number",
        "low": 0,
        "high": 100,
        "step": 1,
        "instructions": (
            "Estimate the main subject's real-world size on a logarithmic 0 to 100 scale, "
            "where 0 is 1 mm, 20 is 1 cm, 40 is 10 cm, 60 is 1 m, 80 is 10 m, and 100 is 1 km or larger."
        ),
    },
    # 7. Relative framing / proximity (how much of the frame it fills vs actual scale sanity check)
    {
        "id": "has_physical_scale",
        "kind": "noul",
        "instructions": "Does the main subject in this image have a clear, definable real-world physical size?",
        "criteria": {
            "true": "A concrete physical object, organism, building, or geographic feature",
            "false": "An abstract graphic, texture, light pattern, or ambiguous framing without clear physical scale",
        },
    },
]


def ensure_extra_images() -> None:
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": "decision-creatures-experiment/0.1 (local research)"}
    for name, q in EXTRA_SCALE_IMAGES.items():
        p = IMG_DIR / f"{name}.jpg"
        if p.exists() and p.stat().st_size > 5000:
            continue
        url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(
            {
                "action": "query",
                "generator": "search",
                "gsrsearch": f"filetype:bitmap {q}",
                "gsrnamespace": 6,
                "gsrlimit": 6,
                "prop": "imageinfo",
                "iiprop": "url|mime|size",
                "iiurlwidth": 640,
                "format": "json",
            }
        )
        try:
            data = json.loads(
                urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15)
                .read()
                .decode()
            )
            for pg in data.get("query", {}).get("pages", {}).values():
                ii = (pg.get("imageinfo") or [{}])[0]
                thumb = ii.get("thumburl") or ii.get("url")
                if thumb and ii.get("mime") in ("image/jpeg", "image/png"):
                    raw = urllib.request.urlopen(
                        urllib.request.Request(thumb, headers=headers), timeout=15
                    ).read()
                    if len(raw) > 5000:
                        p.write_bytes(raw)
                        print(f"[img] {name} OK ({len(raw)} bytes) {pg.get('title')}")
                        break
        except Exception as e:
            print(f"[img] {name} skip: {e}")


def encode_ids(tok: Tokenizer, text: str) -> list[int]:
    return list(tok.encode(text, add_special_tokens=False).ids)


def single_token_ids(tok: Tokenizer, forms: list[str]) -> list[int]:
    out, seen = [], set()
    for f in forms:
        ids = encode_ids(tok, f)
        if len(ids) == 1 and ids[0] not in seen:
            out.append(ids[0])
            seen.add(ids[0])
    return out


def compile_questions(tok: Tokenizer, cal_temp: float) -> dict[str, Any]:
    prefix_before = encode_ids(tok, f"{BOS}{IM_START}user\n{VISION_START}")
    prefix_after = encode_ids(tok, f"{VISION_END}")
    img_tok_id = encode_ids(tok, IMAGE_TOKEN)[0]

    suffix_ids: list[int] = []
    suffix_qids: list[int] = []
    slot_offsets: list[int] = []
    compiled: list[dict[str, Any]] = []

    for idx, q in enumerate(SIZE_QUESTIONS, start=1):
        kind = q["kind"]
        inst = q["instructions"]
        if kind == "score":
            crit = q["criteria"]
            legend = "\n".join(f"{i} {c}" for i, c in enumerate(crit))
            block = f"{inst}\n\n{legend}\n\nReply with a single digit 0-{len(crit) - 1} only."
            options = [str(i) for i in range(len(crit))]
            readout_ids = [single_token_ids(tok, [str(i)]) for i in range(len(crit))]
        elif kind == "choice":
            labels = list(q["criteria"].keys())
            codes = list(LETTERS[: len(labels)])
            lines = "\n".join(f"{c} {q['criteria'][lab]}" for c, lab in zip(codes, labels))
            block = f"{inst}\n\nOptions:\n{lines}\n\nReply with the option code only."
            options = labels
            readout_ids = [single_token_ids(tok, [c, f" {c}"]) for c in codes]
        elif kind == "noul":
            extra = f"\nYes: {q['criteria']['true']}\nNo: {q['criteria']['false']}"
            block = f"{inst}{extra}\n\nReply with yes or no only."
            options = ["yes", "no"]
            readout_ids = [
                single_token_ids(tok, ["yes", "Yes", "YES"]),
                single_token_ids(tok, ["no", "No", "NO"]),
            ]
        elif kind == "number":
            low, high, step = q["low"], q["high"], q["step"]
            block = (
                f"{inst}\n\nEstimate from {low:g} to {high:g}, in steps of {step:g}. "
                "Reply with the number only."
            )
            vals = list(range(low, high + 1, step))
            options = [str(v) for v in vals]
            readout_ids = [single_token_ids(tok, [str(v), f" {v}"]) for v in vals]
            assert all(readout_ids), "All grid numbers must have single-token IDs"
        else:
            raise ValueError(kind)

        suffix_text = f"{block}{IM_END}\n{IM_START}assistant\n{LFM3_LEAD}"
        own = encode_ids(tok, suffix_text)
        suffix_ids.extend(own)
        suffix_qids.extend([idx] * len(own))
        slot_offsets.append(len(suffix_ids) - 1)
        compiled.append(
            {
                "id": q["id"],
                "kind": kind,
                "options": options,
                "readoutIds": readout_ids,
                "temperature": cal_temp,
            }
        )

    return {
        "imageTokenId": img_tok_id,
        "prefixBeforeImage": prefix_before,
        "prefixAfterImage": prefix_after,
        "suffixIds": suffix_ids,
        "suffixQuestionIds": suffix_qids,
        "slotOffsets": slot_offsets,
        "questions": compiled,
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


def preprocess_image(path: Path) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    w, h = img.size
    rh, rw = smart_resize(h, w)
    img = img.resize((rw, rh), Image.Resampling.BICUBIC)
    arr = np.asarray(img, dtype=np.float32) * (2.0 / 255.0) - 1.0
    arr = np.transpose(arr, (2, 0, 1))
    gh, gw = rh // 32, rw // 32
    patches = arr.reshape(3, gh, 2, 16, gw, 2, 16).transpose(1, 4, 2, 5, 0, 3, 6)
    patches = np.repeat(patches[:, :, :, :, :, None, :, :], 2, axis=5)
    return np.ascontiguousarray(patches.reshape(gh, gw, 2, 2, 1536).astype(np.float32))


def norm_h(probs: list[float]) -> float:
    k = len(probs)
    if k <= 1:
        return 0.0
    return max(0.0, min(1.0, -sum(p * math.log(p) for p in probs if p > 1e-12) / math.log(k)))


def main() -> None:
    ensure_extra_images()
    tok = Tokenizer.from_file(str(CACHE_DIR / "tokenizer.json"))
    cal = json.loads((CACHE_DIR / "calibration.json").read_text())
    plan = compile_questions(tok, float(cal.get("default", 1.0)))

    vis_sess = ort.InferenceSession(str(CACHE_DIR / "onnx/vision_encoder_q8.onnx"), providers=["CPUExecutionProvider"])
    dec_sess = ort.InferenceSession(str(CACHE_DIR / "onnx/decoder_q4.onnx"), providers=["CPUExecutionProvider"])

    images = sorted(IMG_DIR.glob("*.jpg"))
    print(f"Testing {len(images)} images across {len(plan['questions'])} size formulations...\n")

    rows = []
    for p in images:
        pv = preprocess_image(p)
        num_img = pv.shape[0] * pv.shape[1]
        (feats,) = vis_sess.run(["image_features"], {"pixel_values": pv})

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
                "image_features": feats.astype(np.float32),
                "video_features": np.zeros((0, 2048), dtype=np.float32),
                "question_ids": np.array([q_ids], dtype=np.int64),
                "slot_positions": np.array(slots, dtype=np.int64),
            },
        )

        rec: dict[str, Any] = {"image": p.name}
        for i, q in enumerate(plan["questions"]):
            row = logits[i]
            t = q["temperature"]
            scores = [max(float(row[tid]) for tid in forms) / t for forms in q["readoutIds"]]
            m = max(scores)
            exps = [math.exp(s - m) for s in scores]
            tot = sum(exps)
            probs = [e / tot for e in exps]
            h = norm_h(probs)

            if q["kind"] in ("score", "number"):
                ev = sum(idx * pr for idx, pr in enumerate(probs)) / (len(probs) - 1)
                top = int(np.argmax(probs))
                rec[q["id"]] = {"val": round(ev, 3), "top": q["options"][top], "H": round(h, 3)}
            elif q["kind"] == "choice":
                top = int(np.argmax(probs))
                rec[q["id"]] = {"top": q["options"][top], "p": round(probs[top], 2), "H": round(h, 3)}
            else:
                rec[q["id"]] = {"yes": round(probs[0], 3), "H": round(h, 3)}

        rows.append(rec)
        print(
            f"{p.name:24s} | "
            f"s5={rec['size_5']['val']:.2f}(H={rec['size_5']['H']:.2f}) | "
            f"s7={rec['size_7']['val']:.2f}(H={rec['size_7']['H']:.2f}) | "
            f"s10={rec['size_10']['val']:.2f}(H={rec['size_10']['H']:.2f}) | "
            f"num={rec['size_num_0_100']['val']*100:4.1f}(H={rec['size_num_0_100']['H']:.2f}) | "
            f"cls={rec['size_class']['top']:10s}({rec['size_class']['p']:.2f},H={rec['size_class']['H']:.2f}) | "
            f"mass={rec['mass_5']['val']:.2f} | "
            f"phys={rec['has_physical_scale']['yes']:.2f}"
        )

    print("\n=== SUMMARY DIAGNOSTICS ===")
    for qid in ["size_5", "size_7", "size_10", "size_num_0_100", "mass_5"]:
        vals = [r[qid]["val"] for r in rows]
        hs = [r[qid]["H"] for r in rows]
        print(
            f"  {qid:16s} range={max(vals)-min(vals):.3f} ({min(vals):.2f}..{max(vals):.2f}) "
            f"std={float(np.std(vals)):.3f} | H_mean={float(np.mean(hs)):.3f} H_std={float(np.std(hs)):.3f}"
        )
    cls_tops = [r["size_class"]["top"] for r in rows]
    cls_hs = [r["size_class"]["H"] for r in rows]
    print(
        f"  {'size_class':16s} unique={len(set(cls_tops))}/7 "
        f"topP={float(np.mean([r['size_class']['p'] for r in rows])):.2f} | "
        f"H_mean={float(np.mean(cls_hs)):.3f} ({min(cls_hs):.2f}..{max(cls_hs):.2f})"
    )


if __name__ == "__main__":
    main()
