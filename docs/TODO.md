# TODO

設計の正は [`docs/SPEC.md`](SPEC.md) と [`docs/adr/`](adr/) を参照。

---

## v1 リリース後フォロー

### 追加検証（任意）
- [ ] デスクトップ WebGPU ブラウザおよびモバイル実機での周辺操作チェック（カメラ撮影、カード枠内パン＆ズームクロップ、`navigator.share` による表裏 PNG 共有、画像トークン上限切替）
- [ ] 本番 URL（`https://dc.uneu.net`）での各画面・OGP カード最終確認（`/scan`・`/creatures/:id` 直アクセス時の SPA フォールバック、jsDelivr 経由の ORT WASM ロード、OGP 表示）

---

## v2 以降（将来拡張）

- [ ] バトル仕様設計（7 材質 `substance` の相性表、6 クラス `archetype` の固有特性・スキル、`warmth` / `size` / `mass` のバトル反映、不確実度レア度ボーナス）
- [ ] Cloudflare Workers API + Cloudflare D1（クリーチャー・対戦履歴・ランキング）+ Cloudflare R2（共有画像）の導入
- [ ] ローカル IndexedDB コレクションとサーバー同期・改ざん防止設計
- [ ] 必要に応じたモデル重みの Cloudflare R2 ミラー配信検討

---

## 完了済み

### Phase 0: 推論基盤・パラメータ実験
- [x] `LiquidAI/d1-2B-ONNX` 最小推論構成の確定（[ADR 0006](adr/0006-minimal-webgpu-inference-for-d1-2b-with-precompiled-prompts.md)）
- [x] 事前コンパイルスクリプト（[`scripts/compile-prompts.py`](../scripts/compile-prompts.py)）と静的 JSON 出力
- [x] `onnxruntime-web/webgpu` 専用 Web Worker・依存ゼロ画像前処理・Cache API 実装
- [x] 実モデルでの 23 候補パラメータ検証・物体の大きさ実験・不確実度レア度キャリブレーション（[`docs/experiment-phase0.md`](experiment-phase0.md), [ADR 0007](adr/0007-creature-parameter-model-and-uncertainty-rarity.md)）
- [x] S ランク 11 設問・材質×環境タイプ体系・HP/DEF 物理導出への統一と単体テスト

### v1 (MVP): アプリ実装・ホスティング設定
- [x] ローカル永続化（Dexie.js スキーマ・クロップ後 WebP/JPEG 軽量化・Zustand ストア連携）
- [x] 画像入力・スキャン体験（ドロップ／選択／貼付／カメラ・カード枠内クロップ・スキャン演出＆180°反転リビール・決定論的ネーミング＆リネーム）
- [x] UI デザイン基盤（`@base-ui/react` + `lucide-react` + Tailwind CSS v4 + Motion + LINE Seed JP フォント、ライト／ダーク対応フラットポップ、[ADR 0008](adr/0008-headless-base-ui-and-flat-pop-design-system.md), [ADR 0010](adr/0010-v1-collection-first-ui-flow-and-local-card-export.md)）
- [x] クライアント SPA ルーティング（`@tanstack/react-router` コードベース定義・URL Search Params 同期、[ADR 0009](adr/0009-client-routing-with-tanstack-router.md)）
- [x] コレクション一覧（`/`）・スキャン（`/scan`）・詳細（`/creatures/$id`）・表裏 2 枚並び PNG 出力＆共有・全 11 設問スコア詳細
- [x] モデルセットアップ導線（初回約 200 MB 確認＆進捗表示・OPFS キャッシュ管理・旧キャッシュ自動掃除・WebGPU 非対応案内・`LFM Open License v1.0` 帰属表示）
- [x] モバイル WebGPU 向け知識蒸留パイプライン構築と本番組み込み（`distill/`・完全ランダム CC12M 10,000 枚学習・未学習 12 枚一致率 93.3% / Stat MAE 2.80 / 相関 r=0.907・`public/models/creature_head.onnx` 4.85 MB・[ADR 0011](adr/0011-distilled-vision-head-for-mobile-webgpu.md)）
- [x] iPhone Safari 実機での軽量 WebGPU 推論 E2E 動作確認（約 201 MB OPFS キャッシュ・`File.arrayBuffer()` 読込・スキャン完走・WebGPU ロスト自動復旧）
- [x] アプリ内透明性導線（「このサイトについて」ダイアログ＋フッターリンクでしくみ・Common〜Mythic レア度・画像非送信を明示）
- [x] ライセンス整備（ソースコード: GNU AGPLv3 `AGPL-3.0-only`、オリジナルブランド素材: CC BY-NC 4.0、AI モデル: LFM Open License v1.0）
- [x] Cloudflare Workers 本番デプロイ（`cf deploy dist`）および `https://dc.uneu.net` リリース
- [x] ブランドアセット＆メタ情報（ロゴ `BrandMark` / `logo.svg`・`favicon.svg`・`apple-touch-icon.png`・`dc.uneu.net` 向け `ogp.png` 1200×630＆OGP/Twitter Card メタタグ）
