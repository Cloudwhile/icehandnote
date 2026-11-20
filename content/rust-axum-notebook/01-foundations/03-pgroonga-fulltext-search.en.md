+++
title = "Sub-Millisecond CJK + English Search with PGroonga & pg_trgm"
summary = "Index Chinese, Japanese, and code identifiers cleanly in PostgreSQL 17 and highlight matched snippets like marker strokes."
step_number = 3
estimated_minutes = 11
synced_revision = 2
canonical_revision = 2
tags = ["PostgreSQL 17", "PGroonga", "Full-Text Search"]
+++

## Why Built-in `to_tsvector` Struggles on Multilingual Code Tutorials

Whitespace tokenizers miss unsegmented Chinese and Japanese phrases as well as symbol-heavy Rust identifiers like `sqlx::query`. Combining **PGroonga** (on Docker) with **`pg_trgm` GIN indexes** (on managed Postgres like Neon or Supabase) gives instant `⌘K` search across every language:
:::margin[Try switching to 日本語 on Step 3 to see the graceful untranslated fallback banner!]

```sql title="crates/db/migrations/0001_init_schema.sql"
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX IF NOT EXISTS idx_step_translations_plain_trgm
    ON step_translations USING gin (plain_text gin_trgm_ops);
```

:::tip[Highlighter-Stroke `<mark>` Snippets]
Wrapping matched query windows in `<mark>` lets our CSS style search hits just like a warm yellow highlighter pen across notebook paper!
:::
