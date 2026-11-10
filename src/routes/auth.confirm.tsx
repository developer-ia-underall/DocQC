import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { authErrorMessage } from "@/lib/auth/roles";
import { requireSupabase } from "@/lib/auth/supabase";

const TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "invite", "email_change"];

/** Destino da ligação do e-mail: troca o token_hash por uma sessão no próprio navegador. */
export const Route = createFileRoute("/auth/confirm")({
  validateSearch: (s: Record<string, unknown>): { token_hash?: string; type?: EmailOtpType } => {
    const out: { token_hash?: string; type?: EmailOtpType } = {};
    if (typeof s["token_hash"] === "string") out.token_hash = s["token_hash"];
    if (TYPES.includes(s["type"] as EmailOtpType)) out.type = s["type"] as EmailOtpType;
    return out;
  },
  head: () => ({ meta: [{ title: "A entrar · DocQC" }] }),
  component: ConfirmPage,
});

function ConfirmPage() {
  const { token_hash, type } = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token_hash || !type) {
      setError("Ligação incompleta. Peça um novo código.");
      return;
    }
    void requireSupabase()
      .auth.verifyOtp({ token_hash, type })
      .then(({ error }) => {
        if (error) throw error;
        void navigate({ to: "/", replace: true });
      })
      .catch((e) => setError(authErrorMessage(e)));
  }, [token_hash, type, navigate]);

  return (
    <AuthCard>
      {error ? (
        <>
          <h1 className="text-[18px] font-semibold tracking-tight">Não foi possível entrar</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{error}</p>
          <Button asChild className="mt-6">
            <Link to="/login">Voltar ao início de sessão</Link>
          </Button>
        </>
      ) : (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> A confirmar o acesso…
        </div>
      )}
    </AuthCard>
  );
}
