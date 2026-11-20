# syntax=docker/dockerfile:1

# ==============================================================================
# Stage 1: Build Frontend SPA (Vite 6 + React 19 + Tailwind CSS v4)
# ==============================================================================
FROM node:22-bookworm-slim AS web-builder
RUN npm install -g pnpm@10
WORKDIR /src/apps/web

COPY apps/web/package.json apps/web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY apps/web/ ./
RUN pnpm build

# ==============================================================================
# Stage 2: Build Rust Binaries (`icehandnote-api` & `icehandnote-cli`)
# ==============================================================================
FROM rust:1-bookworm AS rust-builder
WORKDIR /src

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

RUN cargo build --release --locked --bin icehandnote-api --bin icehandnote-cli

# ==============================================================================
# Stage 3: Minimal Production Runtime
# ==============================================================================
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gosu \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 icehandnote

WORKDIR /app

COPY --from=rust-builder /src/target/release/icehandnote-api /usr/local/bin/icehandnote-api
COPY --from=rust-builder /src/target/release/icehandnote-cli /usr/local/bin/icehandnote-cli
COPY --from=web-builder /src/apps/web/dist /app/web
COPY content /usr/share/icehandnote/seed-content
COPY content /app/content
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/data /app/content \
    && chown -R icehandnote:icehandnote /app

ENV API_HOST=0.0.0.0 \
    API_PORT=3001 \
    WEB_DIST_DIR=/app/web \
    DATA_DIR=/app/data \
    CONTENT_DIR=/app/content \
    DEFAULT_LOCALE=en \
    SITE_NAME=IceHandnote \
    SITE_HERO_TITLE=IceHandnote \
    SITE_HERO_TAGLINE="Write clearly. Learn step by step." \
    DEV_SSO_SIMULATOR=false \
    SEED_DEMO_USERS=false

VOLUME ["/app/data", "/app/content"]

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3001/api/v1/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["icehandnote-api"]
