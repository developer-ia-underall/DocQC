#!/usr/bin/env bash
# Muda a configuração do Supabase do DocQC e reinicia só o que for preciso.
# Corre dentro da pasta da instalação (ex.: /opt/docqc-supabase/docqc/configure.sh).
#
#   ./docqc/configure.sh --site-url https://docqc.underall.com
#   ./docqc/configure.sh --smtp-host smtp.resend.com --smtp-port 465 --smtp-user resend \
#                        --smtp-from no-reply@underall.com          (pede a palavra-passe)
#   ./docqc/configure.sh --smtp-mailpit                              (volta à caixa de testes)
#
# --site-url: endereço público da app. As APIs do Supabase passam pelo mesmo endereço
# (o proxy da máquina do front encaminha /auth/v1, /rest/v1, …), por isso:
#   SITE_URL = SUPABASE_PUBLIC_URL = <url>   e   API_EXTERNAL_URL = <url>/auth/v1
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "ERRO: não encontro .env em $(pwd)" >&2; exit 1; }

SITE_URL=""; RESTART=1
SMTP_HOST=""; SMTP_PORT=""; SMTP_USER=""; SMTP_FROM=""; SMTP_NAME=""; MAILPIT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --site-url) SITE_URL="${2%/}"; shift 2 ;;
    --smtp-host) SMTP_HOST="$2"; shift 2 ;;
    --smtp-port) SMTP_PORT="$2"; shift 2 ;;
    --smtp-user) SMTP_USER="$2"; shift 2 ;;
    --smtp-from) SMTP_FROM="$2"; shift 2 ;;
    --smtp-name) SMTP_NAME="$2"; shift 2 ;;
    --smtp-mailpit) MAILPIT=1; shift ;;
    --no-restart) RESTART=0; shift ;;
    -h|--help) sed -n 2,13p "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $1" >&2; exit 1 ;;
  esac
done

set_env() {
  local k="$1" v="$2"
  if grep -q "^${k}=" .env; then
    local esc; esc=$(printf '%s' "$v" | sed -e 's/[&|\\]/\\&/g')
    sed -i "s|^${k}=.*$|${k}=${esc}|" .env
  else
    printf '%s=%s\n' "$k" "$v" >> .env
  fi
}

if [ -n "$SITE_URL" ]; then
  case "$SITE_URL" in http://*|https://*) ;; *) echo "ERRO: --site-url tem de começar por http:// ou https://" >&2; exit 1 ;; esac
  set_env SITE_URL "$SITE_URL"
  set_env SUPABASE_PUBLIC_URL "$SITE_URL"
  set_env API_EXTERNAL_URL "$SITE_URL/auth/v1"
  # Para testar o front localmente (bun run dev) contra este Supabase.
  set_env ADDITIONAL_REDIRECT_URLS "$SITE_URL/**,http://localhost:5173/**,http://127.0.0.1:5173/**"
  echo "SITE_URL = $SITE_URL"
fi

if [ "$MAILPIT" = 1 ]; then
  set_env SMTP_HOST mailpit; set_env SMTP_PORT 1025; set_env SMTP_USER docqc; set_env SMTP_PASS docqc
  echo "E-mails → Mailpit (testes)"
elif [ -n "$SMTP_HOST" ]; then
  [ -n "$SMTP_PORT" ] || SMTP_PORT=587
  read -r -s -p "Palavra-passe SMTP para ${SMTP_USER:-<sem utilizador>}@${SMTP_HOST}: " SMTP_PASS; echo
  set_env SMTP_HOST "$SMTP_HOST"; set_env SMTP_PORT "$SMTP_PORT"
  set_env SMTP_USER "$SMTP_USER"; set_env SMTP_PASS "$SMTP_PASS"
  [ -n "$SMTP_FROM" ] && set_env SMTP_ADMIN_EMAIL "$SMTP_FROM"
  [ -n "$SMTP_NAME" ] && set_env SMTP_SENDER_NAME "$SMTP_NAME"
  echo "E-mails → $SMTP_HOST:$SMTP_PORT"
fi

if [ "$RESTART" = 1 ]; then
  # "up -d" só recria os serviços cuja configuração mudou (auth, api-gw, studio…).
  docker compose up -d
fi
