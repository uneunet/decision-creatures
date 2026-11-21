# `distill/` — Knowledge Distillation Pipeline (`d1-2B` → Lightweight Browser Head)

`LiquidAI/d1-2B` の S ランク 11 設問（ソフト確率分布＋不確実度）を、公式 `vision_encoder_q8.onnx`（196 MB）の上に乗る超軽量ヘッド `creature_head.onnx`（4.85 MB）へ KL 蒸留するためのオフライン学習パイプラインです（経緯・設計判断は [`docs/adr/0011-distilled-vision-head-for-mobile-webgpu.md`](../docs/adr/0011-distilled-vision-head-for-mobile-webgpu.md) を参照）。

## ディレクトリ方針
- **`distill/`**（git 管理）: スクリプト・モデル定義のみ
- **`.cache/distill/`**（git 除外）: 収集画像・教師特徴量 `.npz`・仮想環境・チェックポイント・評価レポート
- **`public/models/creature_head.onnx`**: 本番採用モデル（校正温度焼き込み済み ONNX）

## 実行手順（本番 10,000 枚 GPU パイプライン）

```bash
# 0. 未学習 12 枚ベンチマーク用の基準特徴・教師確率を作成 (.cache/distill/val12.npz、初回のみ)
uv run --with onnxruntime --with numpy --with pillow python3 distill/extract_teacher.py --val12-only

# 1. pixparse/cc12m-wds のランダム 20 シャードから完全ランダム 10,000 枚を収集
uv run --with pillow python3 distill/collect_random_cc12m.py --total 10000 --per-shard 500

# 2. GPU (ROCm / CUDA) で教師 LiquidAI/d1-2B (BF16) から Vision 特徴と 11 問ソフト確率を抽出
python distill/extract_teacher_gpu.py \
  --manifest .cache/distill/images_random_manifest.json \
  --out-dir .cache/distill/dataset_random \
  --shard-size 500

# 3. KL 蒸留学習 + 自動温度校正 + ONNX 書き出し + 未学習 12 枚ベンチマーク評価
python distill/train.py \
  --dataset-dir .cache/distill/dataset_random \
  --run-name cc12m_10k \
  --epochs 80 \
  --batch-size 64 \
  --d-model 256 \
  --dropout 0.25

# 4. 本番モデルとして配置
cp .cache/distill/runs/cc12m_10k/creature_head.onnx public/models/creature_head.onnx
```

CPU 環境のみで教師抽出・評価を行う場合は `distill/extract_teacher.py` を利用できます。

## アーキテクチャ & 実績 (`cc12m_10k`)
- **入力**: `image_features` (`float32 [N, 2048]`, `vision_encoder_q8.onnx` 出力)
- **構造**: `Linear(2048→256)` → 11 学習可能クエリによる設問別 4-head Cross-Attention Pooling → 設問間 4-head Self-Attention → Global Mean Pooling 結合 ＋ 11 独立線形ヘッド → 校正済みスカラー温度除算（1,206,588 params / 4.85 MB FP32）
- **出力**: `logits` (`float32 [60]` = 11 問分の校正済み選択肢ロジット連結)
- **損失**: 11 問均等平均の KL Divergence `KL(p_teacher || p_student)`
- **未学習 12 枚ベンチマーク**: カテゴリ一致率 **93.3% (56/60)**、ステータス MAE **2.80**、不確実度相関 **r = 0.907**、校正温度 **T = 1.020**
