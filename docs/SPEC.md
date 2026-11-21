# decision-creatures 仕様書 (SPEC)

**decision-creatures**（デシクリ）は、ユーザーのブラウザ上でマルチモーダル意思決定モデル **LiquidAI/d1-2B** を実行し、画像からクリーチャーの「タイプ」および「ステータス」を判定して生成・コレクション・バトルさせる Web アプリケーションである。

---

## 1. プロダクト方針とフェーズ構成

### Phase 0: Web Worker 検証・モデル実験（完了）

アプリ UI の本実装に先立ち、推論用 **Web Worker** の最小構成および実モデル実験を完了した（詳細: [`docs/experiment-phase0.md`](experiment-phase0.md)）。

1. **WebGPU 推論パイプラインの構築**: `onnxruntime-web/webgpu` による `LiquidAI/d1-2B-ONNX`（`decoder_q4f16` + `vision_encoder_q8`）のロード・Cache API キャッシュ・依存ゼロ画像前処理・事前コンパイル済み 11 問 JSON による 1 forward 推論 Web Worker を実装済み。
2. **質問設計と判定ロジックの確定**: 実画像 12 枚に対する 23 候補の実測比較から、S ランク 11 設問・材質×環境タイプ体系・HP/DEF 物理導出・不確実度レア度を確定した（[ADR 0007](adr/0007-creature-parameter-model-and-uncertainty-rarity.md)）。

### v1 (MVP): ブラウザ完結型コレクション

- **サーバーサイド処理なし**: 画像の読み込みや推論、データ保存をすべてユーザーのブラウザ内で完結させる。
- **コア体験**:
  1. 初回起動時にブラウザへモデル重みをロード・キャッシュする。
  2. ユーザーが任意の画像を読み込む（カメラ撮影・ファイル選択・ドラッグ＆ドロップ）。
  3. Web Worker 上の `LiquidAI/d1-2B` が画像を 1 forward で解析し、タイプとステータスを判定する。
  4. 生成されたクリーチャーをローカル DB に保存し、コレクションとして閲覧・管理できる。

### v2 以降: バトル実装とサーバーサイド拡張

- **バトル機能実装時にサーバーを導入**: バトルロジックの正当性担保（改ざん防止）、対戦履歴やユーザー/クリーチャー情報の共有のため、バトル機能とあわせてサーバーサイド処理を実装する。
- Cloudflare Workers を軸に、構造化データに **Cloudflare D1**、画像などのオブジェクトデータに **Cloudflare R2** を追加する（モデル重みの R2 ミラー配信も必要に応じ v2 以降で検討する）。

---

## 2. 技術スタック

| 領域 | 採用技術 | 役割・方針 |
| --- | --- | --- |
| ビルド / UI | Vite + React | SPA 構築・高速な開発体験 |
| ルーティング | TanStack Router (`@tanstack/react-router`) | 型安全な SPA ルーティング・Search Params 管理（コードベース定義、[ADR 0009](adr/0009-client-routing-with-tanstack-router.md)） |
| 状態管理 | Zustand | UI 状態、推論ステート、モーダル・選択状態の管理 |
| ローカル DB | Dexie.js | IndexedDB を用いたクリーチャー・画像 Blob の永続化 |
| AI 推論 | LiquidAI/d1-2B Vision (`vision_encoder_q8`) + 蒸留ヘッド (`creature_head.onnx`) + `onnxruntime-web/webgpu` + Web Worker | WebGPU 専用・単一依存・モバイル対応の軽量ブラウザ内推論（計約 201 MB、[ADR 0011](adr/0011-distilled-vision-head-for-mobile-webgpu.md)） |
| スタイリング / アニメーション | Tailwind CSS + Motion | フラットポップな独自デザインシステムと滑らかなモーション（[ADR 0008](adr/0008-headless-base-ui-and-flat-pop-design-system.md)） |
| UI プリミティブ / アイコン | Base UI (`@base-ui/react`) + `lucide-react` | ヘッドレスコンポーネント基盤＋統一アイコンセットで全見た目を独自フラットポップへ統一（[ADR 0008](adr/0008-headless-base-ui-and-flat-pop-design-system.md), [ADR 0010](adr/0010-v1-collection-first-ui-flow-and-local-card-export.md)） |
| ホスティング | Cloudflare Workers | v1 は静的配信、v2 以降は API / バトル処理も担う |
| サーバー DB / ストレージ（v2+） | Cloudflare D1 / Cloudflare R2 | バトル・共有用データ（D1）と画像アセット（R2）の永続化 |

