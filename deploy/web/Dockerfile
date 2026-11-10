# Front do DocQC: TanStack Start com SSR, compilado para Node (nitro preset node-server).
# Contexto de build = raiz do repositório (ver deploy/web/docker-compose.yml).

FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# As variáveis VITE_* ficam gravadas no JavaScript do navegador no momento da build.
# "/" = mesmo endereço da app (o Caddy encaminha /auth/v1, /rest/v1, … para o Supabase),
# por isso a mesma imagem serve por IP e pelo domínio.
ARG VITE_SUPABASE_URL=/
ARG VITE_SUPABASE_PUBLISHABLE_KEY
RUN test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" || (echo "Falta VITE_SUPABASE_PUBLISHABLE_KEY em deploy/web/.env" >&2; exit 1)
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    NITRO_PRESET=node-server
RUN bun run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", ".output/server/index.mjs"]
