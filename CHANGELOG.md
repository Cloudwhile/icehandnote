# Changelog

All notable changes to **IceHandnote** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-rc.5] - 2026-11-22

### Added
- **W3C WebAuthn Passkeys Authentication & Governance**: Added passwordless Passkey sign-in and per-account Passkey management (register, rename, remove, `enable_passkeys` toggle) powered by server-side `ring` verification (ES256, EdDSA, RS256), `webauthn-polyfills`, Base64URL/rpId validation, and migration `0011_multi_oauth_and_passkeys.sql`.
- **Multi-OAuth Unbind & Lockout Guard**: Added `DELETE /api/v1/auth/me/oauth/{provider}` with `CannotUnbindLastAuth` enforcement (ensuring users never remove their sole sign-in method when lacking a password or secondary provider) plus OAuth sign-in anomaly OTP challenges.
- **Structured PostgreSQL Parameter Mode & Ban Notice Emails**: Added structured Host/Port/Database/Username/SSL connection editing with masked secret retention (`clear_password` support), and localized 4-locale `account_ban` suspension emails dispatched when admins suspend accounts.
- **Zero-Flash SSR Bootstrap & URL Tab Persistence**: Injected initial `siteSettings`, rendered `<title>`, custom favicon, and `color-scheme` metadata server-side into `index.html`, paired with client cache hydration and URL query persistence (`?tab=` / `?section=`) across reloads.

### Changed
- **Reusable Component Architecture & Clean Naming**: Decoupled monolithic Auth, Studio Settings, Studio Panel, Navigation, and Notebook views into shared reusable primitives (`ui/`, `auth/`, `navigation/`, `notebook/`, `studio/blocks/`, `studio/settings/`), split localization dictionaries into per-locale files under `apps/web/src/lib/locales/`, and removed all version-based identifiers (`i18nRc3.ts`, `0008_rc3_platform_features.sql` -> `0008_collaboration_and_moderation.sql`).
- **Unified Switch Sliders & Pure Segmented Capsule Tabs**: Upgraded `<SwitchRow>` binary toggles onto a cross-browser accessible CSS pill slider track + sliding thumb (`role="switch"` + `switch`) and streamlined `.mwg-tab` into pure segmented capsules with forced-colors support.

### Fixed
- **Refactoring UI Visual Audit & Accessibility Fixes**: Resolved `m-0` spacing collapse inside `space-y-*` containers, strengthened light-mode paper/input contrast (`--border-control` ≥ 3:1 WCAG 1.4.11), enforced WCAG 2.2 AA `≥ 24×24px` touch targets, softened secondary button hierarchy, persisted manual light/dark toggles over site defaults, eliminated 375px `StepProgressNav` truncation and trailing footer separator dots, compacted Studio Editor toolbars onto single rows at `1280×800`, aligned Command Search cards flush with a themed clear control, removed double borders & disabled self-actions in Studio Users, moved modal scrollbars inside `overflow-hidden` rounded bounds, auto-expanded Split Live Preview textareas via `field-sizing: content`, and restored clean single native dropdown arrows on `.ink-select`.

## [0.1.0-rc.4] - 2026-11-21

### Added
- **Dedicated Studio Settings Sub-Categories**: Split Studio Site Settings into five independent sub-categories (**General**, **OAuth Login**, **Data Storage**, **SMTP Mail**, and **Updates**), synchronized between the collapsible left sidebar sub-tree and a top accessible `focusgroup` sub-tab bar.
- **Multi-Provider OAuth 2.0 / OIDC Support**: Added `oauth_providers` list management with quick-add presets (GitHub, Google, Authentik / OIDC, Custom), per-provider client secret storage (`GET/PUT /api/v1/admin/oauth-secret`), shared callback URI routing (`/api/v1/auth/oauth/authorize?provider=<id>`), multi-provider sign-in buttons on the Login page, multi-provider binding in Personal Center, and full backward compatibility with legacy single-provider settings and env vars.
- **Self-Service Email Change with New-Email OTP Verification**: Added `POST /api/v1/auth/me/email/send-code` and `POST /api/v1/auth/me/email/verify` with email uniqueness checks, 60-second resend cooldown, 6-digit single-input `<OtpInput />` verification, Gravatar refresh, and a localized 4-locale hand-drawn `email_change` stationery email template with live Studio preview.
- **Safe HTML Custom Email Footer**: Enabled sanitized inline HTML (`<a>`, `<strong>`, `<em>`, `<code>`, `<small>`, `<br>`, `<p>`, restricted to `https`/`http`/`mailto` with automatic `rel="noopener noreferrer"` and email-safe link styling) in `email_footer_text` via `ammonia` (`sanitize_email_footer_html`, up to 1200 chars, preserving `{{site_name}}`).
- **Dirty-State Save Gating**: Disabled all save/apply controls across Studio Settings (General, OAuth, Storage, SMTP), the Studio Article Editor (including `Ctrl+S` on unchanged existing articles), and Personal Center (Profile & Password) until actual changes are made.

