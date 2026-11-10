/**
 * Guia de utilização: fundo escuro com um círculo claro sobre o elemento explicado e um card
 * flutuante com o passo atual. Abre sozinho no primeiro login (profiles.onboarded_at vazio) e
 * a qualquer momento pelo botão "?" no topo. Um dos passos cria a identidade da pessoa com os
 * dados deste computador.
 *
 * Os elementos destacados são marcados com data-tour="…" (ver shell.tsx).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Fingerprint, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IdentityForm } from "@/components/identity/identity-form";
import { useAuth } from "@/lib/auth/context";
import { authEnabled } from "@/lib/auth/supabase";
import { atLeast, type AppRole } from "@/lib/auth/roles";
import { useProfiles } from "@/services/queries";
import { cn } from "@/lib/utils";

const LOCAL_KEY = "docqc-tour-done";

interface TourCtx {
  open: boolean;
  start: () => void;
}
const Ctx = createContext<TourCtx>({ open: false, start: () => {} });
export const useTour = () => useContext(Ctx);

interface Step {
  id: string;
  /** Valor de data-tour do elemento a destacar; sem ele, o card aparece ao centro. */
  target?: string;
  title: string;
  body: ReactNode;
  /** Passo interativo de criação da identidade. */
  identity?: boolean;
  /** Página a abrir ao entrar no passo. */
  route?: string;
}

const VISIBILITY: Record<AppRole, string> = {
  user: "Só vê as suas identidades; ninguém as altera além de si e dos administradores.",
  gestor:
    "Como gestor, vê as identidades de toda a equipa para acompanhar quem assina o quê, mas só altera e usa as suas.",
  admin:
    "Como administrador, vê, altera e remove as identidades de todas as contas, e pode entregar com qualquer uma.",
};

function buildSteps(role: AppRole | undefined, firstName: string): Step[] {
  const r: AppRole = role ?? "user";
  const steps: Step[] = [
    {
      id: "welcome",
      title: `Bem-vindo ao DocQC${firstName ? `, ${firstName}` : ""}`,
      body: "Em menos de um minuto mostramos o essencial: carregar documentos, ver a análise e criar a sua identidade para os entregar com metadados da empresa.",
    },
    {
      id: "upload",
      target: "nav-/upload",
      title: "1. Carregar documentos",
      body: "Arraste ficheiros (PDF, Word, Excel, PowerPoint, ODT, imagens) ou cole-os com Ctrl+V. Cada um é analisado no seu navegador: nada é aberto nem executado.",
    },
    {
      id: "documents",
      target: "nav-/documents",
      title: "2. Ver a análise",
      body: "Aqui ficam todos os documentos, com a origem provável (humana, IA ou sandbox de IA), o estado de segurança e as versões. Abra um para ver as evidências.",
    },
    {
      id: "identities",
      target: "nav-/profiles",
      title: "3. Identidades",
      body: (
        <>
          Uma identidade é a pessoa e a máquina que ficam gravadas nos metadados quando entrega um
          documento. <span className="text-foreground">{VISIBILITY[r]}</span>
        </>
      ),
    },
    {
      id: "identity",
      target: "nav-/profiles",
      route: "/profiles",
      identity: true,
      title: "4. Crie a sua identidade",
      body: "Preenchemos os dados deste computador automaticamente. Confirme ou corrija, sobretudo o nome do computador, que o navegador não consegue ler.",
    },
    {
      id: "library",
      target: "nav-/library",
      title: "5. Biblioteca de autores",
      body: "Cada autor encontrado nos metadados ganha uma ficha com o estilo típico dos seus documentos (secções, tipografia, extensão), útil para rever novos ficheiros.",
    },
  ];
  if (atLeast(r, "gestor"))
    steps.push({
      id: "users",
      target: "nav-/admin/users",
      title: "6. Utilizadores",
      body:
        r === "admin"
          ? "Veja todas as contas e mude o papel de cada uma (Utilizador, Gestor, Administrador). Nunca é possível ficar sem nenhum administrador."
          : "Veja a lista de contas e o papel de cada pessoa. Só um administrador pode alterar papéis.",
    });
  steps.push(
    {
      id: "search",
      target: "search",
      title: "Pesquisa rápida",
      body: "Ctrl+K (⌘K no Mac) abre a pesquisa: documentos, páginas e ações. Também pode navegar com G seguido de uma letra (G D = Documentos).",
    },
    {
      id: "help",
      target: "help",
      title: "Este guia está sempre aqui",
      body: "Carregue no ? para rever o guia quando quiser.",
    },
    {
      id: "done",
      title: "Tudo pronto",
      body: "Comece por carregar um documento. Bom trabalho!",
    },
  );
  return steps;
}

