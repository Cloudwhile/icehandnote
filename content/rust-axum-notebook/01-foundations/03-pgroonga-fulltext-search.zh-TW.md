+++
title = "整合 PGroonga 與 pg_trgm 打造中日英毫秒級搜尋"
summary = "解決傳統 PostgreSQL 分詞器對中日文識別不佳的痛點，並產生螢光筆高亮摘要片段。"
step_number = 3
estimated_minutes = 11
synced_revision = 2
canonical_revision = 2
tags = ["PostgreSQL 17", "PGroonga", "Full-Text Search"]
+++

## 為什麼預設 `to_tsvector` 不適合中日英混合技術文章？

PostgreSQL 內建的英文分詞器以空白字元切詞，面對連續不留白的繁體中文、簡體中文與日文漢字假名時無法正確建立倒排索引；同時技術文章中夾雜大量如 `sqlx::query`、`light-dark()` 等符號識別符。
:::margin[小提示：本節故意尚未建立日文檔，切換至「日本語」可實測手繪雪貓回退橫幅！]

- **自託管 Docker 首選 `PGroonga`**：零辭典配置支援繁簡日英混合索引與前綴即時聯想。
- **雲端託管資料庫（Neon / Supabase）首選 `pg_trgm`**：透過 GIN Trigram 索引加速 `ILIKE` 子字串匹配，無需額外 C 擴充權限即可開箱運作。

```sql title="crates/db/migrations/0001_init_schema.sql"
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX IF NOT EXISTS idx_step_translations_plain_trgm
    ON step_translations USING gin (plain_text gin_trgm_ops);
```

:::tip[搜尋結果螢光筆塗抹效果]
後端擷取命中關鍵字前後 50 字並包裹 `<mark>` 標籤，前端即可直接將 `<mark>` 渲染為手繪暖黃螢光筆塗抹底色（`#fff6b0` / `#f59e0b`）！
:::
