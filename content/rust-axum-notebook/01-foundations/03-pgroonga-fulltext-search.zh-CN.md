+++
title = "整合 PGroonga 与 pg_trgm 打造中日英毫秒级搜索"
summary = "解决传统 PostgreSQL 分词器对中日文识别不佳的痛点，并生成荧光笔高亮摘要片段。"
step_number = 3
estimated_minutes = 11
synced_revision = 2
canonical_revision = 2
tags = ["PostgreSQL 17", "PGroonga", "Full-Text Search"]
+++

## 为什么默认 `to_tsvector` 不适合中日英混合技术文章？

PostgreSQL 内置分词器按空格切词，面对中文与日文连续文本以及 `sqlx::query` 等代码符号时表现不佳。自托管容器推荐使用 **PGroonga**，云端托管数据库则推荐开启 `pg_trgm` GIN 索引：

```sql title="crates/db/migrations/0001_init_schema.sql"
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX IF NOT EXISTS idx_step_translations_plain_trgm
    ON step_translations USING gin (plain_text gin_trgm_ops);
```

:::tip[搜索结果荧光笔涂抹高亮]
后端提取命中词上下文并包裹 `<mark>`，前端即可渲染为真实荧光笔手绘涂抹质感！
:::
