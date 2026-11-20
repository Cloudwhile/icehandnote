+++
title = "多語言資料庫回退、版本漂移與安全淨化"
summary = "實作 SQLx 語系優先序查詢、譯本 synced_revision 過期提醒，以及雙端防 XSS 淨化。"
step_number = 2
estimated_minutes = 14
synced_revision = 4
canonical_revision = 4
tags = ["SQLx", "PostgreSQL", "i18n", "Security"]
+++

## 單次查詢完成「目標語系優先、預設語系回退」

多語言教程站最常見的問題是：新章節剛寫完繁中版，日文或英文尚在翻譯中。若直接回傳 `404`，讀者點擊章節樹就會中斷學習心流。我們可以在 PostgreSQL 中利用 `CASE WHEN` 排序一次取出最佳版本：
:::margin[手寫批註：搭配 Index-Only Scan 複合索引，單次查詢延遲不到 1ms！]

```sql title="crates/db/queries/step_fallback.sql"
SELECT locale_code, title, summary, compiled_blocks, synced_revision
FROM step_translations
WHERE step_id = $1 AND locale_code IN ($2, $3)
ORDER BY CASE WHEN locale_code = $2 THEN 0 ELSE 1 END
LIMIT 1;
```

:::tip[利用複合索引將多語系查詢壓在 2ms 內]
在 PostgreSQL 建立索引時，將 `(step_id, locale_code)` 設為唯一複合索引，查詢計畫會直接命中 Index-Only Scan，省去隨機回表 I/O。
??? 展開 EXPLAIN ANALYZE 實測對比
未建立語系複合索引前 5 萬筆翻譯表 Seq Scan 耗時 18.4ms；加入 `UNIQUE (step_id, locale_code)` 後 p99 降至 0.42ms。
:::

## 偵測譯本落後（Translation Drift）與安全防護

當原文更新了第 4 版程式碼範例（`canonical_revision = 4`），而日文譯本仍停留在 `synced_revision = 3` 時，API 會回傳 `has_revision_drift: true`（可立即點擊右上角切換至「日本語」預覽此提示籤效果！）。

:::info[為什麼程式碼卡片與動態令牌要注意 CSS 繼承？]
前端使用 `light-dark()` 定義語義色彩時，瀏覽器會在 `:root` 計算值階段提前求值；若程式碼區塊強制設定 `color-scheme: dark`，務必重新宣告 `color: var(--ink-primary)`。
??? 展開 CSS Color Level 5 繼承機制詳解
繼承屬性傳遞的是「已解析的單一色值」而非原始表達式，重新綁定語義變數即可讓深色代碼卡在亮色筆記紙上正常顯示淺色字。
:::

:::warning[摺疊詳解區的無障礙陷阱]
筆記提示框內的補充摺疊區使用原生 `<details>` 與 `<summary>` 時，切勿在 `<summary>` 內包裹 `<h3>` 或 `<h4>` 標題標籤，否則螢幕閱讀器會丟失章節標題結構。
:::

:::danger[縱深防禦：嚴禁直接信任前端傳入的便籤 HTML]
學員手寫頁邊便籤必須先由 Rust 後端 `ammonia` 白名單過濾 `<script>` 與 `on*` 屬性，前端渲染再透過原生 `Element.prototype.setHTML()`（或動態載入 `DOMPurify`）雙重把關！
??? 展開安全淨化配置要點
切勿將 `Document.parseHTML()` 淨化後的節點重新序列化為字串再塞入 `innerHTML`，以免觸發 Mutation XSS（mXSS）繞過攻擊。
:::
