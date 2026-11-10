import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
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
