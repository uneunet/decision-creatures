# TODO

設計の正は [`docs/SPEC.md`](SPEC.md) と [`docs/adr/`](adr/) を参照。

---

## Phase 0: 推論基盤・パラメータ実験

- [x] `LiquidAI/d1-2B-ONNX` 最小推論構成の確定（[ADR 0006](adr/0006-minimal-webgpu-inference-for-d1-2b-with-precompiled-prompts.md)）
- [x] 事前コンパイルスクリプト（[`scripts/compile-prompts.py`](../scripts/compile-prompts.py)）と静的 JSON 出力
- [x] `onnxruntime-web/webgpu` 専用 Web Worker・依存ゼロ画像前処理・Cache API 実装
- [x] 実モデルでの 23 候補パラメータ検証・物体の大きさ実験・不確実度レア度キャリブレーション（[`docs/experiment-phase0.md`](experiment-phase0.md), [ADR 0007](adr/0007-creature-parameter-model-and-uncertainty-rarity.md)）
- [x] S ランク 11 設問・材質×環境タイプ体系・HP/DEF 物理導出への統一と単体テスト
- [ ] WebGPU 対応ブラウザ実機での動作確認（`decoder_q4f16` + `vision_encoder_q8` の初回ダウンロード・Cache API 再読み込み・推論レイテンシ・VRAM/RAM 消費の実測）

---

## v1 (MVP): ブラウザ完結型コレクション

### 1. ローカル永続化（Dexie.js）
- [ ] `src/db/creatures.ts` に Dexie スキーマ定義（`creatures`: `id`, `name`, `types`, `biome`, `archetype`, `sizeClass`, `rarity`, `stats`, `traits`, `scores`, `imageBlob`, `createdAt`）
- [ ] 保存用画像の軽量化（長辺リサイズ＋WebP/JPEG 変換）と `imageBlob` 永続化
- [ ] CRUD・フィルタ・ソート用のストア連携（Zustand + Dexie）

### 2. 画像入力・スキャン体験
- [ ] ファイル選択・ドラッグ＆ドロップ・クリップボード貼り付け・モバイルカメラ入力対応
- [ ] スキャン中アニメーションとリビール演出（Tailwind CSS + Motion）
- [ ] 初期クリーチャー名の自動生成ルール（材質・環境・クラス・体格からの決定論的ネーミング）とユーザーによるリネーム

### 3. クリーチャーカード・コレクション UI
- [ ] 世界観のあるクリーチャーカードデザイン（レア度 `COMMON`〜`MYTHIC` 別の視覚表現、材質・環境・クラス・体格・5 ステータス）
- [ ] コレクション一覧ビュー（レスポンシブグリッド・タイプ/環境/レア度フィルタ・日時/レア度/ステータス順ソート）
- [ ] クリーチャー詳細モーダル / ビュー（全 11 設問スコア分布の閲覧・名前編集・削除確認、`shadcn/ui` はアクセシビリティが必要なプリミティブのみ限定使用）

### 4. モデルセットアップ・エッジケース対応
- [ ] 初回 1.68 GB ダウンロード時のセットアップ画面（進捗・キャッシュ済み表示・容量不足/ネットワーク失敗時のリトライ導線）
- [ ] WebGPU 非対応ブラウザ向けの案内表示
- [ ] `LFM Open License v1.0` の帰属表示

### 5. 静的ホスティング（Cloudflare Workers）
- [ ] `wrangler.jsonc` と Cloudflare Workers 静的アセット配信設定の追加
- [ ] デプロイおよび本番環境での WebGPU Worker 動作確認

---

## v2 以降: バトル・サーバーサイド拡張

- [ ] バトル仕様設計（7 材質 `substance` の相性表、6 クラス `archetype` の固有特性・スキル、`warmth` / `size` / `mass` のバトル反映、不確実度レア度ボーナス）
- [ ] Cloudflare Workers API + Cloudflare D1（クリーチャー・対戦履歴・ランキング）+ Cloudflare R2（共有画像）の導入
- [ ] ローカル IndexedDB コレクションとサーバー同期・改ざん防止設計
- [ ] 必要に応じたモデル重みの Cloudflare R2 ミラー配信検討
