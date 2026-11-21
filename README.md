<div align="center">

# IceHandnote

**Open-source, white-label multilingual hand-drawn notebook & technical article platform.**

**English** | [简体中文](./locales/README.zh-CN.md)

[![Test](https://img.shields.io/github/actions/workflow/status/Cloudwhile/icehandnote/test.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=Test)](https://github.com/Cloudwhile/icehandnote/actions/workflows/test.yml)
[![Docker Build](https://img.shields.io/github/actions/workflow/status/Cloudwhile/icehandnote/docker.yml?branch=main&style=for-the-badge&logo=docker&logoColor=white&label=Docker%20Build)](https://github.com/Cloudwhile/icehandnote/actions/workflows/docker.yml)
[![Binaries](https://img.shields.io/github/actions/workflow/status/Cloudwhile/icehandnote/binaries.yml?branch=main&style=for-the-badge&logo=rust&logoColor=white&label=Binaries)](https://github.com/Cloudwhile/icehandnote/actions/workflows/binaries.yml)
[![Release](https://img.shields.io/github/v/release/Cloudwhile/icehandnote?include_prereleases&sort=semver&style=for-the-badge&logo=github&logoColor=white&label=Release&color=7c3aed&cacheSeconds=60)](https://github.com/Cloudwhile/icehandnote/releases)
[![GHCR](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.github.com%2Frepos%2FCloudwhile%2Ficehandnote%2Fdeployments%3Fenvironment%3Dghcr%26per_page%3D1&query=%24%5B0%5D.payload.version&style=for-the-badge&logo=docker&logoColor=white&label=GHCR&color=2496ED&cacheSeconds=60)](https://github.com/Cloudwhile/icehandnote/pkgs/container/icehandnote)
[![License: AGPL v3](https://img.shields.io/github/license/Cloudwhile/icehandnote?style=for-the-badge&logo=gnu&logoColor=white&color=0d9488&label=License)](./LICENSE)

<br />

<img src="./docs/preview.png" alt="IceHandnote Homepage Preview" width="100%" />

</div>

---

## Highlights

- **Hand-Drawn Notebook & Drafting Paper Aesthetics**:
  - Dual-theme drafting code cards supporting 4 stationery styles (`washi` grid, `spiral` ruled, `index` paperclip card, `torn` draft slip) with WCAG AA syntax highlighting and HTTP/HTTPS clipboard support.
  - 3-axis decoupled in-article stickers (9 semantic types × 7 physical silhouettes × 6 dual-theme paper palettes + custom stamp badges) and interactive margin sticky notes on both paragraphs and code cards.
  - Per-article Creative Commons license selector (all CC 4.0 variants, CC0 1.0, All Rights Reserved) rendered as a hand-drawn postmark stamp card with localized CC deed links.
- **Dual-Scope Checkable Tasks**:
  - **Section Tasks (`## [ ] Heading`)**: Turn an entire section into a checkable milestone synced between heading and section footer.
  - **Paragraph Tasks (`- [ ] Title | Detail`)**: Inline checkable tasks woven between prose with persistent progress tracking.
- **Visual Block Editor + Lossless Markdown (`/:locale/studio`)**:
  - Bidirectional visual block editor and raw Markdown source editor with configurable draft auto-save, 4-locale (`en`, `zh-CN`, `zh-TW`, `ja`) translation matrix, canonical revision drift detection, and upstream update checker.
- **Flexible White-Label & Auth**:
  - Built-in zero-DB local storage (`DATA_DIR/store.json`) with optional external PostgreSQL 17 + PGroonga support, automatic initial admin bootstrap via environment variables, and optional WordPress HMAC-SHA256 cross-site SSO bridge (`deploy/wordpress-sso-bridge.php`).

---

## Releases & Docker Images

### 1. Executable Releases (Windows & Linux)

Pre-built standalone bundles (containing `icehandnote-api`, `icehandnote-cli`, compiled `web/` SPA assets, and `content/`) are built automatically on every push via [GitHub Actions](https://github.com/Cloudwhile/icehandnote/actions/workflows/binaries.yml) and published on tagged [GitHub Releases](https://github.com/Cloudwhile/icehandnote/releases):

| Platform | Target | Archive | Checksum |
| :--- | :--- | :--- | :--- |
| **Windows (x64)** | `x86_64-pc-windows-msvc` | `icehandnote-windows-x86_64.zip` | `icehandnote-windows-x86_64.zip.sha256` |
| **Linux (x64)** | `x86_64-unknown-linux-gnu` | `icehandnote-linux-x86_64.tar.gz` | `icehandnote-linux-x86_64.tar.gz.sha256` |

### 2. GitHub Container Registry (GHCR) Images

| Image Tag | Description |
| :--- | :--- |
| `ghcr.io/cloudwhile/icehandnote:<tag>` | Published release tag version (e.g. `v0.1.0-rc.5`) |
| `ghcr.io/cloudwhile/icehandnote:latest` | Latest published `v*` release tag (only updated on tag pushes, never on `sha256-*` branch builds) |
| `ghcr.io/cloudwhile/icehandnote:sha256-<digest>` | Unreleased `main` branch snapshot versioned by container `sha256` digest |

---

## Quick Start

### Option A: Docker One-Line Deploy (with Persistence & Admin Credentials)

```bash
docker run -d \
  --name icehandnote \
  --restart unless-stopped \
  -p 3001:3001 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/content:/app/content \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=ChangeMe_StrongPassword \
  -e DEFAULT_LOCALE=en \
  ghcr.io/cloudwhile/icehandnote:latest
```

Or with **Docker Compose** (configure `ADMIN_PASSWORD` in `.env` or environment):

```bash
cp .env.example .env
docker compose up -d
```

Open `http://127.0.0.1:3001` (Studio admin workspace: `http://127.0.0.1:3001/en/studio`).

### Deployment & Persistence Parameters

| Variable / Mount | Default (Docker) | Description |
| :--- | :--- | :--- |
| `-v ./data:/app/data` (`DATA_DIR`) | `/app/data` | Persists accounts, sessions, site settings, margin notes, likes, and task progress (`store.json`). |
| `-v ./content:/app/content` (`CONTENT_DIR`) | `/app/content` | Persists Markdown articles and `track.toml` manifests (auto-seeded on first start when empty). |
| `ADMIN_USERNAME` | `admin` | Initial administrator username created/updated on startup. |
| `ADMIN_PASSWORD` | *(auto-generated)* | Initial administrator password. If omitted on first boot, a random password is generated and printed in `docker logs icehandnote`. |
| `ADMIN_EMAIL` | `admin@localhost` | Initial administrator email address. |
| `DEFAULT_LOCALE` | `en` | Default site language (`en`, `zh-CN`, `zh-TW`, `ja`). |
| `SITE_NAME` | `IceHandnote` | Default site brand name (editable live in Studio → Site Settings). |
| `DATABASE_URL` | *(unset)* | Optional external PostgreSQL 17 (PGroonga) connection string. |

### Option B: Standalone Executable Bundle (Windows / Linux)

Extract the platform archive from Releases and run:

```bash
# Linux
ADMIN_USERNAME=admin ADMIN_PASSWORD=ChangeMe_StrongPassword DATA_DIR=./data ./icehandnote-api

# Windows PowerShell
$env:ADMIN_USERNAME="admin"; $env:ADMIN_PASSWORD="ChangeMe_StrongPassword"; $env:DATA_DIR="./data"; .\icehandnote-api.exe
```

`icehandnote-api` automatically serves `./web`, `./content`, and `./data/store.json` on `http://127.0.0.1:3001`.

### Option C: Local Development from Source

```bash
cp .env.example .env

# 1. Start Rust Axum API server (http://127.0.0.1:3001)
cargo run -p icehandnote-api

# 2. Start Vite dev server (http://127.0.0.1:5173)
pnpm --dir apps/web install
pnpm --dir apps/web dev
```

### Reset or Create Accounts via CLI

```bash
# Works with both built-in local storage (DATA_DIR) and external PostgreSQL (DATABASE_URL)
icehandnote-cli create-admin \
  --username admin \
  --email admin@example.com \
  --display-name "Admin" \
  --role admin \
  --password "ChangeMe_StrongPassword"
```

---

## License

Licensed under the [GNU Affero General Public License v3.0](./LICENSE) · Copyright © [Cloudwhile](https://github.com/Cloudwhile).
