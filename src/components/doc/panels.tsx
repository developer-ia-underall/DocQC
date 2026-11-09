import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Check,
  Copy,
  Cpu,
  ShieldCheck,
  User,
  Wrench,
  Server,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AnalysisResult,
  DocumentRecord,
  DocVersion,
  Evidence,
  Severity,
} from "@/types/domain";
import {
  Mono,
  Pill,
  ScoreGauge,
  SecurityBadge,
  SeverityBadge,
  VerdictBadge,
  securityTone,
} from "@/components/app/status";
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatDate, relativeTime, shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";

const CAT: Record<Evidence["category"], { label: string; icon: typeof Bot }> = {
  ai: { label: "IA", icon: Bot },
  tool: { label: "Ferramenta", icon: Wrench },
  sandbox: { label: "Sandbox", icon: Server },
  human: { label: "Humano", icon: User },
};

const VERDICT_TEXT: Record<AnalysisResult["origin"]["verdict"], string> = {
  "Provável origem humana":
    "Os metadados são consistentes com um documento criado e editado por uma pessoa numa aplicação de escritório.",
  "Indícios de IA":
    "Há marcas de ferramentas ou bibliotecas usadas por assistentes de IA ou por geração automática.",
  "Gerado em sandbox de IA":
    "Combinação de bibliotecas de geração com sinais de ambiente de execução (contentor, UTC, autor genérico, sem edição).",
};

/* ------------------------------------------- Origem ------------------------------------------ */

