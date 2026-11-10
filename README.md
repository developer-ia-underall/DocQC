# DocQC

Controlo de qualidade de documentos: análise de origem (IA / sandbox de IA), verificação de segurança, reescrita de metadados com identidades reais da empresa, controlo de versões e biblioteca por autor (base para RAG e fine-tuning).

Primeira versão gerada no Lovable (motor de análise) e completada à mão (ecrãs, reescrita, versões, testes).

## Funcionalidades

| Área | O que faz |
| --- | --- |
| **Upload** | Arrastar e largar, colar (⌘V), fila com 2 em paralelo, progresso real por fases, cancelar/repetir, erros claros (tamanho, tipo, PDF corrompido/encriptado). |
| **Origem** | Motor de regras (`src/lib/origin/rules.ts`) sobre Producer/Creator/Application, XMP, datas, tempo de edição, revisões, C2PA, IPTC. Pontuação 0–100, veredicto e evidências com id de regra. |
| **Segurança** | PDF: `/JavaScript`, `/OpenAction`, `/AA`, `/Launch`, `/URI` automático, `/SubmitForm`, ficheiros incorporados, XFA, nomes ofuscados (`/J#61vaScript`), objetos em object streams. Office: macros, OLE, ActiveX, DDE, modelos remotos, imagens remotas (pixels de rastreio). ODT e imagens (GPS, poliglotas). |
| **Entregar** | Reescreve metadados com uma identidade (pessoa + máquina + aplicação + empresa + fuso), opcionalmente remove conteúdo ativo e ligações externas, regenera XMP coerente, e descarrega o mesmo ficheiro. O resultado é reanalisado e guardado como nova versão. |
| **Versões** | Mesmo ficheiro (SHA-256) é reconhecido; nome/título semelhante cria nova versão; diff de metadados entre versões. |
| **Biblioteca** | Autores criados a partir dos metadados e identidades; secções, tipografia e extensão típicas; sugestões heurísticas (substituíveis por RAG/fine-tuning). |
| **UI** | Barra lateral recolhível, ⌘K, navegação `G` + tecla, modo claro/escuro, responsivo, animações com Framer Motion (respeita `prefers-reduced-motion`). |

## Como correr

```bash
bun install      # ou npm install
bun run dev      # http://localhost:5173
bun run test     # testes do motor de análise e da reescrita
bun run build
```

Na primeira visita são criados exemplos reais (gerados no navegador e analisados pelo mesmo motor): um PDF com rastreio ao abrir e JavaScript, um Word gerado com python-docx num sandbox, um contrato com 3 versões, etc. Em **Definições → Repor** volta-se ao estado inicial.

## Contas e login (Supabase)

Login sem palavra-passe: a pessoa escreve o e-mail e recebe **um código de 6 dígitos e uma ligação** no mesmo e-mail; qualquer um dos dois serve. O registo é aberto (separador **Criar conta**). Novas contas entram como **Utilizador**; a conta `efrancisco@underall.com` nasce **Administrador**. Em **Utilizadores** (barra lateral), o administrador muda o papel de qualquer conta.

| Papel | Pode |
| --- | --- |
| Utilizador | Usar a aplicação. |
| Gestor | Usar a aplicação e ver a lista de contas. |
| Administrador | Tudo, incluindo alterar papéis. Nunca é possível ficar sem nenhum administrador. |

As regras vivem na base de dados (`supabase/migrations/`): RLS na tabela `profiles` e a função `set_user_role()`, que só aceita pedidos de administradores. Os documentos continuam no IndexedDB do navegador nesta fase.

**Identidades** (tabela `identities`, com RLS): o utilizador vê e altera só as suas; o gestor vê as de todas as contas mas só altera e entrega com as suas; o administrador vê, altera e entrega com todas.

**Guia de utilização**: abre sozinho no primeiro login (fica registado em `profiles.onboarded_at`) e pelo botão **?** no topo. Destaca cada zona da app e inclui a criação da identidade, pré-preenchida com os dados do computador (sistema, fuso, navegador; o nome do computador é sugerido, porque o navegador não o consegue ler).

Sem `VITE_SUPABASE_URL` a app corre como antes, em modo local sem login (é assim que a build estática de testes funciona).

### Alojar nas máquinas próprias

Supabase self-hosted ao lado de outra instância existente + front com Caddy (por IP primeiro, depois `docqc.underall.com`): ver [deploy/README.md](deploy/README.md).

### Configurar (uma vez) no supabase.com

