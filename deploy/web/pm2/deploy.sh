#!/usr/bin/env bash
# Compila e (re)arranca o front do DocQC com PM2, sem Docker. Não precisa de sudo.
#   ./deploy/web/pm2/deploy.sh          # build + arranque
#   ./deploy/web/pm2/deploy.sh --pull   # git pull antes
#
# Usa um Bun próprio (~/.bun-docqc, o bun.lock pede Bun ≥ 1.4) e um Caddy próprio
# (~/.local/docqc/caddy), para não mexer nas versões usadas por outras apps da máquina.
set -euo pipefail
cd "$(dirname "$0")/.."            # deploy/web
WEB="$(pwd)"; REPO="$(cd ../.. && pwd)"
CADDY_VERSION=2.10.2

[ -f .env ] || { echo "ERRO: falta deploy/web/.env (copie de .env.example e preencha)." >&2; exit 1; }
get() { grep "^$1=" .env | head -n1 | cut -d= -f2-; }
command -v pm2 >/dev/null || { echo "ERRO: falta o pm2." >&2; exit 1; }

if [ "${1:-}" = "--pull" ]; then git -C "$REPO" pull --ff-only; fi

BUN="$HOME/.bun-docqc/bin/bun"
if [ ! -x "$BUN" ]; then
  echo "→ a instalar Bun em ~/.bun-docqc"
  curl -fsSL https://bun.sh/install -o /tmp/bun-install.sh
  # O instalador acrescenta o PATH ao ~/.bashrc; guardamos e repomos para não mudar o bun das outras apps.
  cp ~/.bashrc /tmp/bashrc.docqc 2>/dev/null || true
  BUN_INSTALL="$HOME/.bun-docqc" bash /tmp/bun-install.sh >/dev/null
  [ -f /tmp/bashrc.docqc ] && cp /tmp/bashrc.docqc ~/.bashrc
fi

CADDY="$HOME/.local/docqc/caddy"
if [ ! -x "$CADDY" ]; then
  echo "→ a instalar Caddy $CADDY_VERSION em ~/.local/docqc"
  arch="$(uname -m)"; case "$arch" in x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; esac
  mkdir -p "$(dirname "$CADDY")"
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_${arch}.tar.gz" \
    | tar -xz -C "$(dirname "$CADDY")" caddy
fi

upstream="$(get SUPABASE_UPSTREAM)"
if ! curl -fsS -o /dev/null -m 5 "http://${upstream}/auth/v1/health" -H "apikey: $(get VITE_SUPABASE_PUBLISHABLE_KEY)"; then
  echo "AVISO: não consigo chegar a http://${upstream}/auth/v1/health. Verifique o IP/porta e a firewall." >&2
fi

echo "→ build"
cd "$REPO"
"$BUN" install --frozen-lockfile
VITE_SUPABASE_URL=/ VITE_SUPABASE_PUBLISHABLE_KEY="$(cd "$WEB" && get VITE_SUPABASE_PUBLISHABLE_KEY)" \
  NITRO_PRESET=node-server "$BUN" run build

echo "→ arranque"
pm2 startOrReload "$WEB/pm2/ecosystem.config.cjs" --update-env
pm2 save >/dev/null
pm2 ls | grep -E "docqc|name" || true
echo
echo "DocQC a correr. Abra: $(cd "$WEB" && get DOCQC_SITE)"