### Fixed
- **SMTP Reliability & Fast Delivery**: Hardened `lettre` SMTP delivery with IPv4-first DNS resolution (eliminating IPv6 AAAA blackhole hangs while preserving strict domain SNI/TLS verification), RFC 5321-compliant `EHLO` domain derivation, a strict 12-second total wall-clock timeout, automatic TLS/STARTTLS fallback on swapped 465/587 ports, and concurrent `JoinSet` dispatch for multi-collaborator takedown notifications.
- **Studio Desktop Double Scrollbar & Shell Detachment**: Added `position: relative` containing blocks for `.studio-shell` and `.sr-only` form labels and locked desktop `html`/`body` overflow while Studio is mounted so only a single thin `.studio-main` scrollbar renders and the shell can never pull off-screen.
- **Email Preview Auto-Height Fit**: Replaced fixed `720px`/`740px` iframe heights with scriptless `sandbox="allow-same-origin"` + `ResizeObserver` / `document.fonts.ready` dynamic height tracking so email previews tightly match real email content with zero trailing blank void.
- **Studio React Hook Order**: Moved `useCallback`/`useMemo` hooks in `StudioPage` above early auth guards, resolving React #310 on direct `/studio` page loads and React #300 on direct logout from `/studio`.

## [0.1.0-rc.3] - 2026-11-21

### Added
- **RFC 9457 Problem Details & Frontend Toast Localization**:
  - Standardized all backend API error responses to RFC 9457 (`Content-Type: application/problem+json` with `type`, `title`, `status`, `detail`, machine-readable `code`, and optional `meta`), English default diagnostics, RFC 9110 status codes, and RFC 6750 `WWW-Authenticate: Bearer realm="icehandnote"` headers on `401 Unauthorized`.
  - Added a centralized frontend `ToastProvider` (`useToast()`) and 4-locale (`zh-CN`, `en`, `zh-TW`, `ja`) error catalog (`apiError.ts`) so all backend error codes and action confirmations are intercepted and rendered in the active UI language.
- **Image Blocks & Secure Media Upload Pipeline**:
  - Added native `image` blocks in Markdown parsing (`![alt](url)` with optional caption & margin notes), `NotebookBlockRenderer`, `VisualBlockEditor`, and Studio Markdown toolbar upload.
  - Added authenticated media upload endpoints (`/api/v1/uploads`, `/api/v1/studio/uploads`) with magic-byte validation and `/uploads/{ym}/{filename}` delivery featuring SHA-256 ETag, `304 Not Modified`, `X-Content-Type-Options: nosniff`, and CSP sandboxing.
