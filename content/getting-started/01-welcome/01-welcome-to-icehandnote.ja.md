+++
title = "IceHandnote へようこそ"
summary = "これは初期サンプル記事です。管理画面からいつでも直接編集または削除して、執筆を始められます。"
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

## [ ] 最初のノート記事をはじめよう

**IceHandnote** へようこそ！手描きノートの温かみと、直感的なキャンバス編集、多言語対応、共同執筆を備えた記事プラットフォームです。
:::margin[mint:tape | 段落やコードの横にメモを添えられます]

- [ ] 管理画面（`/studio`）にログインする | サイト名、ロゴ、保存先を設定
- [ ] エディタ上で見出しや本文を直接クリックして編集する | 美しいプレビューと Markdown を両立
- [ ] 共同執筆者を招待して最初の記事を公開する | メール招待で複数人の共創に対応

:::tip[ステッカーとコードカード]{style="pin" tone="ice" badge="WELCOME"}
すべてのカードはライト・ダーク両テーマに対応しています。管理画面の **サイト設定** からブランド表記、OAuth ログイン、SMTP メール、PostgreSQL 接続を切り替えられます。
:::

```bash title="deploy/quick-start.sh"
docker run -d --name icehandnote \
  -p 3001:3001 \
  -v ./data:/app/data \
  -v ./content:/app/content \
  ghcr.io/cloudwhile/icehandnote:latest
```
