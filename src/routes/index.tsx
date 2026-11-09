import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { animate, motion } from "framer-motion";
import { ArrowUpRight, ShieldAlert, UploadCloud } from "lucide-react";
import { Page, Section } from "@/components/app/page";
import { DocumentsTable } from "@/components/app/documents-table";
import { KindIcon, SeverityBadge } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthors, useDocuments } from "@/services/queries";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Visão geral · DocQC" }] }),
  component: Overview,
});

function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const c = animate(0, value, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => (el.textContent = `${Math.round(v)}${suffix}`),
    });
    return () => c.stop();
  }, [value, suffix]);
  return <span ref={ref} className="tnum">{`0${suffix}`}</span>;
}

function Overview() {
  const { data: docs, isPending } = useDocuments();
  const { data: authors = [] } = useAuthors();
  const all = docs ?? [];
  const latest = all.map((d) => d.versions[d.versions.length - 1]!).filter(Boolean);
  const versions = all.reduce((a, d) => a + d.versions.length, 0);
  const threats = latest.filter((v) => v.analysis.securityState !== "Seguro").length;
  const aiShare = latest.length
    ? Math.round(
        (latest.filter((v) => v.analysis.origin.verdict !== "Provável origem humana").length /
          latest.length) *
          100,
      )
    : 0;
  const delivered = all.reduce((a, d) => a + d.versions.filter((v) => v.rewrittenWith).length, 0);

  const kpis = [
    { label: "Documentos analisados", value: all.length, hint: `${versions} versões no total` },
    {
      label: "Com risco de segurança",
      value: threats,
      hint: "conteúdo ativo ou rastreio",
      tone: threats ? "text-danger" : "",
    },
    { label: "Com indícios de IA", value: aiShare, suffix: "%", hint: "na versão mais recente" },
    { label: "Entregues pelo DocQC", value: delivered, hint: "com metadados revistos" },
  ];

  const alerts = all
    .flatMap((d) => {
      const v = d.versions[d.versions.length - 1];
      return v
        ? v.analysis.findings
            .filter((f) => f.severity === "crítico")
            .slice(0, 1)
            .map((f) => ({ d, f }))
        : [];
    })
    .slice(0, 4);

  return (
    <Page
      crumbs={[{ label: "Visão geral" }]}
      title="Visão geral"
      description="Estado dos documentos que passaram pelo DocQC."
      actions={
        <Button asChild>
          <Link to="/upload">
            <UploadCloud /> Carregar ficheiros
          </Link>
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-card px-4 py-4 md:px-5">
            <div className="text-[12px] text-muted-foreground">{k.label}</div>
            <div
              className={`mt-1.5 text-[26px] font-semibold leading-none tracking-tight ${k.tone ?? ""}`}
            >
              {isPending ? (
                <Skeleton className="h-[26px] w-12" />
              ) : (
                <CountUp value={k.value} suffix={k.suffix ?? ""} />
              )}
            </div>
            <div className="mt-1.5 text-[11.5px] text-muted-foreground">{k.hint}</div>
          </div>
        ))}
      </div>

      {alerts.length > 0 && (
        <Section
          title="Requer atenção"
          description="Ficheiros com conteúdo que atua sozinho ao ser aberto. Não os abra fora do DocQC."
        >
          <div className="grid gap-2 md:grid-cols-2">
            {alerts.map(({ d, f }, i) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
              >
                <Link
                  to="/documents/$id"
                  params={{ id: d.id }}
                  search={{ tab: "seguranca" }}
                  className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-border-strong"
                >
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-danger-soft text-danger">
                    <ShieldAlert className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{d.name}</span>
                      <SeverityBadge s={f.severity} />
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted-foreground">
                      {f.explanation}
                    </span>
                  </span>
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </motion.div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Documentos recentes"
        action={
          <Link
            to="/documents"
            className="text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Ver todos
          </Link>
        }
      >
        <DocumentsTable docs={all} authors={authors} loading={isPending} limit={8} />
      </Section>

      {!isPending && all.length > 0 && (
        <Section title="Por tipo">
          <div className="flex flex-wrap gap-2">
            {Object.entries(
              all.reduce<Record<string, number>>(
                (a, d) => ((a[d.kind] = (a[d.kind] ?? 0) + 1), a),
                {},
              ),
            ).map(([k, n]) => (
              <span
                key={k}
                className="flex items-center gap-2 rounded-md border border-border bg-card py-1 pl-1 pr-2.5 text-[12.5px]"
              >
                <KindIcon kind={k as never} className="size-6 border-0" />
                <span className="uppercase text-muted-foreground">{k}</span>
                <span className="tnum font-medium">{n}</span>
              </span>
            ))}
          </div>
        </Section>
      )}
      <Hint />
    </Page>
  );
}

function Hint() {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(true), []);
  if (!show) return null;
  return (
    <p className="mt-10 text-center text-[12px] text-muted-foreground">
      Dica: <span className="kbd">⌘</span> <span className="kbd">K</span> para pesquisar,{" "}
      <span className="kbd">G</span> <span className="kbd">U</span> para carregar.
    </p>
  );
}
