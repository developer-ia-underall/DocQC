export type AppRole = "user" | "gestor" | "admin";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  created_at: string;
  last_sign_in_at: string | null;
  /** Quando viu (ou fechou) o guia do primeiro login; null = ainda não. */
  onboarded_at?: string | null;
}

export const ROLES: AppRole[] = ["user", "gestor", "admin"];

export const ROLE_LABEL: Record<AppRole, string> = {
  user: "Utilizador",
  gestor: "Gestor",
  admin: "Administrador",
};

export const ROLE_HINT: Record<AppRole, string> = {
  user: "Usa a aplicação.",
  gestor: "Usa a aplicação e vê a lista de contas.",
  admin: "Acesso total, incluindo alterar papéis.",
};

const rank: Record<AppRole, number> = { user: 0, gestor: 1, admin: 2 };
export const atLeast = (role: AppRole | undefined, min: AppRole) =>
  role !== undefined && rank[role] >= rank[min];

/** Traduz os erros do Supabase Auth para mensagens em português. */
export function authErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string; status?: number };
  const m = (err?.message ?? "").toLowerCase();
  const code = err?.code ?? "";
  if (code === "otp_disabled" || m.includes("signups not allowed"))
    return "Não existe conta com este e-mail.";
  if (code === "otp_expired" || m.includes("expired") || m.includes("invalid"))
    return "Código inválido ou expirado. Peça um novo.";
  if (code === "over_email_send_rate_limit" || err?.status === 429 || m.includes("rate limit"))
    return "Demasiados pedidos. Aguarde um minuto e tente de novo.";
  if (code === "email_address_invalid" || m.includes("email address") || m.includes("valid email"))
    return "Endereço de e-mail inválido.";
  if (m.includes("failed to fetch") || m.includes("network"))
    return "Sem ligação ao servidor. Verifique a internet.";
  return err?.message || "Algo correu mal. Tente de novo.";
}
