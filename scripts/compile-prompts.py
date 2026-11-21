#!/usr/bin/env python3
"""Offline prompt compiler for LiquidAI/d1-2B-ONNX (v1 finalized 11-question S-rank set).

Generates `src/inference/prompt-plan.json` using the exact tokenizer,
ChatML/d1 prompt formatting (`prompt.py` / `attention.py` / `lfm3.py`),
and calibration temperatures (`calibration.json`) from `LiquidAI/d1-2B-ONNX`.
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path
from typing import Any

from tokenizers import Tokenizer

REPO = "LiquidAI/d1-2B-ONNX"
REVISION = "2fd61486312020c30a1e3aa5aa677424672b2b37"
CACHE_DIR = Path(".cache/d1-2B-ONNX") / REVISION
OUT_PATH = Path("src/inference/prompt-plan.json")

IM_START = "<|im_start|>"
IM_END = "<|im_end|>"
BOS = "<|startoftext|>"
VISION_START = "<|vision_start|>"
IMAGE_TOKEN = "<|image|>"
VISION_END = "<|vision_end|>"
LFM3_LEAD = "<think></think>"

LETTERS = tuple(chr(ord("A") + i) for i in range(26))
YES_FORMS = ("yes", "Yes", "YES")
NO_FORMS = ("no", "No", "NO")

# Finalized v1 11-question S-rank set (1 forward pass; d1_set_size = 16).
# Categorical (5): substance (primary type), biome (environment), archetype (class), size_class, is_living
# Scalar (6): size_7, mass_5, power (ATK), agility (SPD), mystique (SP), warmth
# HP and DEF are derived deterministically from size_7, mass_5, substance, is_living, warmth.
# Rarity is derived from predictive uncertainty (normalized Shannon entropy) across all 11 questions.
QUESTIONS: list[dict[str, Any]] = [
    # --- Categorical / Type axes (5 questions) ---
    {
        "id": "substance",
        "label": "材質タイプ",
        "group": "type",
        "kind": "choice",
        "instructions": "What is the primary physical substance or material of the main subject in this image?",
        "criteria": {
            "flesh": "Living animal, human, insect, fur, feathers, or biological skin",
            "botanical": "Plant, tree, leaf, flower, wood, moss, or organic foliage",
            "metal": "Metal, machinery, electronics, hard plastic, or manufactured hardware",
            "stone": "Rock, stone, brick, concrete, ceramic, soil, or mineral",
            "liquid": "Water, liquid, ice, snow, transparent glass, or crystal",
            "fabric": "Cloth, fabric, paper, plush, food, or soft deformable matter",
            "energy": "Light, fire, sky, clouds, smoke, screen glow, or abstract graphics",
        },
    },
    {
        "id": "biome",
        "label": "生息域",
        "group": "type",
        "kind": "choice",
        "instructions": "Which environment or domain best matches the setting and atmosphere of this image?",
        "criteria": {
            "wild": "Forest, meadow, garden, mountains, or untamed outdoor nature",
            "aquatic": "Ocean, river, rain, snow, ice, or wet environment",
            "urban": "Indoors, room, desk, street, architecture, or human-made space",
            "sky": "Open sky, clouds, sunlight, high altitude, or airy space",
            "abyss": "Dark night, cave, deep shadow, dim lighting, or eerie underground",
            "cosmos": "Abstract, digital, neon, surreal, or otherworldly void",
        },
    },
    {
        "id": "archetype",
        "label": "クラス",
        "group": "type",
        "kind": "choice",
        "instructions": "Which creature archetype best matches the silhouette, posture, and visual character of this image?",
        "criteria": {
            "beast": "Predatory, wild, agile, or animal-like creature",
            "guardian": "Heavy, armored, sturdy, fortress-like, or defensive colossus",
            "spirit": "Ethereal, glowing, floating, ghostly, or intangible entity",
            "construct": "Mechanical, geometric, artificial, or tool-like golem",
            "flora": "Rooted, blooming, organic botanical or fungal being",
            "trickster": "Small, quirky, mischievous, playful, or chaotic imp",
        },
    },
    {
        "id": "size_class",
        "label": "体格区分",
        "group": "type",
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
    {
        "id": "is_living",
        "label": "生物判定",
        "group": "type",
        "kind": "noul",
        "instructions": "Is the primary subject of this image a living organism (such as an animal, plant, human, or insect)?",
        "criteria": {
            "true": "A living organism is the main focus",
            "false": "An inanimate object, scenery, abstract art, or man-made item is the main focus",
        },
    },
    # --- Scalar axes (6 questions) ---
    {
        "id": "size_7",
        "label": "大きさ (対数7段階)",
        "group": "scalar",
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
    {
        "id": "mass_5",
        "label": "重さ (対数5段階)",
        "group": "scalar",
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
    {
        "id": "power",
        "label": "攻撃性 (ATK)",
        "group": "scalar",
        "kind": "score",
        "instructions": "Rate the visual sense of offensive power, sharpness, danger, or destructive force in this image.",
        "criteria": [
            "Completely harmless, soft, and passive",
            "Mild and gentle with minimal threat",
            "Moderate force or noticeable tension",
            "Strong, sharp, imposing, or dangerous",
            "Overwhelmingly fierce, lethal, or explosive",
        ],
    },
    {
        "id": "agility",
        "label": "敏捷性 (SPD)",
        "group": "scalar",
        "kind": "score",
        "instructions": "Rate the visual sense of speed, sleekness, motion, lightness, and nimbleness.",
        "criteria": [
            "Completely static, rooted, and ponderous",
            "Slow, settled, or heavy-looking",
            "Neutral everyday mobility",
            "Sleek, dynamic, swift, or nimble",
            "Blazing fast, aerodynamic, or darting motion",
        ],
    },
    {
        "id": "mystique",
        "label": "神秘性 (SP)",
        "group": "scalar",
        "kind": "score",
        "instructions": "Rate how supernatural, arcane, surreal, or otherworldly this image feels.",
        "criteria": [
            "Completely mundane, ordinary, and everyday",
            "Mostly ordinary with a slight interesting twist",
            "Moderately atmospheric or imaginative",
            "Distinctly magical, eerie, or dreamlike",
            "Deeply surreal, cosmic, or otherworldly",
        ],
    },
    {
        "id": "warmth",
        "label": "親しみ (WARMTH)",
        "group": "scalar",
        "kind": "score",
        "instructions": "Rate how friendly, cute, or inviting versus cold, scary, or intimidating this image feels.",
        "criteria": [
            "Deeply cold, hostile, or intimidating",
            "Aloof, stark, or slightly unsettling",
            "Neutral and objective",
            "Warm, pleasant, or approachable",
            "Irresistibly cute, cozy, and friendly",
        ],
    },
]


def ensure_file(filename: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    target = CACHE_DIR / filename
    if not target.exists():
        url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{filename}"
        print(f"Downloading {url} -> {target}")
        urllib.request.urlretrieve(url, target)
    return target


def encode_ids(tok: Tokenizer, text: str) -> list[int]:
    return list(tok.encode(text, add_special_tokens=False).ids)


def single_token_ids(tok: Tokenizer, forms: tuple[str, ...] | list[str]) -> list[int]:
    out: list[int] = []
    seen: set[int] = set()
    for form in forms:
        ids = encode_ids(tok, form)
        if len(ids) == 1 and ids[0] not in seen:
            out.append(ids[0])
            seen.add(ids[0])
    return out


def question_block(q: dict[str, Any]) -> tuple[str, list[str], list[list[str]]]:
    kind = q["kind"]
    inst = q["instructions"]
    if kind == "choice":
        labels = list(q["criteria"].keys())
        codes = list(LETTERS[: len(labels)])
        lines = "\n".join(
            f"{code} {q['criteria'][lab] or lab.replace('_', ' ')}"
            for code, lab in zip(codes, labels)
        )
        block = f"{inst}\n\nOptions:\n{lines}\n\nReply with the option code only."
        return block, labels, [[code] for code in codes]
    if kind == "noul":
        extra = ""
        if q.get("criteria"):
            extra = f"\nYes: {q['criteria']['true']}\nNo: {q['criteria']['false']}"
        block = f"{inst}{extra}\n\nReply with yes or no only."
        return block, ["yes", "no"], [list(YES_FORMS), list(NO_FORMS)]
    if kind == "score":
        criteria = q["criteria"]
        legend = "\n".join(f"{i} {name}" for i, name in enumerate(criteria))
        block = f"{inst}\n\n{legend}\n\nReply with a single digit 0-{len(criteria) - 1} only."
        return block, [str(i) for i in range(len(criteria))], [[str(i)] for i in range(len(criteria))]
    raise ValueError(f"Unsupported question kind: {kind}")


def main() -> None:
    assert len(QUESTIONS) <= 16, f"d1_set_size is 16, got {len(QUESTIONS)}"

    tok_path = ensure_file("tokenizer.json")
    cal_path = ensure_file("calibration.json")
    cfg_path = ensure_file("config.json")

    tok = Tokenizer.from_file(str(tok_path))
    calibration = json.loads(cal_path.read_text())
    config = json.loads(cfg_path.read_text())

    default_temp = float(calibration.get("default", 1.0))
    temperatures: dict[str, float] = calibration.get("temperatures", {})

    def cal_bucket(kind: str, k: int) -> str:
        if kind == "noul":
            return "noul"
        if kind == "score":
            return f"score:{k}"
        if k <= 3:
            return "choice:small"
        if k <= 8:
            return "choice:mid"
        if k <= 26:
            return "choice:large"
        return "choice:inventory"

    prefix_before_str = f"{BOS}{IM_START}user\n{VISION_START}"
    prefix_after_str = f"{VISION_END}"
    prefix_before_ids = encode_ids(tok, prefix_before_str)
    prefix_after_ids = encode_ids(tok, prefix_after_str)
    image_token_ids = encode_ids(tok, IMAGE_TOKEN)
    assert image_token_ids == [config["image_token_id"]]
    image_token_id = image_token_ids[0]

    suffix_ids: list[int] = []
    suffix_question_ids: list[int] = []
    slot_offsets: list[int] = []
    compiled_questions: list[dict[str, Any]] = []

    first_suffix_text = ""
    for idx, q in enumerate(QUESTIONS, start=1):
        block, options, raw_forms = question_block(q)
        suffix_text = f"{block}{IM_END}\n{IM_START}assistant\n{LFM3_LEAD}"
        if idx == 1:
            first_suffix_text = suffix_text
        own_ids = encode_ids(tok, suffix_text)

        readout_ids: list[list[int]] = []
        if q["kind"] == "choice":
            for forms in raw_forms:
                code = forms[0]
                tids = single_token_ids(tok, [code, f" {code}"])
                assert tids, f"No single-token ID for option {code}"
                readout_ids.append(tids)
        elif q["kind"] == "noul":
            yes_ids = single_token_ids(tok, YES_FORMS)
            no_ids = single_token_ids(tok, NO_FORMS)
            assert yes_ids and no_ids
            readout_ids = [yes_ids, no_ids]
        elif q["kind"] == "score":
            for forms in raw_forms:
                tids = single_token_ids(tok, forms)
                assert tids, f"No single-token ID for score digit {forms}"
                readout_ids.append(tids)

        suffix_ids.extend(own_ids)
        suffix_question_ids.extend([idx] * len(own_ids))
        slot_offsets.append(len(suffix_ids) - 1)

        bucket = cal_bucket(q["kind"], len(options))
        temp = float(temperatures.get(bucket, default_temp))
        compiled_questions.append(
            {
                "id": q["id"],
                "label": q["label"],
                "group": q["group"],
                "kind": q["kind"],
                "options": options,
                "optionDescriptions": (
                    q["criteria"]
                    if isinstance(q.get("criteria"), dict)
                    else {str(i): desc for i, desc in enumerate(q["criteria"])}
                ),
                "readoutIds": readout_ids,
                "temperature": temp,
            }
        )

    dummy_full = encode_ids(
        tok, f"{prefix_before_str}{IMAGE_TOKEN * 4}{prefix_after_str}{first_suffix_text}"
    )
    first_len = slot_offsets[0] + 1
    expected_full = prefix_before_ids + [image_token_id] * 4 + prefix_after_ids + suffix_ids[:first_len]
    assert dummy_full == expected_full, "BPE boundary mismatch!"

    plan = {
        "schemaVersion": 2,
        "modelRepo": REPO,
        "revision": REVISION,
        "vocabSize": config["text_config"]["vocab_size"],
        "hiddenSize": config["text_config"]["hidden_size"],
        "d1SetSize": config["d1_set_size"],
        "maxPixels": config["d1_vision_max_pixels"],
        "patchSize": config["vision_config"]["patch_size"],
        "mergeSize": config["vision_config"]["spatial_merge_size"],
        "temporalPatchSize": config["vision_config"]["temporal_patch_size"],
        "imageTokenId": image_token_id,
        "prefixBeforeImage": prefix_before_ids,
        "prefixAfterImage": prefix_after_ids,
        "suffixIds": suffix_ids,
        "suffixQuestionIds": suffix_question_ids,
        "slotOffsets": slot_offsets,
        "questions": compiled_questions,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n")
    print(
        f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes) | "
        f"questions={len(compiled_questions)} | "
        f"prefix={len(prefix_before_ids)}+{len(prefix_after_ids)} tok | "
        f"suffix={len(suffix_ids)} tok"
    )


if __name__ == "__main__":
    main()