export function OriginPanel({ a }: { a: AnalysisResult }) {
  const o = a.origin;
  const byCat = (["ai", "tool", "sandbox", "human"] as const).map((c) => ({
    c,
    w: o.evidence.filter((e) => e.category === c).reduce((s, e) => s + e.weight, 0),
  }));
  return (
    <div className="space-y-5">
      <div className="panel flex flex-col items-center gap-5 p-5 sm:flex-row sm:items-center">
        <ScoreGauge score={o.score} verdict={o.verdict} />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <VerdictBadge v={o.verdict} />
            <span className="text-[12px] text-muted-foreground">confiança {o.confidence}</span>
          </div>
          <p className="mt-2 text-[13px] text-foreground/85">{VERDICT_TEXT[o.verdict]}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-3 text-[12px] text-muted-foreground sm:justify-start">
            {byCat.map(({ c, w }) => {
              const I = CAT[c].icon;
              return (
                <span key={c} className="flex items-center gap-1">
                  <I className="size-3.5" /> {CAT[c].label}{" "}
                  <span
                    className={cn(
                      "tnum font-medium",
                      w > 0 ? "text-foreground" : w < 0 ? "text-safe" : "",
                    )}
                  >
                    {w > 0 ? `+${w}` : w}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Evidências</h3>
          <span className="tnum text-[12px] text-muted-foreground">
            {o.evidence.length} regras ativadas
          </span>
        </div>
        {o.evidence.length === 0 ? (
          <div className="panel p-4 text-[13px] text-muted-foreground">
            {a.kind === "text"
              ? "Ficheiros de texto não têm metadados incorporados: não é possível avaliar a origem por esta via."
              : "Nenhuma regra foi ativada."}
          </div>
        ) : (
          <motion.ul
            className="panel divide-y divide-border"
            initial="h"
            animate="s"
            variants={{ s: { transition: { staggerChildren: 0.03 } } }}
          >
            {o.evidence.map((e) => {
              const I = CAT[e.category].icon;
              return (
                <motion.li
                  key={e.ruleId}
                  variants={{ h: { opacity: 0, x: -4 }, s: { opacity: 1, x: 0 } }}
                  className="flex items-start gap-3 px-4 py-3"
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md",
                      e.weight < 0
                        ? "bg-safe-soft text-safe"
                        : e.category === "sandbox"
                          ? "bg-danger-soft text-danger"
                          : "bg-warning-soft text-warning",
                    )}
                  >
                    <I className="size-3.5" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px]">{e.evidence}</div>
                    <Mono className="mt-0.5 block text-[11px] text-muted-foreground">
                      {e.ruleId}
                    </Mono>
                  </div>
                  <span
                    className={cn(
                      "tnum shrink-0 font-mono text-[12px]",
                      e.weight < 0 ? "text-safe" : "text-foreground",
                    )}
                  >
                    {e.weight > 0 ? `+${e.weight}` : e.weight}
                  </span>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Os metadados são um sinal, não uma prova. Um texto escrito por IA e colado no Word parece
        humano; um documento humano exportado por um script parece automático. Use este resultado
        como triagem.
      </p>
    </div>
  );
}

/* ----------------------------------------- Segurança ----------------------------------------- */

const SEV_ORDER: Severity[] = ["crítico", "alto", "médio", "info"];
const STATE_TEXT = {
  Seguro: "Não foi encontrado conteúdo que atue sozinho ao abrir o ficheiro.",
  Atenção:
    "O ficheiro tem elementos que podem contactar servidores externos ou conter dados escondidos.",
  Perigoso:
    "O ficheiro tem conteúdo que corre automaticamente ou pode executar código. Não o abra num leitor comum.",
} as const;

export function SecurityPanel({ a }: { a: AnalysisResult }) {
  const groups = SEV_ORDER.map((s) => ({
    s,
    items: a.findings.filter((f) => f.severity === s),
  })).filter((g) => g.items.length);
  const t = securityTone(a.securityState);
  return (
    <div className="space-y-5">
      <div
        className={cn(
          "flex items-start gap-3 rounded-lg border p-4",
          t === "danger"
            ? "border-danger/25 bg-danger-soft"
            : t === "warning"
              ? "border-warning/25 bg-warning-soft"
              : "border-safe/25 bg-safe-soft",
        )}
      >
        <ShieldCheck
          className={cn(
            "mt-0.5 size-5 shrink-0",
            t === "danger" ? "text-danger" : t === "warning" ? "text-warning" : "text-safe",
          )}
          strokeWidth={1.75}
        />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{a.securityState}</span>
            <span className="tnum text-[12px] text-muted-foreground">
              {a.findings.length} ocorrência(s)
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-foreground/80">{STATE_TEXT[a.securityState]}</p>
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.s}>
          <div className="mb-2 flex items-center gap-2">
            <SeverityBadge s={g.s} />
            <span className="tnum text-[12px] text-muted-foreground">{g.items.length}</span>
          </div>
          <ul className="panel divide-y divide-border">
            {g.items.map((f, i) => (
              <li key={f.id + i} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium">{f.title}</div>
                  <Mono className="shrink-0 text-[11px] text-muted-foreground">{f.id}</Mono>
                </div>
                <p className="mt-1 text-[13px] text-foreground/80">{f.explanation}</p>
                {f.detail && (
                  <Mono className="mt-2 block break-all rounded bg-muted px-2 py-1 text-[11.5px] text-muted-foreground">
                    {f.detail}
                  </Mono>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        A verificação é estrutural: procura mecanismos que um ficheiro usa para agir ao ser aberto
        (JavaScript, ações automáticas, macros, modelos e imagens remotas). Não substitui um
        antivírus com assinaturas, previsto para a fase com servidor.
      </p>
    </div>
  );
}

/* ----------------------------------------- Metadados ----------------------------------------- */

export function MetadataPanel({ a }: { a: AnalysisResult }) {
  const [raw, setRaw] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, [string, string][]>();
    for (const [k, v] of Object.entries(a.metadata)) {
      const [g, ...rest] = k.split(".");
      const key = rest.length ? g! : "Geral";
      const list = m.get(key) ?? [];
      list.push([rest.length ? rest.join(".") : k, v]);
      m.set(key, list);
    }
    return [...m];
  }, [a.metadata]);
  const copy = (s: string) => {
    void navigator.clipboard?.writeText(s);
    toast.success("Copiado");
  };
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="tnum text-[12px] text-muted-foreground">
          {Object.keys(a.metadata).length} campos
        </span>
        {a.xmpRaw && (
          <label className="flex items-center gap-2 text-[12.5px]">
            <Switch checked={raw} onCheckedChange={setRaw} /> XMP em bruto
          </label>
        )}
      </div>
      {raw && a.xmpRaw ? (
        <pre className="panel max-h-[520px] overflow-auto p-4 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
          {a.xmpRaw}
        </pre>
      ) : (
        groups.map(([g, rows]) => (
          <div key={g}>
            <div className="eyebrow mb-1.5">{g}</div>
            <dl className="panel divide-y divide-border">
              {rows.map(([k, v]) => (
                <div
                  key={k}
                  className="group grid grid-cols-[minmax(110px,180px)_1fr_auto] items-start gap-3 px-4 py-2"
                >
                  <dt className="truncate font-mono text-[12px] text-muted-foreground" title={k}>
                    {k}
                  </dt>
                  <dd className="min-w-0 break-words text-[13px]">{v}</dd>
                  <button
                    onClick={() => copy(v)}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Copiar"
                  >
                    <Copy className="size-3.5 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </dl>
          </div>
        ))
      )}
      {a.structure.fonts.length > 0 && (
        <div>
          <div className="eyebrow mb-1.5">Tipos de letra</div>
          <div className="flex flex-wrap gap-1.5">
            {a.structure.fonts.map((f) => (
              <span
                key={f}
                className="rounded border border-border bg-card px-2 py-0.5 text-[12px]"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------ Versões ------------------------------------------ */

export function metadataDiff(a: Record<string, string>, b: Record<string, string>) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (k) => !k.startsWith("Estrutura"),
  );
  return keys
    .map((k) => ({ k, from: a[k], to: b[k] }))
    .filter((d) => d.from !== d.to)
    .sort((x, y) => x.k.localeCompare(y.k));
}

export function DiffTable({
  rows,
}: {
  rows: { k: string; from?: string | undefined; to?: string | undefined }[];
}) {
  if (!rows.length)
    return (
      <div className="px-4 py-3 text-[12.5px] text-muted-foreground">
        Sem diferenças nos metadados.
      </div>
    );
  return (
    <div className="divide-y divide-border">
      {rows.map((r) => (
        <div key={r.k} className="grid gap-1 px-4 py-2 sm:grid-cols-[170px_1fr_1fr] sm:gap-3">
          <span className="truncate font-mono text-[11.5px] text-muted-foreground">{r.k}</span>
          <span
            className={cn(
              "min-w-0 break-words text-[12.5px]",
              r.from ? "text-danger line-through decoration-danger/40" : "text-muted-foreground",
            )}
          >
            {r.from ?? "—"}
          </span>
          <span
            className={cn(
              "min-w-0 break-words text-[12.5px]",
              r.to ? "text-safe" : "text-muted-foreground",
            )}
          >
            {r.to ?? "removido"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function VersionsPanel({
  doc,
  selected,
  onSelect,
}: {
  doc: DocumentRecord;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const versions = [...doc.versions].reverse();
  const [open, setOpen] = useState<string | null>(versions[0]?.id ?? null);
  return (
    <ol className="relative">
      {versions.map((v, i) => {
        const prev = doc.versions[v.n - 2];
        const diff = prev ? metadataDiff(prev.analysis.metadata, v.analysis.metadata) : [];
        const isOpen = open === v.id;
        return (
          <li key={v.id} className="relative pb-5 pl-8 last:pb-0">
            {i < versions.length - 1 && (
              <span className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px bg-border" />
            )}
            <span
              className={cn(
                "absolute left-0 top-0.5 grid size-[23px] place-items-center rounded-full border text-[10.5px] font-semibold",
                v.id === selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              {v.n}
            </span>
            <div className="panel overflow-hidden">
              <button
                className="flex w-full items-start gap-3 px-4 py-3 text-left"
                onClick={() => setOpen(isOpen ? null : v.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Versão {v.n}</span>
                    {v.rewrittenWith && (
                      <Pill t="info" dot={false}>
                        <Sparkles className="size-3" /> Entregue pelo DocQC
                      </Pill>
                    )}
                    <VerdictBadge v={v.analysis.origin.verdict} short />
                    <SecurityBadge s={v.analysis.securityState} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                    <span title={formatDate(v.uploadedAt)}>{relativeTime(v.uploadedAt)}</span>
                    <span>{v.uploadedBy}</span>
                    <Mono className="text-[11.5px]">{shortHash(v.hash)}</Mono>
                    <span className="tnum">{formatBytes(v.size)}</span>
                  </div>
                  {v.matchReason && (
                    <div className="mt-1 text-[12px] text-muted-foreground">
                      Associado por: {v.matchReason.toLowerCase()}
                    </div>
                  )}
                </div>
                <ChevronDown
                  className={cn(
                    "mt-1 size-4 text-muted-foreground transition-transform",
                    isOpen && "rotate-180",
                  )}
                />
              </button>
              <motion.div
                initial={false}
                animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="border-t border-border">
                  {prev ? (
                    <>
                      <div className="flex items-center justify-between bg-subtle px-4 py-1.5 text-[11.5px] text-muted-foreground">
                        <span>Alterações face à versão {prev.n}</span>
                        <span className="tnum">{diff.length}</span>
                      </div>
                      <DiffTable rows={diff} />
                    </>
                  ) : (
                    <div className="px-4 py-3 text-[12.5px] text-muted-foreground">
                      Primeira versão registada · {v.fileName}
                    </div>
                  )}
                  {v.id !== selected && (
                    <div className="border-t border-border px-4 py-2">
                      <button
                        className="flex items-center gap-1.5 text-[12.5px] font-medium text-primary"
                        onClick={() => onSelect(v.id)}
                      >
                        <Check className="size-3.5" /> Ver análise desta versão
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function VersionMeta({ v }: { v: DocVersion }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <Cpu className="size-3.5" /> <Mono className="text-[11.5px]">{shortHash(v.hash)}</Mono>
      </span>
      <span className="tnum">{formatBytes(v.size)}</span>
      <span>{formatDate(v.uploadedAt)}</span>
    </div>
  );
}
