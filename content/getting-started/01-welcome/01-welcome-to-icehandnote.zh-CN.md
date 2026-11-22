+++
title = "欢迎来到 IceHandnote"
summary = "这是一篇示例欢迎文章。你可以随时前往管理后台直接编辑或删除它，开启你的创作之旅。"
step_number = 1
estimated_minutes = 2
synced_revision = 1
canonical_revision = 1
status = "published"
author = "IceHandnote"
published_at = "2026-11-22T00:00:00Z"
updated_at = "2026-11-22T00:00:00Z"
tags = ["Welcome", "IceHandnote"]
+++

## [ ] 开启你的第一篇手账笔记

欢迎使用 **IceHandnote**！这是一个轻量、支持多语言与多人共创的手账风格技术文章平台。你可以直接在阅读视图或后台画布中撰写段落、任务清单、贴纸卡片、代码草稿与插图。
:::margin[mint:tape | 右侧或文内可随时添加手账批注]

- [ ] 登录管理后台（右上角登录或访问 `/studio`） | 配置站点名称、LOGO 与存储方式
- [ ] 在编辑器中直接点击标题或正文进行可视化修改 | 所见即所得，同时保留纯净 Markdown
- [ ] 邀请伙伴共同创作或发布你的第一篇正式文章 | 支持通过邮件邀请协作者共创

:::tip[手账贴纸与代码草稿]{style="pin" tone="ice" badge="欢迎"}
每一张贴纸和代码块都支持浅色与深色双主题显示。你可以在后台的 **站点设置** 中自由自定义站点标题、页脚文案、OAuth 登录、SMTP 邮件与存储后端。
:::

```bash title="deploy/quick-start.sh"
docker run -d --name icehandnote \
  -p 3001:3001 \
  -v ./data:/app/data \
  -v ./content:/app/content \
  ghcr.io/cloudwhile/icehandnote:latest
```
