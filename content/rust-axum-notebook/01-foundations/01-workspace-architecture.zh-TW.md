+++
title = "規劃 Cargo 多層工作區與筆記編譯管線"
summary = "拆分 core、db、api 與 cli 四個 Crate，讓離線 CLI 與線上 API 共用同一套文章 AST 編譯器。"
step_number = 1
estimated_minutes = 10
synced_revision = 2
canonical_revision = 2
tags = ["Rust", "Cargo", "Architecture"]
+++

## [ ] 規劃四層工作區與獨立編譯 Crate

在設計多語言文章站點時，我們希望作者既能在本地使用 Typora 或 VS Code 撰寫純淨的 Markdown 筆記，又能讓線上閱讀器直接獲得結構化的組件與目錄樹。若將解析邏輯耦合在 HTTP 路由層，CLI 同步工具便無法在 CI 階段提前驗證語法。
:::margin[mint:pin | 把無 I/O 的純邏輯抽進 crates/core，單元測試編譯只要 0.3 秒！]

```sketch caption="四層 Crate 依賴與資料流草圖"
{
  "nodes": [
    { "id": "md", "label": "Markdown 筆記", "sublabel": "content/**/*.md", "x": 24, "y": 42, "width": 150, "height": 64, "tone": "amber" },
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

:::note[Axum 0.8 路由參數新語法提醒]
升級至 `axum = "0.8"` 後，動態路徑片段已由舊版 `:locale` 全面改為花括號 `/{locale}/tracks/{track}`，與 OpenAPI 3.1 路徑規範完全一致。
??? 查看 Workspace Cargo.toml 關鍵依賴設定
透過 `[workspace.dependencies]` 統一鎖定 `tokio`、`axum`、`sqlx`（啟用 `runtime-tokio-rustls` 免除 Windows OpenSSL 編譯煩惱）與 `pulldown-cmark` 版本。
:::

## 定義型別安全的區塊 AST

與其將整篇文章轉成一整坨不可控的 HTML 字串，我們在 `crates/core` 定義具名列舉 `NotebookBlock`，讓前端的提示框、程式碼區塊與流程圖都能獲得精確屬性：

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

:::idea[穩定區塊錨點雜湊設計]{style="pin" tone="mint"}
為每個段落計算確定性雜湊 `blk-<sha256前8碼>`，讀者貼上的個人筆記就能精準吸附在對應段落旁，即使重新編譯也不會錯位。
:::

- [ ] 在 `crates/core` 定義 `NotebookBlock` 列舉 | 確保每個區塊皆攜帶穩定 `block_id` 與可序列化屬性

## [ ] 驗證編譯管線與單元測試

完成 AST 定義後，無需啟動資料庫即可在數百毫秒內執行純編譯器測試，確認 Markdown 解析、節任務／段任務與 XSS 淨化全部通過：

```bash title="Terminal" style="torn"
# 執行核心編譯器測試，驗證 AST、任務解析與 XSS 淨化
cargo test -p icehandnote-core -- --nocapture
```
