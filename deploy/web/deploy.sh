#!/usr/bin/env bash
# Compila e (re)arranca o front do DocQC nesta máquina. Corre a partir de qualquer pasta.
#   ./deploy/web/deploy.sh            # build + arranque
#   ./deploy/web/deploy.sh --pull     # git pull antes (atualizar para a versão mais recente)
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "ERRO: falta deploy/web/.env (copie de .env.example e preencha)." >&2; exit 1; }
command -v docker >/dev/null && docker compose version >/dev/null 2>&1 \
  || { echo "ERRO: precisa de Docker com o plugin compose v2." >&2; exit 1; }

if [ "${1:-}" = "--pull" ]; then git -C ../.. pull --ff-only; fi

upstream="$(grep '^SUPABASE_UPSTREAM=' .env | cut -d= -f2-)"
if ! curl -fsS -o /dev/null -m 5 "http://${upstream}/auth/v1/health" -H "apikey: $(grep '^VITE_SUPABASE_PUBLISHABLE_KEY=' .env | cut -d= -f2-)"; then
  echo "AVISO: não consigo chegar a http://${upstream}/auth/v1/health. Verifique o IP/porta e a firewall da máquina do Supabase." >&2
fi

docker compose build web
docker compose up -d --remove-orphans
docker compose ps
site="$(grep '^DOCQC_SITE=' .env | cut -d= -f2-)"
echo
echo "DocQC a correr. Abra: ${site/#docqc/https://docqc}"