---

## 3. UI / デザイン原則

- **レイアウトに説明させる**: 不要なセカンダリラベル、冗長な注釈、説明テキストを置かず、視覚的階層・タイポグラフィ・余白・モーションによって役割が直感的に伝わる設計にする。
- **独自スタイリングとヘッドレス UI 基盤の徹底**: 既製スタイルに依存せず、`@base-ui/react`（Base UI）のヘッドレスプリミティブ＋Tailwind CSS＋Motion で全コンポーネントの雰囲気を統一する（[ADR 0008](adr/0008-headless-base-ui-and-flat-pop-design-system.md)）。ぼかしドロップシャドウ・グロー・グラデーションを排したフラットポップ表現（単色面・属性連動カラー・下端リップ・ギザギザ切手シール風レア度表記）を基準とする。
- **非ブロッキング体験**: モデルロードや推論中も UI アニメーションや操作応答性を維持する。

---

## 4. アーキテクチャ概要

### 4.1 v1 (MVP) 構成

```text
[Browser Main Thread]
  React + Vite + TanStack Router
   ├── Zustand (UI / Inference / Collection Store)
   ├── Tailwind CSS + Motion + Base UI (@base-ui/react)
   └── Dexie.js (IndexedDB: Creatures, Image Blobs)
         ▲
         │ postMessage (Image / Inference Result / Progress)
         ▼
[Web Worker]
  onnxruntime-web/webgpu (WebGPU 専用)
   ├── 自前画像前処理 (Lfm3VlImageProcessor 互換・依存ゼロ)
   ├── 11 設問定義 JSON (`prompt-plan.json`・トークナイザ不要)
   ├── 公式 `vision_encoder_q8` (196 MB, HF CDN リビジョン固定 + OPFS キャッシュ)
   └── 蒸留ヘッド `creature_head.onnx` (4.85 MB, 静的配信 + OPFS キャッシュ)
```

### 4.2 v2 以降（バトル実装時）の構成拡張

```text
[Browser] ──(HTTPS / API)──▶ [Cloudflare Workers]
                                ├── Battle Engine / API
                                ├── Cloudflare D1 (クリーチャー・対戦履歴・ランキング等)
                                └── Cloudflare R2 (共有用画像アセット)
```

---

## 5. 機能仕様

### 5.1 AI 推論・クリーチャー生成（v1）

- **使用モデル（[ADR 0011](adr/0011-distilled-vision-head-for-mobile-webgpu.md)）**:
  - **Vision Encoder**: 公式 `LiquidAI/d1-2B-ONNX`（特定コミット SHA 固定）の **`vision_encoder_q8`（196 MB）** を Hugging Face CDN から直接取得する。
  - **蒸留ヘッド**: `LiquidAI/d1-2B` の S ランク 11 設問ソフト確率分布（完全ランダム CC12M 10,000 枚）を KL 蒸留した **`creature_head.onnx`（4.85 MB、校正温度焼き込み済み）** をアプリ静的アセット（`/models/creature_head.onnx`）として配信する（合計約 201 MB）。
- **実行方式（WebGPU 専用・最小依存・モバイル対応）**:
  - 推論処理とモデル管理はすべて専用 **Web Worker** 内で **`onnxruntime-web/webgpu`** のみを用いて実行する（`@huggingface/transformers` 等の追加推論ライブラリは導入しない）。
  - **WebGPU 専用**とし、WASM フォールバックは実装しない。WebGPU 非対応環境では起動時に非対応である旨を案内する。
  - `vision_encoder_q8` が出力する空間パッチ特徴 `[N, 2048]` を `creature_head.onnx` へ 1 パス入力し、S ランク 11 設問（計 60 選択肢）の校正済みロジットを一括取得する。
