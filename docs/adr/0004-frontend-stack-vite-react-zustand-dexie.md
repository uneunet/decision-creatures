# ADR 0004: フロントエンド基盤に Vite・React・Zustand・Dexie.js を採用する

## Status

Accepted

## Context

v1 ではサーバーを持たない SPA として、ローカル推論（Web Worker）、画像データ（Blob）を含むリッチなコレクション管理、そして直感的なアニメーション UI を統合する必要がある。SSR フレームワークは v1 の完全クライアント完結構成に対してオーバースペックであり、一方で React の状態管理と IndexedDB のバイナリ永続化には見通しの良い軽量な抽象化が求められる。

## Decision

フロントエンド基盤として **Vite + React** を採用し、クライアント状態管理に **Zustand**、ブラウザ内ローカルデータベースに **Dexie.js**（IndexedDB ラッパー）を採用する。

## Consequences

### Pros

- Vite + React により、高速な HMR・シンプルな SPA ビルド・Web Worker 統合（`?worker` 等）を容易に実現できる。
- Zustand はボイラープレートが少なく、React コンポーネント外（Web Worker からのイベント受信や Dexie 連携）からも状態を扱いやすい。
- Dexie.js により、画像 Blob や構造化されたクリーチャーデータを型安全かつオフライン前提で IndexedDB に永続化できる。

### Cons

- SSR を前提としないため、将来的に OGP や SEO が重要になる共有ページをサーバー側で描画したい場合は、Cloudflare Workers 側で別途ハンドリングが必要になる。
- IndexedDB はユーザーによるブラウザデータ消去やプライベートブラウジングの影響を受けるため、v2 以降のサーバー同期導入時に移行・同期設計が必要になる。
