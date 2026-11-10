#!/usr/bin/env bash
# Aplica as migrações do DocQC (docqc/migrations/*.sql) que ainda não foram aplicadas.
# Regista-as em supabase_migrations.schema_migrations, a mesma tabela que o Supabase CLI usa.
# Corre dentro da pasta da instalação (ex.: /opt/docqc-supabase/docqc/apply-migrations.sh).
set -euo pipefail

cd "$(dirname "$0")/.."
psql() { docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

psql <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL

shopt -s nullglob
applied=0
for f in docqc/migrations/*.sql; do
  base="$(basename "$f" .sql)"
  version="${base%%_*}"
  name="${base#*_}"
  if [ "$(psql -c "select 1 from supabase_migrations.schema_migrations where version = '$version'")" = "1" ]; then
    continue
  fi
  echo "→ migração $base"
  # Uma transação por ficheiro: ou entra tudo, ou nada.
  { echo "begin;"; cat "$f"; echo;
    echo "insert into supabase_migrations.schema_migrations(version, name) values ('$version', '$name');"
    echo "commit;"; } | psql
  applied=$((applied + 1))
done
echo "Migrações aplicadas agora: $applied"
