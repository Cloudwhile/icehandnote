<div align="center">

# IceHandnote

**开源、可白标定制的多语言手写风笔记与技术文章平台。**

[English](../README.md) | **简体中文**

[![Test](https://img.shields.io/github/actions/workflow/status/Cloudwhile/icehandnote/test.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=Test)](https://github.com/Cloudwhile/icehandnote/actions/workflows/test.yml)
[![Docker Build](https://img.shields.io/github/actions/workflow/status/Cloudwhile/icehandnote/docker.yml?branch=main&style=for-the-badge&logo=docker&logoColor=white&label=Docker%20Build)](https://github.com/Cloudwhile/icehandnote/actions/workflows/docker.yml)
[![Binaries](https://img.shields.io/github/actions/workflow/status/Cloudwhile/icehandnote/binaries.yml?branch=main&style=for-the-badge&logo=rust&logoColor=white&label=Binaries)](https://github.com/Cloudwhile/icehandnote/actions/workflows/binaries.yml)
[![Release](https://img.shields.io/github/v/release/Cloudwhile/icehandnote?include_prereleases&sort=semver&style=for-the-badge&logo=github&logoColor=white&label=Release&color=7c3aed)](https://github.com/Cloudwhile/icehandnote/releases)
[![GHCR](https://img.shields.io/badge/dynamic/xml?url=https%3A%2F%2Fghcr-badge.egpl.dev%2Fcloudwhile%2Ficehandnote%2Flatest_tag%3Fignore%3Dlatest%2Cmain&query=%2F%2F*%5Blocal-name()%3D'g'%5D%5B3%5D%2F*%5Blocal-name()%3D'text'%5D%5B2%5D&style=for-the-badge&logo=docker&logoColor=white&label=GHCR&color=2496ED&cacheSeconds=300)](https://github.com/Cloudwhile/icehandnote/pkgs/container/icehandnote)
[![License: AGPL v3](https://img.shields.io/github/license/Cloudwhile/icehandnote?style=for-the-badge&logo=gnu&logoColor=white&color=0d9488&label=License)](../LICENSE)

<br />

<img src="../docs/preview.png" alt="IceHandnote Homepage Preview" width="100%" />

</div>

---

## 核心特性

- **手账与工程草稿纸视觉体系**：
  - 双主题工程手账代码卡，支持胶带方格（`washi`）、线圈横格（`spiral`）、回形针索引卡（`index`）、手撕草稿（`torn`）四种纸张形态，全部语法高亮 Token 满足 WCAG AA 对比度标准。
  - 三轴解耦正文贴纸系统（9 种语义类型 × 7 种物理轮廓 × 6 套双主题配色 + 自定义角标），以及可同时吸附在正文段落与代码卡旁的读者/作者页边便签。
  - 支持作者按单篇文章自由选择 Creative Commons 许可协议（CC 4.0 全系列、CC0 1.0、保留所有权利），文章底部渲染手绘邮戳印章卡并自动匹配当前语种官方契约链接。
- **双模式文章内可勾选任务（节任务 & 段任务）**：
  - **节任务（`## [ ] 标题`）**：将整个小节设为可勾选里程碑，顶部标题复选框与节末完成按钮双向联动。
  - **段任务（`- [ ] 标题 | 说明`）**：在段落之间穿插轻量检查点，勾选进度自动同步。
- **可视化块编辑器 + Markdown 源码双模式（`/:locale/studio`）**：
  - 可视化块编辑与 Markdown 源码无损双向同步、可配置草稿自动保存、四语系（`zh-CN` / `en` / `zh-TW` / `ja`）翻译目录矩阵与主版本漂移检测。
- **白标定制与可选外部数据库 / SSO 桥接**：
  - 默认内置零外部依赖本地文件存储（也可通过 `DATABASE_URL` 连接外部 PostgreSQL 17 + PGroonga），后台「站点设置」实时配置站点名称、主题、启用语种与默认许可协议，内置 Argon2 本地账号与可选 WordPress HMAC-SHA256 单点登录桥接插件（`deploy/wordpress-sso-bridge.php`）。

---

## 发行版（Release）与 Docker 镜像版本

### 1. Windows & Linux 独立可执行包

每次推送均由 [GitHub Actions](https://github.com/Cloudwhile/icehandnote/actions/workflows/binaries.yml) 自动编译打包（内置 `icehandnote-api`、`icehandnote-cli`、`web/` 前端静态产物与 `content/` 示例内容），推送 `v*` 版本标签时自动发布至 [GitHub Releases](https://github.com/Cloudwhile/icehandnote/releases)：

| 平台 | 编译目标 | 发行压缩包 | SHA-256 校验文件 |
| :--- | :--- | :--- | :--- |
| **Windows (x64)** | `x86_64-pc-windows-msvc` | `icehandnote-windows-x86_64.zip` | `icehandnote-windows-x86_64.zip.sha256` |
| **Linux (x64)** | `x86_64-unknown-linux-gnu` | `icehandnote-linux-x86_64.tar.gz` | `icehandnote-linux-x86_64.tar.gz.sha256` |

### 2. GitHub Container Registry (GHCR) 容器镜像

| 镜像标签 | 说明 |
| :--- | :--- |
| `ghcr.io/cloudwhile/icehandnote:<tag>` | 已发布版本标签镜像（按发布 `tag` 作为版本号，如 `v0.1.0`） |
| `ghcr.io/cloudwhile/icehandnote:sha256-<digest>` | 未发布标签的最新构建镜像（按镜像 `sha256` 摘要作为版本号） |
| `ghcr.io/cloudwhile/icehandnote:latest` | `main` 主分支最新构建镜像 |

---

## 快速启动

### 方式一：Docker / Docker Compose

```bash
# 构建并启动独立容器（默认使用内置本地存储，也可通过 DATABASE_URL 连接外部 PostgreSQL）
docker compose up -d --build

# 或直接运行 GHCR 预构建镜像
docker run -d --name icehandnote -p 3001:3001 ghcr.io/cloudwhile/icehandnote:latest
```

启动后访问 `http://127.0.0.1:3001`。

### 方式二：Windows / Linux 独立可执行包

下载对应平台压缩包并解压后直接运行：

```bash
# Linux
./icehandnote-api

# Windows PowerShell
.\icehandnote-api.exe
```

`icehandnote-api` 会自动托管同目录下的 `web/` 前端资源与 `content/` 笔记目录，默认监听 `http://127.0.0.1:3001`。

### 方式三：本地源码开发

```bash
cp .env.example .env

# 1. 启动 Rust Axum API 后端（http://127.0.0.1:3001）
cargo run -p icehandnote-api

# 2. 启动 Vite 前端开发服务（http://127.0.0.1:5173）
pnpm --dir apps/web install
pnpm --dir apps/web dev
```

### 创建管理员账号（外部 PostgreSQL 模式）

```bash
cargo run -p icehandnote-cli -- create-admin \
  --username admin \
  --email admin@example.com \
  --display-name "Admin" \
  --role admin
```

> 可通过环境变量 `ADMIN_PASSWORD` 指定密码；未指定时 CLI 会自动生成高强度随机密码并仅输出一次。

---

## 开源协议

本项目基于 [GNU Affero General Public License v3.0](../LICENSE) 协议开源 · Copyright © [Cloudwhile](https://github.com/Cloudwhile)。
