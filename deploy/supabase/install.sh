#!/usr/bin/env bash
# Instala uma instância Supabase self-hosted SÓ para o DocQC, ao lado de outra que já exista
# na mesma máquina (nome de projeto, contentores, rede, volumes e portas próprios).
#
# Uso (na máquina do Supabase, a partir da pasta do repositório docqc):
#   ./deploy/supabase/install.sh --site-url https://<IP-da-máquina-do-front>
#
# Opções:
#   --dir <pasta>         Onde instalar (predefinição: /opt/docqc-supabase)
#   --site-url <url>      Endereço público da app (IP agora, domínio depois). Obrigatório.
#   --api-port <porta>    Porta do gateway da API no anfitrião (predefinição: 8100)
#   --db-port <porta>     Postgres (via pooler) em 127.0.0.1 (predefinição: 5532)
#   --pooler-port <porta> Pooler em modo transação em 127.0.0.1 (predefinição: 6643)
#   --ref <tag>           Versão do Supabase self-hosted (predefinição: self-hosted/v0.8.4)
#
# Pode correr outra vez sem perigo: se a pasta já existir, só atualiza a configuração do DocQC,
# arranca a stack e aplica migrações novas.
set -euo pipefail

INSTALL_DIR=/opt/docqc-supabase
SITE_URL=""
API_PORT=8100
DB_PORT=5532
POOLER_PORT=6643
MAILPIT_PORT=8125
REF=self-hosted/v0.8.4

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --site-url) SITE_URL="${2%/}"; shift 2 ;;
    --api-port) API_PORT="$2"; shift 2 ;;
    --db-port) DB_PORT="$2"; shift 2 ;;
    --pooler-port) POOLER_PORT="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    -h|--help) sed -n 2,19p "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $1" >&2; exit 1 ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