- **Standalone Auth Flow Pages, Single-Input 6-Slot OTP Forms, Session/Device Governance & Hand-Drawn Stationery Emails**:
  - Migrated Sign In, 2-step Registration, strict 3-step Gated Forgot/Reset Password (`Email -> OTP Verification -> New Password + Confirm Password`), and OAuth Onboarding to dedicated distraction-free standalone flow pages (`/:locale/auth/login`, `/:locale/auth/register`, `/:locale/auth/forgot-password`, `/:locale/auth/reset-password`, `/:locale/auth/onboarding` + `/login`, `/register`) built to `modern-web-guidance` standards: single native `<input autocomplete="one-time-code" inputmode="numeric">` layered over 6 tactile digit slots (`OtpInput`), debounced live username uniqueness check (`GET /api/v1/auth/check-username`), `sessionStorage`-persisted + server-enforced 60-second OTP resend cooldowns (`POST /api/v1/auth/forgot-password` / `register/send-code` / `login/resend-otp`), gated reset OTP verification (`POST /api/v1/auth/verify-reset-otp`), advisory-only native `<progress>` visual password strength meter (`PasswordStrengthMeter`) across every password creation/modification surface (Register, Reset Password, Personal Center, Admin Create/Reset User), post-interaction `:user-invalid` + `aria-invalid` / `aria-describedby` synchronization (`useAccessibleFormValidation`), `:autofill` harmonization, single-circle `sr-only` native `<input type="radio">` role cards, inline `aria-pressed` password reveal buttons, and `<nav aria-current="step">` multi-step progress headers.
  - Added per-session IP address, User-Agent device parsing (`Chrome · Windows`, `Safari · macOS`, mobile/desktop kind), device fingerprinting (`X-Device-Id`), `last_seen_at` tracking, and self-service **Devices & Sessions** management (`GET/DELETE /api/v1/auth/sessions`, `POST /api/v1/auth/sessions/revoke-others`) in the Personal Center modal (with WCAG 1.4.1 shape-underlined `focusgroup` tabs).
  - Added anomalous sign-in detection (`new_ip`, `new_device`, `new_ip_and_device`) triggering a 6-digit email OTP challenge (`POST /api/v1/auth/login/verify-otp`, `POST /api/v1/auth/login/resend-otp`) detailing detected IP, device, time, and reason.
  - Redesigned all 6 HTML email templates (`register_code`, `login_anomaly`, `reset`, `invite`, `takedown`, `test`) across all 4 site locales (`zh-CN`, `en`, `zh-TW`, `ja`) in an authentic **Hand-Drawn Loose-Leaf Stationery** aesthetic (dot-grid drafting-paper desk canvas, sepia-ink outlined archival sheet with asymmetric corners & stacked paper-edge shadow, tilted dashed rubber stamp pill, pastel highlighter title stroke, double-framed perforated OTP coupon ticket, tactile ink-outlined CTA button, zero top horizontal color bar, live site logo embedding, WCAG AA/AAA verified) with **customizable email footer** (`email_footer_text`, supporting `{{site_name}}`) and live 4-locale preview in Studio Settings.
  - Added configurable self-registration (`allow_registration`, `allow_author_registration`) requiring 6-digit email verification codes (`POST /api/v1/auth/register/send-code` with SHA-256 email-bound hashing, 10-minute expiry, 60-second resend cooldown returning RFC 9457 `429` + `Retry-After`, and 5-attempt lockout), Reader/Author role selection, Gravatar mirror support, and custom uploaded/OAuth/monogram avatar sources (`UserProfileModal` + `UserAvatar`).
  - Added full OAuth 2.0 / OIDC sign-in, first-time onboarding (create new account or link existing local account), and existing-account OAuth binding from Profile & Security.
  - Added SMTP mail delivery (`lettre`) with admin configuration, live test email, sandboxed Desktop/Mobile live template preview (`POST /api/v1/admin/smtp/preview`), and self-service Forgot/Reset/Change Password flows.
- **3-Zone WordPress / Canva-Style Article Editor & Refactoring UI Polish**:
  - Redesigned the Studio article editor into three separated zones: top Workbench Action Bar & Contextual Tool Strip (`VisualBlockToolStrip` / Markdown snippets), center Writing & Design Canvas (supporting both Visual View and Source Code View plus toggleable side-by-side Live Preview), and collapsible right Article Inspector (`StudioEditorInspector`).
  - Completed full Refactoring UI visual audit & fixes: Top-Layer `popover="manual"` Toasts above modal dialogs, mint-green success toasts, unified `.ink-field-input`/`.ink-field-label` form primitives, desktop sidebar-integrated TOC with zero footer overlap, mobile 375px Studio topbar & non-scrolling stacked tables, softened dark-mode borders & stacked sheet tabs, and HTTP `200 OK` SPA route fallback.
- **Co-Author Collaboration, Admin Governance & Live Storage Switching**:
  - Added multi-author article attribution, email-based co-author invitation links (with auto-accept after login), invite revocation, and collaborator removal.
  - Added Admin moderation & governance: article takedown (with reason banner and author email notification) & restore, track/chapter deletion, user creation, suspension/banning with session revocation, admin password reset, and user deletion.
  - Added live storage backend inspection, PostgreSQL connection test, and runtime hot-switch between built-in local storage and PostgreSQL in Studio Settings.
  - Added automatic reading-time estimation, automatic version incrementing, sanitized inline HTML support for brand/track/article titles, and a clean starter `content/getting-started/` welcome track.

