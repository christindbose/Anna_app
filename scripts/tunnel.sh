#!/usr/bin/env bash
# Expose the API (port 8000) to the internet over HTTPS with a Cloudflare quick tunnel, so the
# GitHub Pages front end can reach it. Prints a https://*.trycloudflare.com address; paste it into
# the app under "Server settings". Quick tunnels get a new address each start; for a fixed one,
# create a named tunnel in your Cloudflare account and run `cloudflared tunnel run <name>`.
# Set ANNA_APP_PASSWORD in .env before exposing the API.
set -euo pipefail
BIN="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
if [ ! -x "$BIN" ]; then
  mkdir -p "$(dirname "$BIN")"
  echo "downloading cloudflared to $BIN"
  curl -fsSL -o "$BIN" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$BIN"
fi
exec "$BIN" tunnel --no-autoupdate --url "http://127.0.0.1:${ANNA_API_PORT:-8000}"
