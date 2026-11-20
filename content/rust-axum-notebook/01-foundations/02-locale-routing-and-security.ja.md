+++
title = "多言語フォールバックと翻訳バージョン同期"
summary = "SQLxによる単一クエリ言語フォールバックと、ammoniaを用いた多層サニタイズを実装します。"
step_number = 2
estimated_minutes = 14
synced_revision = 3
canonical_revision = 4
tags = ["SQLx", "PostgreSQL", "i18n", "Security"]
+++

## 単一SQLでの優先言語取得とフォールバック

翻訳作業中の章でも404エラーを出さず学習を継続できるよう、`CASE WHEN` を用いて優先言語とデフォルト言語を1回のクエリで解決します。
:::margin[手書きメモ：この日本語ページは synced_revision=3 のため、上部に原文v4更新通知が表示されます！]

```sql title="crates/db/queries/step_fallback.sql"
SELECT locale_code, title, summary, compiled_blocks, synced_revision
FROM step_translations
WHERE step_id = $1 AND locale_code IN ($2, $3)
ORDER BY CASE WHEN locale_code = $2 THEN 0 ELSE 1 END
LIMIT 1;
```

:::tip[複合インデックスでクエリを2ms以内に抑える]
`UNIQUE (step_id, locale_code)` を付与することで、PostgreSQLのIndex-Only Scanが有効になります。
:::

:::danger[多層防御：ユーザー付箋のHTMLサニタイズ]
サーバー側のRust `ammonia` クレートと、クライアント側の標準 `setHTML()`（未対応環境では `DOMPurify` 動的読込）を併用してXSSを防止します。
:::
