# ADR 0001: 開発基盤に Bun と flake-parts を採用する

## Status

Accepted

## Context

`decision-creatures` は Vite + React を中心とした TypeScript フロントエンドおよび Web Worker / 将来的な Cloudflare Workers 開発を行うプロジェクトである。開発環境が端末ごとにばらつくと、ランタイムやパッケージマネージャの差異による再現性低下が起きやすい。一方、Nix Flake 単体での記述はシステムごとの出力定義が冗長になりやすい。

## Decision

開発環境のプロビジョニングに Nix Flakes と `flake-parts` を採用し、JavaScript/TypeScript ランタイムおよびパッケージマネージャとして `bun` を `devShells.default` に組み込む。

## Consequences

### Pros

- `nix develop`（および `direnv`）により、OS やローカル環境に依存せず同一バージョンの `bun` を即座に再現できる。
- `flake-parts` の `perSystem` により、Linux / macOS 複数アーキテクチャ向けの定義を簡潔に記述・拡張できる。
- `bun` による高速なパッケージインストール、スクリプト実行、型チェック（`bun check`）が標準化される。

### Cons

- 開発環境を利用するには Nix（Flakes 有効）の導入が必要になる。
- Vite や一部エコシステムツールにおいて、Node.js 前提の挙動と差異が出た場合は個別の検証が必要になる。