1. **Criar o projeto** em [supabase.com](https://supabase.com) (o plano gratuito chega). Região sugerida: `eu-west` (Europa).
2. **Variáveis**: copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (Project Settings → API). No alojamento (Vercel, Cloudflare, Netlify…) defina as mesmas duas variáveis. A chave pública pode ir para o navegador; a `service_role`/secret **nunca**.
3. **Base de dados**: com o [Supabase CLI](https://supabase.com/docs/guides/cli):
   ```bash
   bunx supabase login
   bunx supabase link --project-ref <ref-do-projeto>
   bunx supabase db push        # aplica supabase/migrations
   bunx supabase config push    # aplica supabase/config.toml (código de 6 dígitos, modelos de e-mail)
   ```
   Alternativa sem CLI: colar o ficheiro da migração em **SQL Editor** e, em **Authentication → Email Templates**, colar `supabase/templates/magic_link.html` (Magic Link) e `confirmation.html` (Confirm signup).
4. **URL do site**: em **Authentication → URL Configuration**, `Site URL` = endereço público da app (ex.: `https://docqc.underall.com`). As ligações dos e-mails apontam para `<Site URL>/auth/confirm`. Acrescente `http://localhost:5173` em *Redirect URLs* para testar localmente.
5. **Código de 6 dígitos**: em **Authentication → Providers → Email**, `Email OTP Length` = 6 (o `config push` já o faz).
6. **Envio de e-mails (obrigatório em produção)**: o servidor de e-mail incluído no Supabase só envia para membros da equipa do projeto e poucas mensagens por hora. Configure um SMTP próprio em **Authentication → SMTP Settings**, por exemplo [Resend](https://resend.com) (`smtp.resend.com`, porta 465, utilizador `resend`, palavra-passe = API key) ou o SMTP do Microsoft 365/Google Workspace da Underall. Verifique o domínio de envio (SPF/DKIM) para os e-mails não irem para spam.
7. **Primeiro acesso**: abra a app, **Criar conta** com `efrancisco@underall.com`; a conta fica logo como administrador. Para dar admin automático a outro e-mail no futuro: `insert into public.bootstrap_admins values ('outro@underall.com');`.

### Testar localmente

```bash
bunx supabase start          # precisa de Docker; aplica a migração
# copie a URL e a PUBLISHABLE_KEY mostradas para .env.local
bun run dev
```

Os e-mails locais aparecem em http://127.0.0.1:54324. Testes das regras de papéis num Postgres simples:

```bash
cat supabase/tests/stub_auth.sql supabase/migrations/*.sql supabase/tests/roles_test.sql | psql -v ON_ERROR_STOP=1 <base-vazia>
```

## Arquitetura

```
src/lib/analysis/   extração + verificação por formato (pdf, ooxml, odt, image, text) e orquestração
src/lib/origin/     regras e motor de pontuação de origem
src/lib/rewrite/    reescrita de metadados e neutralização de conteúdo ativo
src/services/       persistência (IndexedDB) — único ponto a trocar pelo backend; users.ts fala com o Supabase
src/lib/auth/       cliente Supabase, sessão, papéis
supabase/           migrações, modelos de e-mail, config do CLI e testes SQL
src/routes/         páginas (TanStack Start, file routes)
src/components/     shell, tabelas, painéis do documento, primitivos de UI
```

Tudo corre no navegador: os ficheiros são lidos como bytes, nunca abertos nem executados. O pdf.js usado na pré-visualização não executa JavaScript de documentos.

## Próxima fase (backend)

1. **Supabase (dados)**: as contas já estão no Supabase; faltam as tabelas `documents`, `versions`, `authors`, `profiles`, bucket privado para ficheiros, RLS por empresa. Basta reimplementar `src/services/store.ts`.
2. **Antivírus com assinaturas**: função no servidor com ClamAV (e opcionalmente YARA) para complementar a análise estrutural.
3. **RAG por autor**: `pgvector` com embeddings da estrutura e do texto das versões; as sugestões passam a vir do corpus indexado.
4. **Fine-tuning por autor**: exportar o corpus (estrutura + texto aprovado) quando houver volume suficiente.

## Limites conhecidos

- Os metadados indicam a origem mas não a provam.
- A verificação de segurança é estrutural, não por assinaturas.
- HEIC: análise sim, reescrita ainda não (converter para JPEG).
- `.doc`/`.xls` antigos e ficheiros encriptados não são lidos.
