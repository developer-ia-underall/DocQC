// Front do DocQC sem Docker: app Node (SSR) + Caddy nativo, geridos pelo PM2.
// Para máquinas onde o Docker não consegue arrancar contentores (ex. LXC no Proxmox) e o
// nginx do sistema já ocupa as portas 80/443. Ver deploy/web/pm2/deploy.sh.
//
// Lê deploy/web/.env (as mesmas variáveis do modo Docker, mais as de baixo):
//   DOCQC_APP_PORT=3016            porta da app (só em 127.0.0.1)
//   DOCQC_SITE=https://<IP>:8443   o Caddy escuta nesta porta
//   DOCQC_CADDY_HTTP_PORT=8088     redirecionamentos HTTP→HTTPS (a 80 é do nginx)
//   DOCQC_DEFAULT_SNI=<IP>
const fs = require("node:fs");
const path = require("node:path");

const webDir = path.resolve(__dirname, "..");
const repo = path.resolve(webDir, "../..");

const env = {};
for (const line of fs.readFileSync(path.join(webDir, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const appPort = env.DOCQC_APP_PORT || "3016";

module.exports = {
  apps: [
    {
      name: "docqc-web",
      cwd: repo,
      script: ".output/server/index.mjs",
      // Bun próprio do DocQC: o cliente Supabase precisa de WebSocket nativo (Node ≥ 22),
      // e assim não depende da versão do Node do sistema.
      interpreter: env.DOCQC_BUN_BIN || path.join(process.env.HOME, ".bun-docqc/bin/bun"),
      env: { NODE_ENV: "production", HOST: "127.0.0.1", PORT: appPort },
      max_memory_restart: "512M",
    },
    {
      name: "docqc-caddy",
      cwd: webDir,
      script: env.DOCQC_CADDY_BIN || path.join(process.env.HOME, ".local/docqc/caddy"),
      args: "run --adapter caddyfile --config Caddyfile",
      interpreter: "none",
      env: {
        XDG_DATA_HOME: path.join(process.env.HOME, ".local/docqc/data"),
        XDG_CONFIG_HOME: path.join(process.env.HOME, ".local/docqc/config"),
        DOCQC_SITE: env.DOCQC_SITE,
        DOCQC_DEFAULT_SNI: env.DOCQC_DEFAULT_SNI || "docqc.underall.com",
        DOCQC_CADDY_HTTP_PORT: env.DOCQC_CADDY_HTTP_PORT || "8088",
        DOCQC_APP_UPSTREAM: `127.0.0.1:${appPort}`,
        SUPABASE_UPSTREAM: env.SUPABASE_UPSTREAM,
        ACME_EMAIL: env.ACME_EMAIL || "admin@underall.com",
      },
    },
  ],
};
