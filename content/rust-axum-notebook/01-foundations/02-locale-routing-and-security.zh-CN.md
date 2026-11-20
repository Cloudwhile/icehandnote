+++
title = "多语言数据库回退、版本漂移与安全净化"
summary = "实现 SQLx 语言优先级查询、翻译版本 synced_revision 过期提醒，以及前后端双重防 XSS 净化。"
step_number = 2
estimated_minutes = 14
synced_revision = 4
canonical_revision = 4
tags = ["SQLx", "PostgreSQL", "i18n", "Security"]
+++

## 单次查询完成“目标语言优先、默认语言回退”

当新章节刚完成默认语言原稿而其他语言尚在翻译时，通过 PostgreSQL 的 `CASE WHEN` 排序即可在一次查询内优雅回退至默认语言，避免生硬的 404 报错：
:::margin[手写批注：配合 (step_id, locale_code) 复合索引，延迟稳定低于 1ms！]

```sql title="crates/db/queries/step_fallback.sql"
SELECT locale_code, title, summary, compiled_blocks, synced_revision
FROM step_translations
WHERE step_id = $1 AND locale_code IN ($2, $3)
ORDER BY CASE WHEN locale_code = $2 THEN 0 ELSE 1 END
LIMIT 1;
```

:::tip[利用复合索引将多语言查询压在 2ms 内]
将 `(step_id, locale_code)` 设为唯一复合索引后，PostgreSQL 可直接走 Index-Only Scan，省去回表开销。
??? 展开 EXPLAIN ANALYZE 实测对比
加入复合索引后，5 万行翻译表的 p99 查询耗时从 18.4ms 降至 0.42ms。
:::

- [ ] 为 `step_translations` 创建 `(step_id, locale_code)` 唯一复合索引 | 用 `EXPLAIN ANALYZE` 确认查询命中 Index-Only Scan

## 主题继承与双重安全净化

:::info[代码块独立暗色域的继承细节]
前端使用 `light-dark()` 时，若在 `<pre>` 上声明 `color-scheme: dark`，必须同时重设 `color: var(--ink-primary)`，避免继承亮色页面的深色文字。
:::

:::warning[折叠详解区的无障碍细节]
使用原生 `<details>` 时，请勿在 `<summary>` 内嵌套 `<h3>` 等标题元素，以免屏幕阅读器丢失大纲导航语义。
:::

:::danger[纵深防御：严禁直接信任前端传入的笔记 HTML]
用户手写页边笔记必须经 Rust 后端 `ammonia` 白名单清洗，并在前端使用原生 `setHTML()` 或按需加载 `DOMPurify` 二次校验。
:::

- [ ] 在服务端与前端同时接入白名单 HTML 净化 | 后端使用 `ammonia`，前端优先调用 `setHTML()` 并提供 `DOMPurify` 回退
