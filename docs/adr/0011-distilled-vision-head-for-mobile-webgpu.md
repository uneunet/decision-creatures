# ADR 0011: 公式 Vision Encoder + KL 蒸留軽量ヘッドとシンプルな OPFS キャッシュでモバイル WebGPU 推論を実現する

## Status

Accepted

## Context

[ADR 0006](./0006-minimal-webgpu-inference-for-d1-2b-with-precompiled-prompts.md) では、`LiquidAI/d1-2B-ONNX` の公式 WebGPU ペア（`decoder_q4f16` 1.49 GB + `vision_encoder_q8` 187 MB、計約 1.68 GB）を `onnxruntime-web/webgpu` 単体で実行する方針を採用した。デスクトップ WebGPU では動作した一方、iPhone Safari 実機での検証を進めた結果、以下の段階的な制約と実験結果が得られた。

1. **公式 `d1-2B-ONNX` の iOS Safari 初期化クラッシュ**:
   - `onnxruntime-web` のセッション作成時に `.onnx_data`（1.57 GB）が JS ヒープと GPU バッファへ二重保持される問題に加え、tied 語彙重み（262 MB `lm_head.MatMul.weight_Q8G32`）が ConstantFolding で展開される挙動（`microsoft/onnxruntime#33793`）が重なり、ピーク約 4 GB で即座に Jetsam 強制終了した。
2. **量子化・語彙プルーニング・遅延ロード・Worker 分離による限界実測（iOS Safari 1 GB の壁）**:
   - Decoder と Vision を Q4G128 へ再量子化し、語彙を 65,536 語から固定 11 設問に必要な 490 語へプルーニングして合計 **912 MB**（Vision 102 MB + Decoder 810 MB）まで削減した。
   - さらに OPFS ストリーミングキャッシュ（`FileSystemSyncAccessHandle`）と遅延スライス読み込み `OpfsLazyUint8Array`（`onnxruntime-web` 内部の `Module.md` の `.subarray()` 呼び出しに相乗りする `Uint8Array` サブクラス）により JS ヒープピークを **7.8 MB** まで圧縮し、Vision と Decoder を別 Worker へ分離＋固定シェイプのチャンク推論まで実装して iPhone Safari 実機で計測した。
   - その結果、GPU ライブメモリ **`894.7 MB` では通過し、`1,018.4 MB` に到達した瞬間に `DECODE_FAILED` / Jetsam 終了** となることを実測ログで確認した。iPhone Safari 1 タブの WebGPU 実用上限は **約 1,000 MB** であり、810 MB の汎用 2B 言語デコーダをそのまま載せるアプローチは物理上限に抵触する。
3. **小型公式モデル（`LiquidAI/d1-omni-600M`）の評価と不採用**:
   - 代替として同ライセンスの小型モデル `d1-omni-600M`（475M）を未学習 12 枚ベンチマークで評価したところ、教師 `d1-2B` に対するカテゴリ一致率は **`55.0%`（33/60）**、ステータス MAE **`17.88`**、`SPD` が全画像 70〜78 に張り付き・猫を `botanical` と誤判定するなど、分類のもっともらしさを満たさず不採用とした。
4. **固定 11 設問タスクへの知識蒸留の検証**:
   - 本アプリの推論は自由文生成ではなく、S ランク固定 11 設問（計 60 選択肢、[ADR 0007](./0007-creature-parameter-model-and-uncertainty-rarity.md)）の確率分布推定のみである。したがって、優秀な視覚表現を出力する公式 `vision_encoder_q8.onnx`（196 MB）を残し、16 層の汎用言語デコーダ（810〜1,567 MB）を 11 問専用の軽量ヘッド（約 4.85 MB）へ知識蒸留する構成を検証した。
   - **PoC（600 枚：540 学習 / 60 検証）**: 未学習 12 枚でカテゴリ一致率 `83.3%`（50/60）、Stat MAE `5.63`、不確実度相関 `r = 0.737`。iPhone Safari 実機で 3 連続スキャンを完走し、**キャッシュ起動 0.7 秒・スキャン 1.57 秒（Vision 1.56 秒 + Head 13 ms）・GPU ピーク 403 MB** を確認した。
   - **本番（完全ランダム CC12M 10,000 枚：9,000 学習 / 1,000 検証、RX 9070 XT ROCm 7.2 抽出・80 エポック学習）**: 未学習 12 枚でカテゴリ一致率 **`93.3%`（56/60）**（`archetype 12/12`、他 4 カテゴリ `11/12`）、Stat MAE **`2.80`**、不確実度相関 **`r = 0.907`**、自動温度校正 `T = 1.020`（ONNX 内焼き込み）、PyTorch vs ORT 最大誤差 `2.86e-6` を達成した。