- **11 設問定義と後処理**:
  - 確定した **S ランク 11 設問**（英語、`choice` 4 問 + `noul` 1 問 + `score` 6 問、計 60 選択肢）の定義は [`src/inference/prompt-plan.json`](../src/inference/prompt-plan.json)（[`scripts/compile-prompts.py`](../scripts/compile-prompts.py) で生成）を正とする。
  - ランタイムはトークナイザを持たず、`creature_head.onnx` が出力する 60 次元ロジットを 11 設問ごとにスライスして softmax 読み出しを行う。
- **タイプ・ステータス・レア度の決定仕様（[ADR 0007](adr/0007-creature-parameter-model-and-uncertainty-rarity.md)）**:
  - **主タイプ（バトル相性軸）**: `substance`（7 材質: `flesh` / `botanical` / `metal` / `stone` / `liquid` / `fabric` / `energy`）。確率 2 位が 20% 以上なら複合タイプとする。
  - **副タイプ（環境）**: `biome`（6 環境: `wild` / `aquatic` / `urban` / `sky` / `abyss` / `cosmos`）。
  - **クラス（役割）**: `archetype`（6 クラス: `beast` / `guardian` / `spirit` / `construct` / `flora` / `trickster`）。
  - **体格区分**: `size_class`（`tiny` / `handheld` / `human` / `vehicle` / `monument` / `colossal` / `intangible`）。
  - **ステータス（1〜100 正規化）**:
    - `ATK` ← `power`、`SPD` ← `agility`、`SP` ← `mystique`
    - `HP` ← `size_7`（45%）+ `mass_5`（35%）+ `is_living`（10%）+ `warmth`（10%）
    - `DEF` ← `mass_5`（45%）+ 密度 `(mass_5 - size_7 + 1)/2`（25%）+ `substance` 確率重み付け硬度（30%）
  - **レア度（不確実度算出）**: 11 問の正規化シャノンエントロピー $H_{\text{norm}}$ から合成不確実度 $U = 0.6 H_{\text{type}} + 0.4 H_{\text{scalar}}$ を算出し、`COMMON` / `UNCOMMON` / `RARE` / `EPIC` / `MYTHIC` の 5 段階を決定する。
- **モデル配信とキャッシュ**:
  - `vision_encoder_q8` は Hugging Face CDN（リビジョン固定）、`creature_head.onnx` は同一オリジン静的配信から取得し、ブラウザの **OPFS**（ストリーミング保存＋標準 `File.arrayBuffer()` 読込、OPFS 非対応時はインメモリ取得）へキャッシュする。あわせて `navigator.storage.persist()` の要求と旧キャッシュの自動掃除を行う。
  - ダウンロード進捗・セッション初期化状態・エラー（WebGPU 非対応・容量不足・ネットワーク失敗）を Zustand 経由で UI に反映する。

### 5.2 画像入力・スキャン体験（v1）

- ファイル選択、ドラッグ＆ドロップ、クリップボード貼り付け、モバイル等のカメラ入力に対応する（`/scan`）。
- 推論前にカード写真枠内でドラッグ／ズームのクロップ調整を行い、切り出した画像を軽量化して推論入力および保存用 `imageBlob` として利用する（[ADR 0010](adr/0010-v1-collection-first-ui-flow-and-local-card-export.md)）。
- 初回かつローカルキャッシュ未保存時のみ、約 200 MB のモデル保存を一言確認してからカード枠内でダウンロード進捗を表示する。
- 推論用前処理は Web Worker 内で `Lfm3VlImageProcessor` 互換処理（`smart_resize`・リサイズ・`[-1, 1]` 正規化・パッチ化）をブラウザ標準 API のみで実行する。
- v1 では画像は外部サーバーへ送信されず、ユーザーの端末内のみで処理される。

### 5.3 コレクション・詳細・共有（v1）

- `/` をコレクション起点とし、生成したクリーチャーを Dexie.js（IndexedDB）へ自動保存してコンパクト S1 カードのレスポンシブグリッド（スマホ 2 列／PC 3〜4 列）で表示する（0 件時はスキャン枠を表示）。
- 属性ピル横並び 1 行＋レア度／ソート用ポップオーバー（Search Params `?type=&rarity=&sort=` 同期）を提供する。
- `/creatures/$id` でフルサイズ S1 カードの 3D 反転・11 設問スコア詳細・名前変更・削除確認に加え、表面＋裏面を 2 枚並べた PNG 画像のクライアント書き出し（画像保存・Web Share API 共有）を提供する。
- ライト／ダークテーマ切替に対応し、全画面でヘッダーはロゴ＋`≡` メニュー固定とする。
- コレクション状態はアプリ再起動後もローカルに保持される。

