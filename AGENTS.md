# AGENTS.md

設計・仕様の正は [`docs/SPEC.md`](docs/SPEC.md) と [`docs/adr/`](docs/adr/) とする。

## ADR 運用

アーキテクチャや設計に重要な影響を与える決定（技術選定、モジュール構成、データモデル、API 境界、開発基盤の方針など）を行う場合は、**ADR (Architecture Decision Records)** として `docs/adr/` に記録しながら開発を進めること。

- **フォーマット**: Michael Nygard の「[Documenting Architecture Decisions](http://thinkrelevance.com/blog/2011/11/15/documenting-architecture-decisions)」をベースに、[`docs/adr/0000-template.md`](docs/adr/0000-template.md) をコピーして使用する。
- **配置と命名**: `docs/adr/NNNN-<kebab-case-title>.md`（4桁連番 + 英語ケバブケース、例: `0001-use-bun-and-flake-parts.md`）
- **分量**: 1つの ADR は 1〜2 ページ程度に簡潔にまとめる。
- **変更・撤回**: 過去の ADR の Decision 本文は書き換えず、新しい ADR を作成して元の ADR の `Status` を `Superseded by ADR XXXX`（または `Deprecated`）に更新する。

## 推論パイプライン（最小依存方針）

- 推論ランタイムの依存は **`onnxruntime-web`（`onnxruntime-web/webgpu`、WebGPU 専用）のみ** に絞る（[ADR 0006](docs/adr/0006-minimal-webgpu-inference-for-d1-2b-with-precompiled-prompts.md), [ADR 0011](docs/adr/0011-distilled-vision-head-for-mobile-webgpu.md)）。`@huggingface/transformers`、ランタイム用トークナイザ、WASM フォールバックは導入しない。
- 質問セットを変更する場合は [`scripts/compile-prompts.py`](scripts/compile-prompts.py) を編集して [`src/inference/prompt-plan.json`](src/inference/prompt-plan.json) を再生成し、[`distill/`](distill/README.md) で [`public/models/creature_head.onnx`](public/models/creature_head.onnx) も再蒸留すること（JSON の手編集は禁止）。設問変更時は不確実度レア度閾値の妥当性も確認する（[ADR 0007](docs/adr/0007-creature-parameter-model-and-uncertainty-rarity.md)）。

## 開発・検証コマンド

- 実行環境は `nix develop`（または direnv）上の `bun` を使用する（[ADR 0001](docs/adr/0001-use-bun-and-flake-parts.md)）。
- 実装変更後は `bun test`、`bun run typecheck`、`bun run build` がすべて通ることを確認する。

## UI 原則

- 不要なセカンダリラベルや説明を避ける。レイアウトに説明させる。
