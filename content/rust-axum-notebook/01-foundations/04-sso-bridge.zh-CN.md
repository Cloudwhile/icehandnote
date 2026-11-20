+++
title = "接入 WordPress 跨站单点登录与管理后台"
summary = "通过 HMAC-SHA256 防重放签名同步外部主站用户信息与角色权限，并在后台可视化编辑器中实时撰写文章。"
step_number = 4
estimated_minutes = 10
synced_revision = 1
canonical_revision = 1
status = "published"
tags = ["SSO", "HMAC-SHA256", "RBAC", "WordPress"]
+++

## 如何安全接入外部 WordPress 主站的已登录用户？

如果主站（例如 `blog.example.com`）运行于 WordPress，可以通过轻量的 MU-Plugin（`deploy/wordpress-sso-bridge.php`）读取当前登录用户的 `ID`、`display_name`、`avatar_url` 与 `roles`，签发 5 分钟有效期的 HMAC-SHA256 票据并跳转回本站。
:::margin[小提示：登录瞬间还会自动将访客期间保存的页边笔记合并进个人账号！]

```sketch caption="WordPress 跨站 SSO 与后台权限管线"
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

- [ ] 在主站与后端配置一致的 `BLOG_SSO_SECRET`（至少 32 位随机字符） | 确保票据签名与防重放校验一致

## 角色权限映射规则

:::tip[WordPress 角色自动映射]
桥接器会自动将 WordPress 的 `administrator` 映射为本站 `admin`（可管理全站用户、站点设置与文章内容），将 `editor` / `author` 映射为 `author`（可进入 `/studio` 编辑器），普通订阅者则映射为 `reader`。
??? 展开 wp-config.php 配置示例
在主站 `wp-config.php` 中加入 `define('ICEHANDNOTE_SSO_SECRET', '与 Rust BLOG_SSO_SECRET 相同的密钥');` 即可立即启用。
:::

- [ ] 使用主站账号完成一次 SSO 跳转登录 | 确认角色权限与访客笔记合并正常生效
