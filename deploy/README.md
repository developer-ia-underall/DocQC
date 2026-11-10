# Lançar o DocQC nas máquinas próprias

Duas máquinas:

| Máquina | Papel | O que corre |
| --- | --- | --- |
| **A** (já tem o Supabase de outro projeto) | Backend | Uma **segunda** instância Supabase, só do DocQC: projeto Compose `docqc-supabase`, contentores `docqc-supabase-*`, rede, volumes e portas próprios. A instância existente não é tocada. |
| **B** | Front | A app (Node, SSR) e o **Caddy**, que serve HTTPS e encaminha as APIs do Supabase para a máquina A. |

```
navegador ──HTTPS──▶ B: Caddy ─┬─ /auth/v1, /rest/v1, /storage/v1, /realtime/v1 … ──▶ A: gateway Supabase :8100
                               └─ tudo o resto ──────────────────────────────────────▶ B: app Node :3000
```

A app e o Supabase ficam no **mesmo endereço** (`https://docqc.underall.com`, ou o IP da máquina B na fase 1). Vantagens: um só registo DNS e um só certificado, sem CORS, o navegador nunca fala diretamente com a máquina A e o painel do Supabase (Studio) não fica exposto à internet. A build do front usa `VITE_SUPABASE_URL=/`, por isso passar do IP para o domínio não obriga a recompilar.

Não é preciso uma terceira máquina: o Supabase cobre base de dados, autenticação, ficheiros, tempo real e funções.

## Requisitos

- Linux com **Docker** e o plugin **docker compose v2** (≥ 2.24) nas duas máquinas, mais `git`, `curl` e `openssl`.
- Na máquina A: as portas **8100** (gateway), **5532**, **6643** e **8125** livres (as três últimas só em 127.0.0.1). O script recusa arrancar se alguma estiver ocupada; escolha outras com `--api-port`, `--db-port`, `--pooler-port`.
- Na máquina B: portas **80** e **443** livres (ou outras, ver `HTTP_PORT`/`HTTPS_PORT`).
- A máquina B tem de chegar à porta 8100 da máquina A. Na firewall de A, permita a 8100 **só** a partir do IP de B (ex. `sudo ufw allow from <IP-B> to any port 8100 proto tcp`).

## Fase 1 — por IP (antes de apontar o domínio)

### 1. Máquina A: Supabase do DocQC

```bash
git clone https://github.com/developer-ia-underall/docqc.git ~/docqc
cd ~/docqc
sudo ./deploy/supabase/install.sh --site-url https://<IP-B>
```

O script:

1. descarrega o Supabase self-hosted oficial (versão fixa `self-hosted/v0.8.4`) para `/opt/docqc-supabase`, gera todos os segredos e chaves novos;
2. junta `docker-compose.docqc.yml`: nomes de contentores próprios, portas 8100/5532/6643, Postgres só em 127.0.0.1, código de 6 dígitos, modelos de e-mail em pt-PT e um **Mailpit** (caixa de correio de testes);
3. arranca a stack e aplica `supabase/migrations/` (registadas em `supabase_migrations.schema_migrations`, como no Supabase CLI);
4. mostra no fim a **chave pública** (`sb_publishable_…`) para o passo seguinte.

Pode voltar a correr o mesmo comando sem perigo: atualiza a configuração do DocQC e aplica migrações novas.

Confirmar que a outra instância continua intacta: `docker ps --format '{{.Names}}'` mostra os contentores antigos (`supabase-*`) e os novos (`docqc-supabase-*`) lado a lado.

### 2. Máquina B: front + Caddy

```bash
git clone https://github.com/developer-ia-underall/docqc.git ~/docqc
cd ~/docqc/deploy/web
cp .env.example .env
nano .env        # VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_UPSTREAM=<IP-A>:8100, DOCQC_SITE=https://<IP-B>
./deploy.sh
```

Abra `https://<IP-B>`. O navegador avisa que o certificado não é de confiança (é da CA interna do Caddy, porque ainda não há domínio): aceite. É preciso HTTPS mesmo nesta fase, porque o navegador só permite calcular o SHA-256 dos ficheiros (deteção de versões) em ligações seguras.

### 3. Primeiro acesso

1. Em **Criar conta**, use `efrancisco@underall.com` (fica logo administrador).
2. Enquanto não houver SMTP real, o e-mail com o código vai para o **Mailpit** da máquina A. Para o ver a partir do seu computador:
   ```bash
   ssh -L 8125:127.0.0.1:8125 <utilizador>@<IP-A>
   ```
   e abra `http://localhost:8125`.

## Fase 2 — domínio `docqc.underall.com`

1. **DNS**: crie um registo `A` `docqc` → IP **público** da máquina B (ou do router, com as portas 80 e 443 reencaminhadas para B). Confirme com `dig +short docqc.underall.com`.
2. **Máquina B**: em `deploy/web/.env` troque
   ```
   DOCQC_SITE=docqc.underall.com
   ACME_EMAIL=admin@underall.com
   ```
   e corra `docker compose up -d` (não precisa de recompilar). O Caddy obtém o certificado Let's Encrypt sozinho e renova-o.
3. **Máquina A**: aponte o Auth para o domínio (os links dos e-mails passam a usar este endereço):
   ```bash
   cd /opt/docqc-supabase
   sudo ./docqc/configure.sh --site-url https://docqc.underall.com
   ```

