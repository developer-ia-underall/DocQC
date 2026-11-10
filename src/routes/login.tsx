import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { OtpInput } from "@/components/auth/otp-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/context";
import { authErrorMessage } from "@/lib/auth/roles";
import { authEnabled, requireSupabase } from "@/lib/auth/supabase";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { mode?: Mode; redirect?: string } => {
    const out: { mode?: Mode; redirect?: string } = {};
    if (s["mode"] === "signup") out.mode = "signup";
    const r = s["redirect"];
    // Só caminhos internos: evita redirecionar para outro domínio ("//exemplo.com").
    if (typeof r === "string" && r.startsWith("/") && !r.startsWith("//")) out.redirect = r;
    return out;
  },
  head: () => ({ meta: [{ title: "Entrar · DocQC" }] }),
  component: LoginPage,
});

const RESEND_SECONDS = 60;

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { session, ready } = useAuth();
  const [mode, setMode] = useState<Mode>(search.mode ?? "signin");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const verifying = useRef(false);

  // Já autenticado (por exemplo, abriu a ligação do e-mail noutro separador).
  useEffect(() => {
    if (ready && session) void navigate({ to: search.redirect ?? "/", replace: true });
  }, [ready, session, navigate, search.redirect]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    setBusy(true);
    setError(null);
    setNoAccount(false);
    try {
      const { error } = await requireSupabase().auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: mode === "signup",
          ...(mode === "signup" && name.trim() ? { data: { full_name: name.trim() } } : {}),
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      });
      if (error) throw error;
      setStep("code");
      setCode("");
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      const msg = authErrorMessage(e);
      setError(msg);
      setNoAccount(mode === "signin" && msg.startsWith("Não existe conta"));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (token: string) => {
    if (verifying.current) return;
    verifying.current = true;
    setBusy(true);
    setError(null);
    try {
      const { error } = await requireSupabase().auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token,
        type: "email",
      });
      if (error) throw error;
      // A navegação acontece no efeito acima quando a sessão chega.
    } catch (e) {
      setError(authErrorMessage(e));
      setCode("");
    } finally {
      verifying.current = false;
      setBusy(false);
    }
  };

  const onCode = (v: string) => {
    setCode(v);
    if (error) setError(null);
    if (v.length === 6) void verify(v);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step === "email") void send();
    else if (code.length === 6) void verify(code);
  };

  if (!authEnabled) {
    return (
      <AuthCard>
        <h1 className="text-[18px] font-semibold tracking-tight">Login desativado</h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          Esta instalação corre em modo local, sem servidor. Defina VITE_SUPABASE_URL e
          VITE_SUPABASE_PUBLISHABLE_KEY para ativar as contas.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">Abrir a aplicação</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AnimatePresence mode="wait" initial={false}>
        {step === "email" ? (
          <motion.form
            key="email"
            onSubmit={onSubmit}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.15 }}
          >
            <h1 className="text-[18px] font-semibold tracking-tight">
              {mode === "signin" ? "Entrar no DocQC" : "Criar conta"}
            </h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Sem palavra-passe: enviamos um código de 6 dígitos e uma ligação para o seu e-mail.
            </p>

            <div className="mt-6 grid grid-cols-2 rounded-md border border-border bg-muted p-0.5 text-[12.5px]">
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setError(null);
                    setNoAccount(false);
                  }}
                  className={cn(
                    "h-7 rounded-[5px] font-medium transition-colors",
                    mode === m
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "signin" ? "Entrar" : "Criar conta"}
                </button>
              ))}
            </div>

            <div className="mt-5 space-y-4">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Nome</Label>
                  <Input
                    id="name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nome e apelido"
                    className="h-9"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nome@empresa.com"
                  aria-invalid={!!error || undefined}
                  className="h-9"
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-3 text-[12.5px] text-danger">
                {error}{" "}
                {noAccount && (
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2"
                    onClick={() => {
                      setMode("signup");
                      setError(null);
                      setNoAccount(false);
                    }}
                  >
                    Criar conta com este e-mail
                  </button>
                )}
              </p>
            )}

            <Button type="submit" size="lg" className="mt-5 w-full" disabled={busy || !email}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              Enviar código
            </Button>
          </motion.form>
        ) : (
          <motion.form
            key="code"
            onSubmit={onSubmit}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }}
          >
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
              }}
              className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> Alterar e-mail
            </button>
            <h1 className="text-[18px] font-semibold tracking-tight">Verifique o seu e-mail</h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Enviámos um código para <span className="font-medium text-foreground">{email}</span>.
              Introduza-o abaixo ou clique na ligação do e-mail.
            </p>

            <div className="mt-6">
              <OtpInput value={code} onChange={onCode} disabled={busy} invalid={!!error} />
            </div>

            {error && (
              <p role="alert" className="mt-3 text-[12.5px] text-danger">
                {error}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              className="mt-5 w-full"
              disabled={busy || code.length < 6}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {mode === "signup" ? "Confirmar conta" : "Entrar"}
            </Button>

            <div className="mt-4 text-center text-[12.5px] text-muted-foreground">
              Não recebeu?{" "}
              {cooldown > 0 ? (
                <span className="tnum">Reenviar em {cooldown}s</span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send()}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  Reenviar código
                </button>
              )}
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </AuthCard>
  );
}