### 5.4 バトル機能（v2 以降）

- v1 のデータ構造（タイプ・ステータス）をそのままバトルへ接続できるよう設計する。
- バトル実装時に Cloudflare Workers 上で対戦判定・マッチング/同期処理を行い、関連データを D1、共有画像を R2 へ保存する。

---

## 6. ローカルデータモデル概要（Dexie.js / v1）

IndexedDB 上に以下のストアを定義する（詳細スキーマおよび `scores` のキー構造は Phase 0 の実験結果を受けて確定）。

- `creatures`:
  - `id`: 一意な識別子（UUID 等）
  - `name`: クリーチャー名（初期値またはユーザー編集）
  - `types`: 主タイプ・副タイプ配列（`substance` 1〜2 種）
  - `biome`: 環境タイプ（`biome`）
  - `archetype`: クラス（`archetype`）
  - `sizeClass`: 体格区分（`size_class`）
  - `rarity`: 不確実度から算出したレア度（`tier`, `uncertainty`）
  - `stats`: ステータスオブジェクト（`hp`, `atk`, `def`, `spd`, `sp`）
  - `traits`: 物理・性格スカラー（`size`, `mass`, `density`, `warmth`, `isLiving`）
  - `scores`: `LiquidAI/d1-2B` が出力した 11 設問の判定確率分布（再計算・カード表現用）
  - `imageBlob`: 保存用画像 Blob
  - `createdAt`: 生成日時

---

## 7. 関連 ADR

技術選定およびアーキテクチャ方針の詳細は [`docs/adr/`](adr/) を参照。

- [ADR 0001: 開発基盤に Bun と flake-parts を採用する](adr/0001-use-bun-and-flake-parts.md)
- [ADR 0002: v1 はブラウザ完結とし、Cloudflare Workers を基盤に段階的拡張する](adr/0002-client-first-architecture-with-cloudflare-workers.md)
- [ADR 0003: ブラウザ内推論に LFM3-d1-2B と ONNX Runtime + Web Worker を採用する](adr/0003-browser-inference-with-lfm3-d1-2b-and-onnx-runtime-web-worker.md)（Superseded by ADR 0006）
- [ADR 0004: フロントエンド基盤に Vite・React・Zustand・Dexie.js を採用する](adr/0004-frontend-stack-vite-react-zustand-dexie.md)
- [ADR 0005: UI 構築に Tailwind CSS・Motion を主軸とし shadcn/ui を最小限に利用する](adr/0005-ui-styling-with-tailwind-motion-and-minimal-shadcn.md)（Superseded by ADR 0008）
- [ADR 0006: LiquidAI/d1-2B を onnxruntime-web/webgpu 単体と事前コンパイル済みプロンプトで実行する](adr/0006-minimal-webgpu-inference-for-d1-2b-with-precompiled-prompts.md)（Superseded by ADR 0011）
- [ADR 0007: S ランク 11 設問による材質・環境タイプ体系、物理導出ステータス、不確実度レア度を採用する](adr/0007-creature-parameter-model-and-uncertainty-rarity.md)
- [ADR 0008: ヘッドレス UI 基盤に Base UI (`@base-ui/react`) を採用し、フラットポップなデザインシステムで統一する](adr/0008-headless-base-ui-and-flat-pop-design-system.md)
- [ADR 0009: クライアントサイド SPA ルーティングに TanStack Router（コードベース定義）を採用する](adr/0009-client-routing-with-tanstack-router.md)
- [ADR 0010: v1 UI フローをコレクション起点（`/`）・クロップ付きスキャン（`/scan`）・表裏 PNG 共有＋ライト／ダーク対応で確定する](adr/0010-v1-collection-first-ui-flow-and-local-card-export.md)
- [ADR 0011: 公式 Vision Encoder + KL 蒸留軽量ヘッドとシンプルな OPFS キャッシュでモバイル WebGPU 推論を実現する](adr/0011-distilled-vision-head-for-mobile-webgpu.md)
