# AGENTS.md

アーキテクチャや設計に重要な影響を与える決定（技術選定、モジュール構成、データモデル、API 境界、開発基盤の方針など）を行う場合は、**ADR (Architecture Decision Records)** として `docs/adr/` に記録しながら開発を進めること。

## 参照元と構成

フォーマットのベースは Michael Nygard の「[Documenting Architecture Decisions](http://thinkrelevance.com/blog/2011/11/15/documenting-architecture-decisions)」に従う。記述形式はテンプレート [`docs/adr/0000-template.md`](docs/adr/0000-template.md) をコピーして使用すること。

## 運用ルール

- **配置と命名**: `docs/adr/NNNN-<kebab-case-title>.md`（4桁連番 + 英語ケバブケース、例: `0001-use-bun-and-flake-parts.md`）
- **分量**: 1つの ADR は 1〜2 ページ程度に簡潔にまとめる。
- **変更・撤回**: 過去の ADR の Decision 本文は書き換えず、新しい ADR を作成して元の ADR の `Status` を `Superseded by ADR XXXX`（または `Deprecated`）に更新する。

不要なセカンダリラベルや説明を避ける。レイアウトに説明させる。