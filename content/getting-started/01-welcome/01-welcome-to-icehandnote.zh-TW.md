+++
title = "歡迎來到 IceHandnote"
summary = "這是一篇範例歡迎文章。你可以隨時前往管理後台直接編輯或刪除它，開啟你的創作之旅。"
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

## [ ] 開啟你的第一篇手帳筆記

歡迎使用 **IceHandnote**！這是一個輕量、支援多語言與多人共創的手帳風格技術文章平台。你可以直接在閱讀視圖或後台畫布中撰寫段落、任務清單、貼紙卡片、程式碼草稿與插圖。
:::margin[mint:tape | 右側或文內可隨時新增手帳批註]

- [ ] 登入管理後台（右上角登入或造訪 `/studio`） | 設定站點名稱、LOGO 與儲存方式
- [ ] 在編輯器中直接點擊標題或內文進行視覺化修改 | 所見即所得，同時保留純淨 Markdown
- [ ] 邀請夥伴共同創作或發佈你的第一篇正式文章 | 支援透過郵件邀請協作者共創

:::tip[手帳貼紙與程式碼草稿]{style="pin" tone="ice" badge="歡迎"}
每一張貼紙和程式碼區塊都支援淺色與深色雙主題顯示。你可以在後台的 **站點設定** 中自由自訂站點標題、頁腳文案、OAuth 登入、SMTP 郵件與儲存後端。
:::

```bash title="deploy/quick-start.sh"
docker run -d --name icehandnote \
  -p 3001:3001 \
  -v ./data:/app/data \
  -v ./content:/app/content \
  ghcr.io/cloudwhile/icehandnote:latest
```