5. **蒸留後のキャッシュ層シンプル化判断**:
   - 最大ファイルが 1.57 GB → **196 MB** に縮小したことで、912 MB Decoder 時代に導入していた `OpfsLazyUint8Array`（`onnxruntime-web` の非公開内部挙動依存）、`WebAssembly.Memory` >1 GiB 回避策、および OPFS + Cache API の三重実装は過剰複雑化（720 行超）かつ将来の ORT アップデート破損リスクとなった。
   - 蒸留後の 196 MB であれば標準の `File.arrayBuffer()` → `Uint8Array` 渡しでも初期化ピークに十分な余裕があり（iPhone Safari 実機でも問題なく動作することを確認済み）、WebGPU 対応ブラウザは OPFS を標準実装しているため、OPFS 単一キャッシュ＋非対応時のインメモリ直接取得に整理できる。
6. **ライセンスおよび配信制約**:
   - `LiquidAI/d1-2B` / `LiquidAI/d1-2B-ONNX` は LFM Open License v1.0（Apache 2.0 ベース、年商 $10M 商業閾値、蒸留禁止条項なし）。`vision_encoder_q8` を公式 HF CDN から直接取得し、自前静的配信を `creature_head.onnx`（4.85 MB、Cloudflare Workers 静的アセット上限 25 MiB 未満）のみとすることで、LiquidAI 重みの再配布を避けつつ v1 のサーバーレス無料運用（[ADR 0002](./0002-client-first-architecture-with-cloudflare-workers.md)）を維持できる。

## Decision

[ADR 0006](./0006-minimal-webgpu-inference-for-d1-2b-with-precompiled-prompts.md) の WebGPU 専用・`onnxruntime-web/webgpu` 単一依存・依存ゼロ画像前処理の方針を継承しつつ、ブラウザ内推論モデル構成およびキャッシュ方式を以下へ置き換える。

1. **モデル構成（約 201 MB）**:
   - **Vision Encoder**: 公式 `LiquidAI/d1-2B-ONNX`（特定リビジョン固定）の `vision_encoder_q8.onnx` + `vision_encoder_q8.onnx_data`（計 196 MB）を Hugging Face CDN から直接取得する。
   - **推論ヘッド**: `LiquidAI/d1-2B` の S ランク 11 設問ソフト確率分布（完全ランダム CC12M 10,000 枚）を KL ダイバージェンスで蒸留した `CreatureDistillHead`（`public/models/creature_head.onnx`、1.2M パラメータ / 4.85 MB、校正温度 `T = 1.020` をグラフ内に焼き込み済み）をアプリの静的アセットとして配信する。
2. **生徒ヘッドアーキテクチャと再現パイプライン**:
   - `vision_encoder_q8` の可変長空間パッチ特徴 `[N, 2048]` を受け取り、`Linear(2048→256)` → 11 学習可能クエリによる設問別 4-head Cross-Attention Pooling → 設問間 4-head Self-Attention → Global Mean Pooling 結合＋11 独立線形層で `[60]` ロジットを一括出力する（カスタム op 不使用の標準 ONNX 構成）。
   - 蒸留コード一式は [`distill/`](../../distill/) 配下に分離管理し、重たい中間データ・画像・チェックポイントは git 除外の `.cache/distill/` に格納する。