log()  { printf '\n==> %s\n' "$*"; }
die()  { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

# --- pré-requisitos ---------------------------------------------------------------------------
for bin in docker git openssl curl; do
  command -v "$bin" >/dev/null || die "falta '$bin' nesta máquina."
done
docker compose version >/dev/null 2>&1 || die "falta o plugin 'docker compose' (v2)."
docker info >/dev/null 2>&1 || die "sem acesso ao Docker (corra com sudo ou junte o utilizador ao grupo docker)."

set_env() { # set_env CHAVE valor  → substitui ou acrescenta no .env
  local k="$1" v="$2"
  if grep -q "^${k}=" .env; then
    # | como separador; escapa & e | no valor
    local esc; esc=$(printf '%s' "$v" | sed -e 's/[&|\\]/\\&/g')
    sed -i "s|^${k}=.*$|${k}=${esc}|" .env
  else
    printf '%s=%s\n' "$k" "$v" >> .env
  fi
}
get_env() { grep "^$1=" .env | head -n1 | cut -d= -f2-; }

port_busy() { # devolve 0 se a porta TCP estiver ocupada por algo que não é esta stack
  local p="$1"
  if command -v ss >/dev/null; then
    ss -Hltn "sport = :$p" 2>/dev/null | grep -q . || return 1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null || return 1
  fi
  # Ocupada: é nossa? (re-execução)
  docker ps --filter "label=com.docker.compose.project=docqc-supabase" --format '{{.Ports}}' | grep -q ":$p->" && return 1
  return 0
}

# --- 1. obter o Supabase oficial ----------------------------------------------------------------
FIRST_RUN=0
if [ ! -f "$INSTALL_DIR/.env" ]; then
  FIRST_RUN=1
  [ -n "$SITE_URL" ] || die "indique --site-url (ex.: https://192.168.1.20)."
  for p in "$API_PORT" "$DB_PORT" "$POOLER_PORT" "$MAILPIT_PORT"; do
    port_busy "$p" && die "a porta $p já está em uso nesta máquina (provavelmente pelo outro Supabase). Escolha outra com --api-port/--db-port/--pooler-port."
  done
  [ -e "$INSTALL_DIR" ] && die "$INSTALL_DIR existe mas não tem .env. Apague-a ou use --dir."

  log "A descarregar o Supabase self-hosted ($REF) para $INSTALL_DIR"
  parent="$(dirname "$INSTALL_DIR")"; name="$(basename "$INSTALL_DIR")"
  mkdir -p "$parent"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "https://raw.githubusercontent.com/supabase/supabase/${REF}/docker/setup.sh" -o "$tmp/setup.sh"
  # --skip-deps: não instala pacotes do sistema; -y: sem perguntas (os URLs são definidos abaixo).
  # O setup.sh oficial gera todas as chaves e segredos e descarrega as imagens.
  ( cd "$parent" && sh "$tmp/setup.sh" --skip-deps -y --ref "$REF" --project-dir "$name" )
fi

cd "$INSTALL_DIR"

# --- 2. ficheiros do DocQC ------------------------------------------------------------------------
log "A copiar a configuração do DocQC"
mkdir -p docqc/templates docqc/migrations
cp "$HERE/docker-compose.docqc.yml" ./docker-compose.docqc.yml
cp "$REPO"/supabase/templates/*.html docqc/templates/
cp "$REPO"/supabase/migrations/*.sql docqc/migrations/
cp "$HERE/apply-migrations.sh" "$HERE/configure.sh" docqc/
chmod +x docqc/*.sh

# --- 3. .env -----------------------------------------------------------------------------------
log "A ajustar o .env"
set_env COMPOSE_PROJECT_NAME docqc-supabase
set_env COMPOSE_FILE docker-compose.yml:docker-compose.docqc.yml
set_env API_GW_HTTP_PORT "$API_PORT"
set_env KONG_HTTP_PORT "$API_PORT"
set_env DOCQC_DB_PORT "$DB_PORT"
set_env DOCQC_POOLER_PORT "$POOLER_PORT"
set_env DOCQC_MAILPIT_PORT "$MAILPIT_PORT"
if [ "$FIRST_RUN" = 1 ]; then
  set_env STUDIO_DEFAULT_ORGANIZATION "Underall"
  set_env STUDIO_DEFAULT_PROJECT "DocQC"
  set_env POOLER_TENANT_ID "docqc"
  set_env DISABLE_SIGNUP false
  set_env ENABLE_EMAIL_SIGNUP true
  set_env ENABLE_EMAIL_AUTOCONFIRM false
  set_env ENABLE_PHONE_SIGNUP false
  set_env ENABLE_ANONYMOUS_USERS false
  # Até haver SMTP real, os e-mails vão para o Mailpit (ver configure.sh --smtp-*).
  set_env SMTP_HOST mailpit
  set_env SMTP_PORT 1025
  set_env SMTP_USER docqc
  set_env SMTP_PASS docqc
  set_env SMTP_ADMIN_EMAIL no-reply@underall.com
  set_env SMTP_SENDER_NAME DocQC
  # Palavra-passe do painel (Studio) mais forte do que a predefinida.
  set_env DASHBOARD_USERNAME docqc
  set_env DASHBOARD_PASSWORD "$(openssl rand -hex 16)"
fi
chmod 600 .env

# URLs (SITE_URL, API_EXTERNAL_URL, …) e arranque ficam no configure.sh, que também serve
# para mudar do IP para o domínio mais tarde.
if [ -n "$SITE_URL" ]; then
  ./docqc/configure.sh --site-url "$SITE_URL" --no-restart
fi

# --- 4. arrancar --------------------------------------------------------------------------------
log "A arrancar a stack docqc-supabase"
docker compose up -d --remove-orphans

log "A aguardar pela base de dados"
for _ in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U postgres -h localhost >/dev/null 2>&1; then break; fi
  sleep 2
done
docker compose exec -T db pg_isready -U postgres -h localhost >/dev/null || die "a base de dados não arrancou (docker compose logs db)."

# --- 5. migrações ----------------------------------------------------------------------------------
./docqc/apply-migrations.sh

# --- 6. resumo -----------------------------------------------------------------------------------
KEY="$(get_env SUPABASE_PUBLISHABLE_KEY)"; [ -n "$KEY" ] || KEY="$(get_env ANON_KEY)"
cat <<EOF

────────────────────────────────────────────────────────────────────────
 Supabase do DocQC pronto em $INSTALL_DIR  (projeto Compose: docqc-supabase)

 API (para o proxy da máquina do front):  http://<IP-desta-máquina>:$(get_env API_GW_HTTP_PORT)
 Chave pública (VITE_SUPABASE_PUBLISHABLE_KEY):
   $KEY

 Painel (Studio):  http://<IP-desta-máquina>:$(get_env API_GW_HTTP_PORT)/
   utilizador: $(get_env DASHBOARD_USERNAME)   palavra-passe: ver DASHBOARD_PASSWORD em $INSTALL_DIR/.env
 E-mails de teste (Mailpit): http://127.0.0.1:$(get_env DOCQC_MAILPIT_PORT)  (túnel SSH)
 Postgres (só local):  127.0.0.1:$(get_env DOCQC_DB_PORT)  utilizador postgres.$(get_env POOLER_TENANT_ID)

 Segredos em $INSTALL_DIR/.env (chmod 600). Nunca use a SERVICE_ROLE/SECRET key no front.
────────────────────────────────────────────────────────────────────────
EOF