/* ------------------------------------------ Provider ----------------------------------------- */

export function TourProvider({ children }: { children: ReactNode }) {
  const { session, profile, markOnboarded } = useAuth();
  const [open, setOpen] = useState(false);
  const autoChecked = useRef(false);

  // Primeiro login: abre sozinho uma vez (a data fica no perfil, por isso não repete noutro PC).
  useEffect(() => {
    if (autoChecked.current) return;
    if (authEnabled) {
      if (!session || !profile) return;
      if (profile.onboarded_at) {
        autoChecked.current = true;
        return;
      }
    } else {
      try {
        if (localStorage.getItem(LOCAL_KEY)) {
          autoChecked.current = true;
          return;
        }
      } catch {
        return;
      }
    }
    // A marca só fica quando abre: se o efeito for cancelado antes (StrictMode, perfil a
    // recarregar), a próxima execução volta a agendar.
    const t = setTimeout(() => {
      autoChecked.current = true;
      setOpen(true);
    }, 700);
    return () => clearTimeout(t);
  }, [session, profile]);

  const close = useCallback(() => {
    setOpen(false);
    if (authEnabled) void markOnboarded();
    else
      try {
        localStorage.setItem(LOCAL_KEY, new Date().toISOString());
      } catch {
        /* ignore */
      }
  }, [markOnboarded]);

  const value = useMemo(() => ({ open, start: () => setOpen(true) }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>{open && <TourOverlay onClose={close} />}</AnimatePresence>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

/* ------------------------------------------ Overlay ------------------------------------------ */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function findTarget(id?: string): Rect | null {
  if (!id) return null;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(id)}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  return null;
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

const M = 16; // margem ao bordo do ecrã
const MAX_R = 84;

export function spotlight(rect: Rect) {
  const r = Math.min(Math.hypot(rect.w, rect.h) / 2 + 8, MAX_R);
  const cy = rect.y + rect.h / 2;
  const cx = rect.w / 2 + 8 > r ? rect.x + r - 6 : rect.x + rect.w / 2;
  return { cx, cy, r };
}

function TourOverlay({ onClose }: { onClose: () => void }) {
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { data: identities = [] } = useProfiles();
  const firstName = (profile?.full_name || session?.user.email || "").split(/[\s@.]/)[0] ?? "";
  const steps = useMemo(() => buildSteps(profile?.role, firstName), [profile?.role, firstName]);
  const [i, setI] = useState(0);
  const step = steps[Math.min(i, steps.length - 1)]!;
  const last = i === steps.length - 1;
  const hasOwnIdentity = identities.some((p) => !p.ownerId || p.ownerId === session?.user.id);
  const ownIdentity = identities.find((p) => !p.ownerId || p.ownerId === session?.user.id);

  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 220 });

  const next = useCallback(() => (last ? onClose() : setI((n) => n + 1)), [last, onClose]);
  const prev = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    if (step.route) void navigate({ to: step.route as never });
  }, [step.route, navigate]);

  // Segue o elemento destacado (redimensionar, scroll, barra lateral a recolher…).
  useLayoutEffect(() => {
    let raf = 0;
    let prevRect: Rect | null = null;
    const tick = () => {
      const r = findTarget(step.target);
      if (!sameRect(r, prevRect)) {
        prevRect = r;
        setRect(r);
      }
      setVp((v) =>
        v.w === window.innerWidth && v.h === window.innerHeight
          ? v
          : { w: window.innerWidth, h: window.innerHeight },
      );
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step.target]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCardSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Teclado: Esc fecha, setas avançam/recuam (fora de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (!typing && e.key === "ArrowRight") next();
      else if (!typing && e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [next, prev, onClose]);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [i]);

  // Círculo: centrado no elemento, raio que o cobre por inteiro.
  // Elementos largos (itens do menu): raio limitado e círculo sobre o início (ícone + texto).
  const circle = rect ? spotlight(rect) : { cx: vp.w / 2, cy: vp.h / 2, r: 0 };

  // Card: à direita do círculo, senão por baixo, por cima, à esquerda; sempre dentro do ecrã.
  const pos = useMemo(() => {
    const { w, h } = cardSize;
    const clampX = (x: number) => Math.min(Math.max(M, x), vp.w - w - M);
    const clampY = (y: number) => Math.min(Math.max(M, y), vp.h - h - M);
    if (!rect) return { left: clampX((vp.w - w) / 2), top: clampY((vp.h - h) / 2) };
    const { cx, cy, r } = circle;
    const gap = 14;
    if (cx + r + gap + w + M <= vp.w) return { left: cx + r + gap, top: clampY(cy - h / 2) };
    if (cy + r + gap + h + M <= vp.h) return { left: clampX(cx - w / 2), top: cy + r + gap };
    if (cy - r - gap - h >= M) return { left: clampX(cx - w / 2), top: cy - r - gap - h };
    if (cx - r - gap - w >= M) return { left: cx - r - gap - w, top: clampY(cy - h / 2) };
    return { left: clampX((vp.w - w) / 2), top: clampY(vp.h - h - M) };
  }, [rect, cardSize, vp, circle.cx, circle.cy, circle.r]); // eslint-disable-line react-hooks/exhaustive-deps

  const spring = reduce
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 260, damping: 32 };
  const showForm = step.identity && !hasOwnIdentity;

  return (
    <motion.div
      className="fixed inset-0 z-[100]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.25 }}
    >
      {/* Fundo escuro com o "buraco" circular. Bloqueia cliques na app durante o guia. */}
      <svg className="absolute inset-0 size-full" aria-hidden onClick={(e) => e.stopPropagation()}>
        <defs>
          <mask id="docqc-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <motion.circle initial={false} animate={circle} transition={spring} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgb(0 0 0 / 0.62)" mask="url(#docqc-tour-mask)" />
        <motion.circle
          initial={false}
          animate={{ ...circle, opacity: rect ? 1 : 0 }}
          transition={spring}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          style={{ filter: "drop-shadow(0 0 10px var(--primary))" }}
        />
      </svg>

      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="docqc-tour-title"
        tabIndex={-1}
        initial={false}
        animate={pos}
        transition={spring}
        className={cn(
          "absolute max-h-[calc(100dvh-32px)] overflow-y-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-[0_24px_60px_-12px_rgb(0_0_0/0.45)] outline-none",
          showForm ? "w-[min(460px,calc(100vw-32px))]" : "w-[min(360px,calc(100vw-32px))]",
        )}
      >
        <AnimatePresence mode="wait" initial={true}>
          <motion.div
            key={step.id}
            initial={reduce ? false : { opacity: 0, y: 8, filter: "blur(2px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.2, 0.7, 0.2, 1] }}
            className="p-4"
          >
            <div className="mb-2 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div
                  className="mb-1 flex items-center gap-1"
                  aria-label={`Passo ${i + 1} de ${steps.length}`}
                >
                  {steps.map((s, n) => (
                    <span
                      key={s.id}
                      className={cn(
                        "h-1 rounded-full transition-all duration-300",
                        n === i
                          ? "w-5 bg-primary"
                          : n < i
                            ? "w-1.5 bg-primary/50"
                            : "w-1.5 bg-border-strong",
                      )}
                    />
                  ))}
                </div>
                <h2 id="docqc-tour-title" className="text-[15px] font-semibold leading-snug">
                  {step.title}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="-mr-1 -mt-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Fechar guia"
                title="Fechar guia (Esc)"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {step.identity && hasOwnIdentity
                ? "Já tem uma identidade. Pode criar outras (por exemplo, para outro computador) em Identidades → Nova identidade: os dados do computador são preenchidos automaticamente."
                : step.body}
            </p>

            {step.identity && hasOwnIdentity && ownIdentity && (
              <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-border bg-subtle p-2.5 text-[12.5px]">
                <Fingerprint className="size-4 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{ownIdentity.fullName}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {ownIdentity.computerName} · {ownIdentity.os || "—"}
                  </span>
                </span>
                <Check className="size-4 text-safe" />
              </div>
            )}

            {showForm ? (
              <div className="mt-3">
                <IdentityForm
                  compact
                  submitLabel="Criar e continuar"
                  onSaved={next}
                  footerStart={
                    <Button type="button" variant="ghost" size="sm" onClick={prev}>
                      <ArrowLeft /> Voltar
                    </Button>
                  }
                  footerEnd={
                    <Button type="button" variant="outline" onClick={next}>
                      Fazer depois
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="tnum text-[11.5px] text-muted-foreground">
                  {i + 1} de {steps.length}
                </span>
                <div className="flex gap-2">
                  {i > 0 && !last && (
                    <Button variant="ghost" size="sm" onClick={prev}>
                      <ArrowLeft /> Voltar
                    </Button>
                  )}
                  {i === 0 && (
                    <Button variant="ghost" size="sm" onClick={onClose}>
                      Agora não
                    </Button>
                  )}
                  <Button size="sm" onClick={next} autoFocus>
                    {last ? (
                      <>
                        <Check /> Terminar
                      </>
                    ) : i === 0 ? (
                      <>
                        Começar <ArrowRight />
                      </>
                    ) : (
                      <>
                        Avançar <ArrowRight />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
