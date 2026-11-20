+++
title = "Cargoワークスペース設計とノートASTパイプライン"
summary = "core・db・api・cliの4クレートに分割し、CLI検証とAPI配信で同一のMarkdownコンパイラを共有します。"
step_number = 1
estimated_minutes = 10
synced_revision = 2
canonical_revision = 2
tags = ["Rust", "Cargo", "Architecture"]
+++

## [ ] コンパイラを `crates/core` に分離する

執筆者は手元のエディタでシンプルなMarkdownを書き、読者はブラウザ上で構造化されたコールアウトや図解を快適に読めるのが理想です。I/Oを持たない純粋な変換処理を `crates/core` に切り出すことで、高速な単体テストと安全なHTMLサニタイズを両立できます。
:::margin[mint:pin | crates/core を純粋関数に保つとテスト再ビルドが0.3秒で完了します！]

```sketch caption="4クレート構成とデータフロー"
{
  "nodes": [
    { "id": "md", "label": "Markdown 原稿", "sublabel": "content/**/*.md", "x": 24, "y": 42, "width": 150, "height": 64, "tone": "amber" },
    { "id": "core", "label": "crates/core", "sublabel": "AST + Ammonia", "x": 220, "y": 42, "width": 155, "height": 64, "tone": "violet" },
    { "id": "db", "label": "crates/db", "sublabel": "SQLx + PG 17", "x": 420, "y": 42, "width": 150, "height": 64, "tone": "ice" },
    { "id": "api", "label": "crates/api", "sublabel": "Axum 0.8 REST", "x": 615, "y": 42, "width": 150, "height": 64, "tone": "coral" }
  ],
  "edges": [
    { "from": "md", "to": "core", "label": "parse" },
    { "from": "core", "to": "db", "label": "JSONB" },
    { "from": "db", "to": "api", "label": "DTO" }
  ]
}
```

```toml title="Cargo.toml"
[workspace]
resolver = "2"
members = ["crates/core", "crates/db", "crates/api", "crates/cli"]

[workspace.dependencies]
axum = "0.8"
sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "postgres"] }
```

:::note[Axum 0.8 の波括弧ルート記法]
`axum = "0.8"` から動的パスは `/{locale}/tracks/{track}` のように波括弧で記述します。旧コロン記法は起動時にパニックするため注意してください。
:::

## 型安全なブロック AST を定義する

`crates/core` でタグ付き列挙型 `NotebookBlock` を定義することで、コールアウト・コードブロック・図解を型安全にフロントエンドへ渡せます。

```rust title="crates/core/src/lib.rs" style="spiral"
// Tagged union compiled from Markdown and stored directly in PostgreSQL JSONB
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NotebookBlock {
    Heading { block_id: String, level: u8, number: String, text: String, is_task: bool },
    Paragraph { block_id: String, html: String, margin_note: Option<String> },
    Alert { kind: AlertKind, title: String, body_html: String },
    CodeCard { language: String, filename: Option<String>, code: String },
}
```

- [ ] `crates/core` で `NotebookBlock` 列挙型を定義する | 決定的な `block_id` を各ブロックに付与

## [ ] コンパイルパイプラインをテストする

データベースを起動せずローカルの単体テストだけで、Markdown変換・節タスク／段落タスク・XSSサニタイズを一括検証できます：

```bash title="Terminal" style="torn"
# コアコンパイラの単体テストを実行
cargo test -p icehandnote-core -- --nocapture
```
