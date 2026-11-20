+++
title = "串接 WordPress 跨站單點登入與創作後台"
summary = "透過 HMAC-SHA256 防重放簽章承接外部主站用戶資訊與角色權限，並在瀏覽器雙欄工坊即時撰寫文章。"
step_number = 4
estimated_minutes = 10
synced_revision = 1
canonical_revision = 1
status = "published"
tags = ["SSO", "HMAC-SHA256", "RBAC", "WordPress"]
+++

## 如何安全承接外部 WordPress 主站的已登入用戶？

若外部主站（例如 `blog.example.com`）運行於 WordPress，可透過極輕量的 MU-Plugin（`deploy/wordpress-sso-bridge.php`）讀取當前登入用戶的 `ID`、`display_name`、`avatar_url` 與 `roles`，簽發 5 分鐘有效期的 HMAC-SHA256 票券並跳轉回本站。
:::margin[小提示：登入瞬間還會自動把訪客期間貼的便籤合併進個人帳號喔！]

```sketch caption="WordPress 跨站 SSO 與後台權限管線"
{
  "nodes": [
    { "id": "n1", "label": "Main Blog", "sublabel": "WP MU-Plugin", "x": 24, "y": 36, "width": 160, "height": 62, "tone": "ice" },
    { "id": "n2", "label": "Axum Studio", "sublabel": "HMAC + RBAC", "x": 245, "y": 36, "width": 165, "height": 62, "tone": "violet" },
    { "id": "n3", "label": "PostgreSQL 17", "sublabel": "Users + JSONB", "x": 470, "y": 36, "width": 165, "height": 62, "tone": "amber" }
  ],
  "edges": [
    { "from": "n1", "to": "n2", "label": "sso_token" },
    { "from": "n2", "to": "n3", "label": "Upsert" }
  ]
}
```

:::tip[WordPress 角色自動映射規則]
橋接器會自動將 WordPress 的 `administrator` 映射為本站 `admin`（可管理全站用戶與撰寫文章），將 `editor` / `author` 映射為 `author`（可進入 `/studio` 雙欄創作後台），一般訂閱者則映射為 `reader`。
??? 展開 wp-config.php 設定範例
於主站 `wp-config.php` 加入 `define('ICEHANDNOTE_SSO_SECRET', '與 Rust BLOG_SSO_SECRET 相同的密鑰');` 即可立即啟用。
:::
