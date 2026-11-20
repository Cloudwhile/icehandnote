# Changelog

All notable changes to **IceHandnote** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0-rc.2]: https://github.com/Cloudwhile/icehandnote/compare/v0.1.0-rc.1...v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/Cloudwhile/icehandnote/releases/tag/v0.1.0-rc.1
