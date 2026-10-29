#!/usr/bin/env bash
set -euo pipefail

# Start the Astro dev server behind Caddy using a stable *.localhost URL.
#
# Usage:
#   npm run dev
#   npm run dev -- my-custom-name
#
# Result:
#   http://<project-name>.localhost -> 127.0.0.1:<stable-port>

PROJECT_DIR="$(pwd)"
PROJECT_NAME="${1:-$(basename "$PROJECT_DIR")}"

# Normalize folder/project name into a safe local hostname.
SLUG="$(
  echo "$PROJECT_NAME" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
)"

if [ -z "$SLUG" ]; then
  echo "Could not derive a valid hostname from project name: $PROJECT_NAME"
  exit 1
fi

HOSTNAME="${SLUG}.localhost"

STATE_DIR="${HOME}/.local/share/devsite"
CADDYFILE="${STATE_DIR}/Caddyfile"
ROUTES_DIR="${STATE_DIR}/routes"
ROUTE_FILE="${ROUTES_DIR}/${SLUG}.caddy"

mkdir -p "$ROUTES_DIR"

if ! command -v caddy >/dev/null 2>&1; then
  echo "Caddy is not installed."
  echo "macOS: brew install caddy"
  echo "Arch:  sudo pacman -S caddy"
  echo "Ubuntu/Debian: install from https://caddyserver.com/docs/install"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed or not in PATH."
  exit 1
fi

# Stable project port derived from absolute path.
# Range: 54000-59999
HASH="$(printf '%s' "$PROJECT_DIR" | cksum | awk '{print $1}')"
PORT=$((54000 + HASH % 6000))

# Create the shared root Caddyfile if missing.
if [ ! -f "$CADDYFILE" ]; then
  cat > "$CADDYFILE" <<EOF
{
    auto_https off
}

import ${ROUTES_DIR}/*.caddy
EOF
fi

# Write or replace this project's route.
cat > "$ROUTE_FILE" <<EOF
http://${HOSTNAME} {
    reverse_proxy 127.0.0.1:${PORT}
}
EOF

caddy validate --config "$CADDYFILE" >/dev/null

if pgrep -f "caddy run --config ${CADDYFILE}" >/dev/null 2>&1; then
  caddy reload --config "$CADDYFILE" >/dev/null
else
  nohup caddy run --config "$CADDYFILE" >"${STATE_DIR}/caddy.log" 2>&1 &
  sleep 0.4
fi

echo
echo "Project: ${PROJECT_NAME}"
echo "URL:     http://${HOSTNAME}"
echo "Astro:   http://127.0.0.1:${PORT}"
echo "Caddy:   ${CADDYFILE}"
echo

# Listen on every interface so other devices on the network can reach the dev
# server too; Caddy proxies the *.localhost URL to the same port.
exec npm exec -- astro dev --host 0.0.0.0 --port "${PORT}"