## E-mail a sério (SMTP)

Sem SMTP real ninguém recebe o código fora do Mailpit. Na máquina A:

```bash
cd /opt/docqc-supabase
sudo ./docqc/configure.sh --smtp-host smtp.resend.com --smtp-port 465 --smtp-user resend \
     --smtp-from no-reply@underall.com --smtp-name DocQC          # pede a palavra-passe
```

Funciona com qualquer SMTP (Resend, Microsoft 365, Google Workspace, Brevo…). Configure SPF/DKIM do domínio de envio para os e-mails não irem para o spam. Para voltar ao Mailpit: `--smtp-mailpit`.

## Máquinas partilhadas, LXC/Proxmox, sem portas 80/443

Quando as duas máquinas são contentores LXC (ex. Proxmox) partilhados
com outras aplicações em produção:

**Supabase (A).** Em LXC, o `runc` predefinido falha ao criar contentores
(`open sysctl net.ipv4.ip_unprivileged_port_start … permission denied`). Use um runtime que já
funcione na máquina (veja `docker info --format "{{json .Runtimes}}"`) e instale na pasta do utilizador:

```bash
cd ~/docqc
./deploy/supabase/install.sh --dir ~/docqc-supabase --site-url https://<IP-B>:8443 \
     --runtime <runtime> --check      # prepara e verifica o isolamento, sem arrancar nada
./deploy/supabase/install.sh --dir ~/docqc-supabase   # arranca e aplica as migrações
```

O `install.sh` recusa arrancar se o projeto Compose não se chamar `docqc-supabase` ou se algum
contentor colidir com outro projeto. O output do `setup.sh` oficial (que contém os segredos) vai
para um log privado, não para o ecrã.

**Front (B) sem Docker.** Se o Docker não arranca contentores e o nginx da máquina já ocupa a 80/443,
use o modo PM2: app Node com um Bun próprio (`~/.bun-docqc`) e um Caddy próprio (`~/.local/docqc`),
sem sudo e sem mexer no Node, no Bun nem no nginx das outras aplicações.

```bash
cd ~/docqc/deploy/web && cp .env.example .env && nano .env
#   VITE_SUPABASE_PUBLISHABLE_KEY=…   SUPABASE_UPSTREAM=<IP-A>:8100
#   DOCQC_SITE=https://<IP-B>:8443   DOCQC_DEFAULT_SNI=<IP-B>
#   DOCQC_CADDY_HTTP_PORT=8088   DOCQC_APP_PORT=3016
./pm2/deploy.sh          # build + pm2 startOrReload + pm2 save;  --pull para atualizar
```

**Migrações sem acesso ao Docker.** O dono de `~/docqc-supabase` pode ligar-se ao Postgres do DocQC
pelo pooler local (só 127.0.0.1): cópia de segurança com `pg_dump -n public -n supabase_migrations`,
aplicar o ficheiro numa transação com o registo em `supabase_migrations.schema_migrations`
(como faz `apply-migrations.sh`) e `notify pgrst, 'reload schema'`. Utilizador
`postgres.<POOLER_TENANT_ID>`, porta `DOCQC_DB_PORT`, palavra-passe `POSTGRES_PASSWORD` do `.env`.

## Operação

| Tarefa | Onde | Comando |
| --- | --- | --- |
| Atualizar o front | B | `~/docqc/deploy/web/deploy.sh --pull` |
| Novas migrações | A | `cd ~/docqc && git pull && sudo ./deploy/supabase/install.sh` |
| Logs do front | B | `cd ~/docqc/deploy/web && docker compose logs -f` |
| Logs do Supabase | A | `cd /opt/docqc-supabase && docker compose logs -f auth` |
| Painel Supabase (Studio) | A | `http://<IP-A>:8100/` (utilizador `docqc`, palavra-passe `DASHBOARD_PASSWORD` no `.env`) — só na rede interna |
| Cópia de segurança | A | `cd /opt/docqc-supabase && docker compose exec -T db pg_dump -U postgres -Fc postgres > docqc-$(date +%F).dump` |
| Parar só o DocQC | A | `cd /opt/docqc-supabase && docker compose down` (não mexe na outra instância) |

Os segredos ficam em `/opt/docqc-supabase/.env` (permissões 600). A chave `SERVICE_ROLE_KEY`/`SUPABASE_SECRET_KEY` nunca vai para o front.

## Ficheiros

```
deploy/supabase/install.sh                 instala/atualiza o Supabase do DocQC (máquina A)
deploy/supabase/docker-compose.docqc.yml   isolamento da outra instância + Auth do DocQC + Mailpit
deploy/supabase/configure.sh               muda URL do site e SMTP (copiado para /opt/docqc-supabase/docqc/)
deploy/supabase/apply-migrations.sh        aplica supabase/migrations que faltem
deploy/web/Dockerfile                      build SSR para Node (nitro node-server)
deploy/web/docker-compose.yml              app + Caddy (máquina B)
deploy/web/Caddyfile                       HTTPS e encaminhamento /auth/v1, /rest/v1, … para a máquina A
deploy/web/.env.example                    configuração da máquina B
deploy/web/deploy.sh                       build e arranque (máquina B)
deploy/web/pm2/deploy.sh                   build e arranque sem Docker, com PM2 (máquina B)
deploy/web/pm2/ecosystem.config.cjs        processos PM2 docqc-web e docqc-caddy
```
