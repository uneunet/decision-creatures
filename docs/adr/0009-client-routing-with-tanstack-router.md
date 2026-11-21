# ADR 0009: クライアントサイド SPA ルーティングに TanStack Router（コードベース定義）を採用する

## Status

Accepted

## Context

`decision-creatures` は [ADR 0004](./0004-frontend-stack-vite-react-zustand-dexie.md) の通り Vite + React によるクライアント完結 SPA として構築しており、v1 でスキャン（`/`）・コレクション一覧（`/collection`）・個体詳細（`/creatures/$id`）、v2 でバトルや共有 URL（`/battle/$matchId` 等）へ画面を拡張する予定である。

ルーティング設計には以下の制約・要件がある。

1. **WebGPU Worker セッションの維持**: 1.68 GB のモデル重みを保持する推論用 Web Worker（[ADR 0006](./0006-minimal-webgpu-inference-for-d1-2b-with-precompiled-prompts.md)）を画面遷移で破棄しないよう、フルリロードを伴わない SPA ルーティングが必要である。
2. **モバイルの戻る操作とディープリンク**: ブラウザの履歴遷移と URL 同期により、一覧→詳細→戻るといった自然なナビゲーションと、フィルタ／ソート状態（`type` / `rarity` / `sort`）の URL 保持を両立させたい。
3. **型安全性とビルド構成の簡素さ**: TypeScript 7（`strict: true`）環境でパスパラメータ・Search Params・`Link` の型安全性を確保しつつ、画面数が少数（v1 は 3 ルート）の段階で追加のコード生成プラグインを増やしすぎない構成が望ましい。

## Decision

クライアントサイドルーターとして **`@tanstack/react-router`（TanStack Router）** を採用し、v1 時点では **コードベースルート定義（`createRootRoute` / `createRoute` / `createRouter`）** で構成する。

1. **ルート構成（v1 基盤）**:
   - Root Layout: 共通トップバー（ロゴ＋`@base-ui/react` ベースの `≡` メニュー＋モデル設定ダイアログ）と `<Outlet />`
   - `/`: スキャン画面（カード生成・S1 カード 3D 反転）
   - `/collection`: コレクション一覧（型付き Search Params: `type` / `rarity` / `sort`）
   - `/creatures/$id`: 個体詳細ビュー
2. **型登録**: `declare module '@tanstack/react-router'` で `router` 型を登録し、全 `Link`・`useNavigate`・`useParams`・`useSearch` をコンパイル時検証する。
3. **配信設定との整合**: Cloudflare Workers の静的配信設定では SPA フォールバック（`not_found_handling: "single-page-application"`）を有効にし、任意パスへの直接アクセス・リロードに対応する。

## Consequences

### Pros

- パスパラメータやコレクションのフィルタ／ソート用 Search Params まで完全型安全に扱え、将来の v2 ルート拡張にも耐える。
- コードベース定義により Vite プラグインや生成ファイル（`routeTree.gen.ts`）を増やさず、`src/router.tsx` 1 箇所で全ルート構成を把握できる。画面数が増えた段階で後からファイルベース定義へ移行することも容易である。
- React 19 および Vite 8 と問題なく共存でき、Web Worker / Zustand ストアをルート外のシングルトンとしてそのまま維持できる。

### Cons

- `Wouter` 等の超軽量ルーターと比べてクライアントバンドルが約 13〜15 KB（gzip）増加する。
- ルート追加時は `src/router.tsx` にルートツリーを手動登録する必要がある。