## [0.1.0-rc.2] - 2026-11-20

### Added
- **Docker Persistence & Admin Bootstrap**:
  - Added `DATA_DIR` (`/app/data`) and `CONTENT_DIR` (`/app/content`) persistence volumes with `docker-entrypoint.sh` (`gosu` privilege drop, automatic ownership fix for host bind mounts, and automatic starter content seeding on empty volumes).
  - Added startup administrator bootstrap via `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_EMAIL`, and `ADMIN_DISPLAY_NAME` across both built-in local storage and PostgreSQL (auto-generating and logging an initial password on first boot when omitted).
  - Extended `icehandnote-cli create-admin` to support standalone local storage (`DATA_DIR`) in addition to PostgreSQL.

### Fixed
- **Simplified & Traditional Chinese Typography**: Isolated CJK font stacks per locale, loaded `LXGW WenKai Screen` (GB standard strokes), removed Japanese-only `Klee One` and unhinted `KaiTi` fallbacks from Chinese locales, and scoped `font-size-adjust: from-font` to Latin pages.
- **Code Card Copy over HTTP**: Added synchronous selection fallback when `navigator.clipboard` is unavailable in non-HTTPS contexts (`http://<ip>:<port>`), plus an external `role="status"` live region for screen readers.
- **Reader Block Width Alignment**: Removed redundant `65ch` caps and unconditional `220px` right margin reservation on blocks without margin sticky notes so code cards, tasks, quotes, lists, and prose span the full sheet width.
- **GHCR Version Badge Latency**: Switched GHCR version tracking to GitHub Deployments API with `cacheSeconds=60` and automatic GitHub Camo cache purge in CI.

## [0.1.0-rc.1] - 2026-11-20

### Added

- **Hand-Drawn Notebook & Stationery Reader**:
  - Dual-theme drafting code cards supporting 4 paper styles (`washi` grid, `spiral` ruled, `index` paperclip card, `torn` draft slip) with WCAG AA syntax highlighting.
  - 3-axis decoupled in-article stickers (9 semantic alert types × 7 physical silhouettes × 6 dual-theme paper palettes + custom stamp badges).
  - Author and reader margin sticky notes attachable to both prose paragraphs and code cards.
  - Rough.js hand-drawn architecture diagrams and double-stroke marker headings.
  - Per-article and site-default Creative Commons (`CC 4.0` variants, `CC0 1.0`, `All Rights Reserved`) postmark license selector and deed links.
- **Dual-Scope Checkable Tasks**:
  - Section-level milestone tasks (`## [ ] Heading`) and inline paragraph task checkpoints (`- [ ] Title | Detail`) with persistent progress tracking.
- **Multilingual Studio Workspace (`/:locale/studio`)**:
  - Lossless bidirectional visual block editor and raw Markdown source editor with configurable draft auto-save.
  - 4-locale (`en`, `zh-CN`, `zh-TW`, `ja`) translation catalog matrix with canonical revision drift detection.
  - Live white-label site identity, theme, locale, feature toggles, and built-in upstream version / GHCR update checker.
- **Storage, Deployment & Authentication**:
  - Built-in zero-dependency local file storage (`LocalSeedRepository`) out of the box, plus optional external PostgreSQL 17 (PGroonga) full-text search backend.
  - Argon2id local user authentication, CLI admin bootstrap (`icehandnote-cli`), and optional WordPress HMAC-SHA256 cross-site SSO bridge (`deploy/wordpress-sso-bridge.php`).
  - Automated CI/CD workflows for workspace tests, standalone Windows & Linux executable bundles, and verified GHCR OCI container images.

[0.1.0-rc.5]: https://github.com/Cloudwhile/icehandnote/compare/v0.1.0-rc.4...v0.1.0-rc.5
[0.1.0-rc.4]: https://github.com/Cloudwhile/icehandnote/compare/v0.1.0-rc.3...v0.1.0-rc.4
[0.1.0-rc.3]: https://github.com/Cloudwhile/icehandnote/compare/v0.1.0-rc.2...v0.1.0-rc.3
[0.1.0-rc.2]: https://github.com/Cloudwhile/icehandnote/compare/v0.1.0-rc.1...v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/Cloudwhile/icehandnote/releases/tag/v0.1.0-rc.1
