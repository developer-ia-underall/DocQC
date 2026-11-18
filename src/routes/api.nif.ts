import { createFileRoute } from "@tanstack/react-router";

/**
 * Consulta do NIF no Portal do Contribuinte (MINFIN), usada pelo módulo Contratos (BI).
 * O browser não pode chamar o portal diretamente (CORS e sessão JSF), por isso o servidor faz de intermediário.
 *   GET /api/nif?bi=000000000LA000 → { encontrado, nif, nome, tipo, estado, inadimplente, regimeIva, residente }
 */
export const Route = createFileRoute("/api/nif")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const headers = {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        };
        try {
          const { consultarNif } = await import("@/lib/contratos/nif.server");
          const bi = new URL(request.url).searchParams.get("bi");
          const r = (await consultarNif(bi)) as { estado: number; corpo: unknown };
          return new Response(JSON.stringify(r.corpo), { status: r.estado, headers });
        } catch (e) {
          const err = e as Error;
          const msg =
            err.name === "TimeoutError" || err.name === "AbortError"
              ? "O Portal do Contribuinte não respondeu a tempo."
              : `Não foi possível consultar o portal: ${err.message}`;
          return new Response(JSON.stringify({ erro: msg }), { status: 502, headers });
        }
      },
    },
  },
});
