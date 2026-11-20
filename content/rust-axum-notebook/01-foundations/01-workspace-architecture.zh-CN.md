+++
title = "规划 Cargo 多层工作区与笔记编译管线"
summary = "拆分 core、db、api 与 cli 四个 Crate，让离线 CLI 与线上 API 共享同一套文章 AST 编译器。"
step_number = 1
estimated_minutes = 10
synced_revision = 2
canonical_revision = 2
tags = ["Rust", "Cargo", "Architecture"]
+++

## [ ] 规划四层工作区与独立编译 Crate

在构建多语言文章站点时，我们希望作者既能在本地使用 Typora 或 VS Code 编写纯净的 Markdown 笔记，又能让线上阅读器直接获得结构化的组件与目录树。将纯编译逻辑抽离至 `crates/core`，能让 CLI 验证器与 Web 服务完全复用同一套代码。
:::margin[mint:pin | 将纯计算抽进 crates/core，单元测试编译只需 0.3 秒！]

```sketch caption="四层 Crate 依赖与数据流草图"
{
  "nodes": [
    { "id": "md", "label": "Markdown 笔记", "sublabel": "content/**/*.md", "x": 24, "y": 42, "width": 150, "height": 64, "tone": "amber" },
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

:::note[Axum 0.8 路由参数新语法提醒]
升级至 `axum = "0.8"` 后，动态路径片段已由旧版 `:locale` 全面改为花括号 `/{locale}/tracks/{track}`，与 OpenAPI 3.1 路径规范完全一致。
??? 查看 Workspace Cargo.toml 关键依赖设置
通过 `[workspace.dependencies]` 统一锁定 `tokio`、`axum`、`sqlx`（启用 `runtime-tokio-rustls` 免除 Windows OpenSSL 编译烦恼）与 `pulldown-cmark` 版本。
:::

## 定义类型安全的区块 AST

我们在 `crates/core` 中定义具名枚举 `NotebookBlock`，让前端的五态提示框、代码块与流程图都能获得精确的属性结构：

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

:::idea[稳定区块锚点哈希设计]{style="pin" tone="mint"}
为每个段落计算确定性哈希 `blk-<sha256前8位>`，读者贴上的个人笔记就能精准吸附在对应段落旁。
:::

- [ ] 在 `crates/core` 中定义 `NotebookBlock` 枚举 | 确保每个区块携带稳定的 `block_id` 与可序列化字段

## [ ] 验证编译管线与单元测试

完成 AST 结构后，无需启动数据库即可在毫秒级完成纯编译器的本地回归验证，确保 Markdown 解析、节任务/段任务与 HTML 安全净化全部生效：

```bash title="Terminal" style="torn"
# 运行核心编译器测试，验证 AST、任务解析与 XSS 安全净化
cargo test -p icehandnote-core -- --nocapture
```
