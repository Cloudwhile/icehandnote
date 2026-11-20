#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"
CONTENT_DIR="${CONTENT_DIR:-/app/content}"
SEED_DIR="/usr/share/icehandnote/seed-content"

mkdir -p "$DATA_DIR" "$CONTENT_DIR"

# Seed starter notebooks into an empty host bind-mounted CONTENT_DIR unless disabled
if [ "${SEED_DEFAULT_CONTENT:-true}" != "false" ] && [ -d "$SEED_DIR" ]; then
  if [ -z "$(ls -A "$CONTENT_DIR" 2>/dev/null)" ]; then
    cp -R "$SEED_DIR"/. "$CONTENT_DIR"/
  fi
fi

# Ensure unprivileged `icehandnote` user can write to bind-mounted host volumes
if [ "$(id -u)" = "0" ]; then
  chown -R icehandnote:icehandnote "$DATA_DIR" "$CONTENT_DIR"
  exec gosu icehandnote "$@"
fi

exec "$@"
