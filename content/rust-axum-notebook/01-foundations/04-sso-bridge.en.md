+++
title = "Cross-Site WordPress SSO Bridge & Studio RBAC"
summary = "Sync external WordPress identities and roles via replay-safe HMAC-SHA256 tokens and unlock the live Studio editor."
step_number = 4
estimated_minutes = 10
synced_revision = 1
canonical_revision = 1
status = "published"
tags = ["SSO", "HMAC-SHA256", "RBAC", "WordPress"]
+++

## Verifying Signed Identities from an External WordPress Site

When your primary blog (e.g. `blog.example.com`) runs on WordPress, a lightweight MU-Plugin (`deploy/wordpress-sso-bridge.php`) reads the signed-in user's `ID`, `display_name`, `avatar_url`, and `roles`, mints a 5-minute HMAC-SHA256 ticket, and redirects back to your notes site.
:::margin[Bonus: Signing in automatically merges any anonymous margin notes saved during your guest session!]

```sketch caption="WordPress Cross-Site SSO & Studio RBAC Pipeline"
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

- [ ] Configure a shared 32+ char `BLOG_SSO_SECRET` on both WordPress and the API backend | Ensure HMAC verification and expiry checks succeed

## Automatic Role Mapping

:::tip[WordPress to Studio Role Mapping]
The bridge maps `administrator` to `admin` (full site settings and user management), `editor` / `author` to `author` (Studio editor access), and standard subscribers to `reader`.
??? View wp-config.php snippet
Add `define('ICEHANDNOTE_SSO_SECRET', 'same-secret-as-rust-env');` to `wp-config.php` to enable cross-site sign-in.
:::

- [ ] Complete an end-to-end SSO sign-in test | Confirm the resolved Studio role and guest note merge work as expected
