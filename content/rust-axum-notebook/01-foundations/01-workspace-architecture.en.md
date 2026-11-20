+++
title = "Structuring the Cargo Workspace & AST Pipeline"
summary = "Split core, db, api, and cli into focused crates sharing one deterministic Markdown-to-NotebookBlock compiler."
step_number = 1
estimated_minutes = 10
synced_revision = 2
canonical_revision = 2
tags = ["Rust", "Cargo", "Architecture"]
+++

## [ ] Isolate the Notebook Compiler in a 4-Crate Workspace

Authors want to write clean Markdown locally in VS Code or Typora, while readers expect structured callouts, numbered outlines, and architecture diagrams in the browser. Isolating pure parsing and sanitization in `crates/core` lets both the CLI validator and the Axum API server run the exact same compiler with sub-second test times.
:::margin[mint:pin | Keeping crates/core I/O-free keeps unit test rebuilds under 0.3s!]

```sketch caption="4-Crate Dependency & Data Flow"
{
  "nodes": [
    { "id": "md", "label": "Markdown Notes", "sublabel": "content/**/*.md", "x": 24, "y": 42, "width": 150, "height": 64, "tone": "amber" },
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

:::note[Axum 0.8 Curly-Brace Path Syntax]
Starting in `axum = "0.8"`, dynamic route segments use `{locale}` instead of `:locale` (`/{locale}/tracks/{track}`), matching OpenAPI templates directly.
??? View Cargo workspace TLS tip
Use `runtime-tokio-rustls` on `sqlx` and `reqwest` so Windows, macOS, and Linux builds require zero native OpenSSL toolchains.
:::

## Typed `NotebookBlock` AST Over Raw HTML Blobs

Instead of dumping an opaque HTML blob to the client, `crates/core` emits a tagged union `NotebookBlock` stored in PostgreSQL `JSONB`:

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

:::idea[Deterministic Paragraph Anchor Hashes]{style="pin" tone="mint"}
Hashing each block ordinal + prefix into `blk-<sha256>` lets learners stick personal margin notes onto any paragraph reliably across re-renders.
:::

- [ ] Define the tagged `NotebookBlock` enum in `crates/core` | Ensure every block carries a deterministic `block_id`

## [ ] Verify the Compiler Pipeline Locally

Because `crates/core` has zero database or network dependencies, you can verify Markdown compilation, section/paragraph task parsing, and HTML sanitization in under a second:

```bash title="Terminal" style="torn"
# Run core compiler tests (AST, section/paragraph tasks, and XSS sanitization)
cargo test -p icehandnote-core -- --nocapture
```
