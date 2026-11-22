+++
title = "Welcome to IceHandnote"
summary = "This is your starter welcome article. Sign in to Studio anytime to edit it directly on the canvas or remove it."
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

## [ ] Start Your First Notebook Article

Welcome to **IceHandnote**! This platform pairs a warm hand-drawn notebook aesthetic with direct on-canvas editing, multilingual publishing, checkable tasks, and multi-author collaboration.
:::margin[mint:tape | Add margin notes right alongside paragraphs or code]

- [ ] Sign in to Studio (`/studio`) | Customize your site title, logo, and storage backend
- [ ] Click any block on the editor canvas to edit in place | Clean Markdown stays synced automatically
- [ ] Invite co-authors or publish your first article | Collaborate seamlessly via email invitations

:::tip[Stationery Stickers & Drafting Code Cards]{style="pin" tone="ice" badge="HELLO"}
Stickers and code cards adapt automatically to both Light and Dark themes. Visit **Site Settings** in Studio to configure branding, OAuth sign-in, SMTP mail templates, or PostgreSQL storage.
:::

```bash title="deploy/quick-start.sh"
docker run -d --name icehandnote \
  -p 3001:3001 \
  -v ./data:/app/data \
  -v ./content:/app/content \
  ghcr.io/cloudwhile/icehandnote:latest
```
