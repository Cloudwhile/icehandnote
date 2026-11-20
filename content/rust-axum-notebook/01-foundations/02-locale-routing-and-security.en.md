+++
title = "Locale Fallback, Revision Drift & HTML Sanitization"
summary = "Implement single-query SQLx locale fallback, translation drift detection, and defense-in-depth XSS sanitization."
step_number = 2
estimated_minutes = 14
synced_revision = 4
canonical_revision = 4
tags = ["SQLx", "PostgreSQL", "i18n", "Security"]
+++

## Single-Query Locale Fallback in PostgreSQL

When a tutorial article hasn't been translated into a learner's active language yet, returning a 404 breaks reading momentum. Ordering by `CASE WHEN locale_code = $2 THEN 0 ELSE 1 END` resolves the preferred translation or falls back to the canonical edition in a single round-trip:
:::margin[Margin Tip: Switch to 日本語 on this page to see the live Revision Drift banner!]

```sql title="crates/db/queries/step_fallback.sql"
SELECT locale_code, title, summary, compiled_blocks, synced_revision
FROM step_translations
WHERE step_id = $1 AND locale_code IN ($2, $3)
ORDER BY CASE WHEN locale_code = $2 THEN 0 ELSE 1 END
LIMIT 1;
```

:::tip[Keep Locale Lookups Under 2ms with Composite Indexes]
Adding `UNIQUE (step_id, locale_code)` unlocks PostgreSQL Index-Only Scans without heap fetches.
??? Show EXPLAIN ANALYZE benchmark
Seq Scan took 18.4ms on 50k translations; the composite index drops p99 latency to 0.42ms.
:::

- [ ] Add a `UNIQUE (step_id, locale_code)` index on `step_translations` | Verify with `EXPLAIN ANALYZE` that lookups use an Index-Only Scan

## Theme Inheritance & Defense-in-Depth Sanitization

:::info[Why Dark Code Cards Re-Declare Color Tokens]
Because `light-dark()` resolves at computed-value time on `:root`, forcing `color-scheme: dark` on `<pre>` requires re-specifying `color: var(--ink-primary)`.
:::

:::warning[Never Nest Headings Inside `<summary>`]
JAWS and TalkBack expose `<summary>` as a button and strip nested heading semantics. Keep `<summary>` as styled text.
:::

:::danger[Defense-in-Depth Sanitization for Learner Margin Notes]
Sanitize user notes on the server with Rust `ammonia` AND on the client via `Element.prototype.setHTML()` with a lazy `DOMPurify` fallback.
:::

- [ ] Wire allowlist HTML sanitization on both server and client | Clean incoming notes with `ammonia` and render safely via `setHTML()` / `DOMPurify`
