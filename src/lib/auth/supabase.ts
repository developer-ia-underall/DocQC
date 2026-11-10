import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rawUrl = import.meta.env.VITE_SUPABASE_URL;

/**
 * `VITE_SUPABASE_URL=/` (ou outro caminho relativo) significa "o mesmo endereço da app": o proxy
 * à frente encaminha /auth/v1, /rest/v1, … para o Supabase. Assim a mesma build serve por IP e
 * depois pelo domínio, sem recompilar. No servidor (SSR) não há chamadas ao Supabase, por isso
 * basta um URL absoluto qualquer para o cliente ser criado.
 */
function resolveUrl(value: string | undefined): string | undefined {
  if (!value || !value.startsWith("/")) return value;
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  return new URL(value, origin).toString().replace(/\/$/, "");
}

const url = resolveUrl(rawUrl);
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Sem VITE_SUPABASE_URL / chave pública a app corre em modo local (sem login), como antes:
 * útil para a build estática de testes. Com as variáveis definidas, o login é obrigatório.
 */
export const authEnabled = Boolean(url && key);

export const supabase: SupabaseClient | null = authEnabled
  ? createClient(url!, key!, {
      auth: {
        persistSession: typeof window !== "undefined",
        autoRefreshToken: typeof window !== "undefined",
        // As ligações dos e-mails usam token_hash em /auth/confirm, não fragmentos no URL.
        detectSessionInUrl: false,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error("Supabase não está configurado (VITE_SUPABASE_URL).");
  return supabase;
}
