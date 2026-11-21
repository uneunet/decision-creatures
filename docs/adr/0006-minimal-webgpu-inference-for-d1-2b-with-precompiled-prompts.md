# ADR 0006: LiquidAI/d1-2B を onnxruntime-web/webgpu 単体と事前コンパイル済みプロンプトで実行する

## Status

Accepted

## Context

[ADR 0003](./0003-browser-inference-with-lfm3-d1-2b-and-onnx-runtime-web-worker.md) では仮称「LFM3-d1-2B」を対象に WebGPU / WASM フォールバック両対応の ONNX Runtime 推論を定めていた。しかし、実モデル `LiquidAI/d1-2B`（公式 ONNX リポジトリ: `LiquidAI/d1-2B-ONNX`）の仕様とホストコードを精査した結果、以下の事実と最小化の余地が明らかになった。

- `d1-2B-ONNX` は Transformers.js のパイプライン非対応であり、ブラウザでは `onnxruntime-web/webgpu`（native WebGPU EP）で直接実行する必要がある。公式が WebGPU 向けに推奨する組み合わせは `decoder_q4f16`（1.49 GB）と `vision_encoder_q8`（187 MB）のペア（計約 1.68 GB、1 行 8,192 トークン未満）である。
- 2B クラスのモデルを WASM バックエンドで実行すると実用的な応答速度を得にくく、フォールバックを維持すると CPU 向け量子化（`decoder_q4`、1.85 GB・4,096 トークン上限）の出し分けや分岐実装が増える。
- 一方、本アプリがモデルへ渡す動的入力はユーザーが選んだ画像のみであり、質問セット（`choice` / `noul` / `score`、1 forward 最大 16 問）はアプリ側で固定できる。それにもかかわらず、公式の Python ホストコード（約 3,000 行）を TypeScript へ全面移植したり、トークナイザと画像前処理だけのために `@huggingface/transformers` や `tokenizer.json`（17 MB）をランタイム依存へ加えるのは過剰である。
- 画像前処理（`Lfm3VlImageProcessor`）の実体は `smart_resize`（32 の倍数丸め）・リサイズ・`[-1, 1]` 正規化・パッチ並べ替えのみであり、ブラウザ標準 API だけで小さく実装できる。
- v1 はサーバーサイド機能を持たない静的配信（[ADR 0002](./0002-client-first-architecture-with-cloudflare-workers.md)）を前提としており、初回から Cloudflare R2 に自前ミラー配信基盤を構築すると実装・運用負荷が増える。

## Decision

[ADR 0003](./0003-browser-inference-with-lfm3-d1-2b-and-onnx-runtime-web-worker.md) を置き換え、ブラウザ内推論パイプラインを以下の最小構成に統一する。

1. **モデルと量子化**: `LiquidAI/d1-2B-ONNX` の WebGPU 推奨ペアである `decoder_q4f16` + `vision_encoder_q8`（計約 1.68 GB）の 1 構成に絞る。
2. **ランタイムと WebGPU 専用化**: 推論ライブラリの依存は **`onnxruntime-web`（`onnxruntime-web/webgpu`）のみ** とし、専用 **Web Worker** 内で実行する。WASM フォールバックは実装せず、WebGPU 非対応環境では非対応案内を表示する。
3. **事前コンパイル済みプロンプト**: 固定質問セット（英語、`choice` / `noul` / `score`、1 forward ≤ 16 問）のトークン ID 列・`question_ids`・`slot_positions` 相対位置・各選択肢の `readout_ids`・`calibration.json` の温度パラメータを、開発時に公式 Python コードで静的 JSON に事前コンパイルしてリポジトリへ同梱する。ランタイムにトークナイザおよび `tokenizer.json` を持たず、画像の `<|image|>` トークン数に応じた配列結合と温度付き softmax 読み出しのみを実装する。
4. **依存ゼロの画像前処理**: `Lfm3VlImageProcessor` 互換の前処理（`smart_resize`・リサイズ・正規化・パッチ化）をブラウザ標準 API（`createImageBitmap` / `OffscreenCanvas` / TypedArray）のみで自前実装する。
5. **v1 のモデル配信とキャッシュ**: モデル重みは Hugging Face CDN から特定コミット SHA（リビジョン）を固定して直接取得し、ブラウザの Cache API（あわせて `navigator.storage.persist()` を要求）へキャッシュする。Cloudflare R2 への自前ミラーは v2 以降の検討とする。

## Consequences

### Pros

- 推論レイヤの外部依存が `onnxruntime-web` 1 本に絞られ、ホストコードの TypeScript 移植量も最小限（画像前処理・配列結合・読み出しの数百行未満）に収まる。
- 公式 Python コードでプロンプトを事前コンパイルするため、トークナイズや特殊トークン配置のパリティ不一致を防げるうえ、17 MB の `tokenizer.json` 配信も不要になる。
- WebGPU 専用かつ 1 量子化ペアに絞ることで、モデル選択・バックエンド切替・検証マトリクスの複雑さを排除できる。
- v1 でモデル配信用のサーバー・R2 ミラー運用を持たずに済む。

### Cons

- WebGPU 非対応ブラウザ・端末では推論を実行できない。
- 質問文を変更するたびに、開発環境で公式 Python コードによる静的 JSON の再生成が必要になる。動的なユーザー自由文入力をモデルへ渡す要件が生じた場合は、後からランタイム用トークナイザを追加する必要がある。
- v1 のモデル初回ダウンロードは Hugging Face CDN の可用性・帯域に依存する。
- `OffscreenCanvas` 等を用いたブラウザ側リサイズは Python（PIL / torchvision の bicubic）と画素値が微小に異なり得るため、Phase 0 の Web Worker 検証で実画像による出力挙動を確認する必要がある。