3. **シンプルな OPFS ストリーミングキャッシュ（非公開 ORT ハックの不採用）**:
   - モデル保存先は **OPFS** に一本化し、ダウンロード時のみストリーミング書き込み（`FileSystemSyncAccessHandle` 優先・ロック競合時は `createWritable` へフォールバック）＋Content-Type / サイズ検証を行う。OPFS が使えないプライベートブラウジング等では二重の Cache API 実装を持たず、そのままメモリへ 1 回取得して利用する。
   - 読み込みは標準の `File.arrayBuffer()` → `Uint8Array` とし、1.57 GB 時代に検証した `OpfsLazyUint8Array`（`onnxruntime-web` 非公開内部挙動依存）および `WebAssembly.Memory` フォールバックは採用しない。
   - 初期化時・キャッシュ削除時に旧バージョンの `decision-creatures-*`（旧 Cache API を含む）を自動掃除し、端末ストレージの残骸を防ぐ。
4. **画像トークン上限・WebGPU 復旧・後処理互換性**:
   - 画像前処理の既定上限 `DEFAULT_MAX_PIXELS` を蒸留学習時・iPhone 検証時と同じ `262_144`（最大約 256 画像トークン）とし、既存ブラウザの永続設定も `version: 2` マイグレーションで移行する。
   - iOS Safari のバックグラウンド復帰時等に発生する WebGPU `GPUDevice` ロスト（`MapAsyncStatus` 等）に対しては、`InferenceWorkerClient` が Worker を再生成して 1 回自動リトライする。
   - 60 次元出力は `src/inference/prompt-plan.json` の 11 設問定義に沿って `readoutDistilledLogits()` で確率分布へ変換し、[ADR 0007](./0007-creature-parameter-model-and-uncertainty-rarity.md) のステータス導出・不確実度レア度算出ロジックをそのまま適用する（ブラウザ側の未使用 Decoder 入力構築・語彙読み出しコードは削除する）。

## Consequences

### Pros

- 初回ダウンロード容量が **1.76 GB → 約 201 MB（-88.6%）** に縮小し、iPhone Safari を含むモバイル WebGPU 環境でも 1 GB 上限に対して十分な余裕を持って動作する。
- 実機スキャンが **約 1.57 秒（ヘッド推論 13 ms）**、キャッシュ済み起動が **約 1 秒未満** まで高速化される。
- 教師のソフト確率分布丸ごとを KL 蒸留＋温度校正しているため、11 設問の分類もっともらしさ（未学習 12 枚一致率 93.3%、Stat MAE 2.80）だけでなく、複合タイプおよび不確実度レア度（相関 `r = 0.907`）も高精度に再現できる。
- `OpfsLazyUint8Array`・Cache API 二重管理・未使用 Decoder 読み出しコードを持たないため、`onnxruntime-web` のバージョンアップ耐性と保守性が高い。
- Cloudflare Workers の静的配信のみで追加インフラ・R2 運用なしに完結し、LiquidAI 重みの自前再配布も不要。

### Cons

- `vision_encoder_q8.onnx_data`（196 MB）のセッション初期化瞬間のみ JS ヒープと GPU バッファが一時的に重複するため、遅延スライス読み込み時より初期化瞬間ピークが約 +196 MB 増える（初期化完了後に JS バッファは GC 解放される）。
- 質問セット（`scripts/compile-prompts.py` / `src/inference/prompt-plan.json`）を変更する場合、静的 JSON の再生成に加えて [`distill/`](../../distill/) の教師再抽出・蒸留ヘッド再学習と `public/models/creature_head.onnx` の更新が必要になる。
- `public/models/creature_head.onnx`（4.85 MB）をリポジトリへ同梱するため、頻繁なモデル差し替えを行う場合は将来的に外部ストレージや Git LFS への移行検討が必要になる。
- 教師 `d1-2B` の出力と完全にビット一致するわけではなく（未学習 12 枚で 4/60 の差異・不確実度 MAE 0.044）、ごく稀に境界事例で教師と異なる分類やレア度帯になることがある。
