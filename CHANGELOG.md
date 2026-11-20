# Changelog

All notable changes to **IceHandnote** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0-rc.1]: https://github.com/Cloudwhile/icehandnote/releases/tag/v0.1.0-rc.1
