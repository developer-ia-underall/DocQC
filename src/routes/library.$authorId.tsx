import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Database, Sparkles, UserX } from "lucide-react";
import { Page, Section, EmptyState } from "@/components/app/page";
import { DocumentsTable } from "@/components/app/documents-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthors, useDocuments } from "@/services/queries";
import { authorStyle, suggestFor } from "@/lib/suggestions";
import { kindLabel } from "@/lib/format";

export const Route = createFileRoute("/library/$authorId")({
  head: () => ({ meta: [{ title: "Autor · DocQC" }] }),
  component: AuthorPage,
});

function AuthorPage() {
  const { authorId } = Route.useParams();
  const { data: authors = [], isPending } = useAuthors();
  const { data: docs = [] } = useDocuments();
  const author = authors.find((a) => a.id === authorId);
  const mine = docs.filter((d) => d.authorId === authorId);
  const style = authorStyle(mine);
  const suggestions = suggestFor(style);

  if (isPending)
    return (
      <Page crumbs={[{ label: "Biblioteca de autores", to: "/library" }, { label: "…" }]}>
        <Skeleton className="h-8 w-60" />
      </Page>
    );
  if (!author)
    return (
      <Page
        crumbs={[{ label: "Biblioteca de autores", to: "/library" }, { label: "Não encontrado" }]}
      >
        <EmptyState
          icon={UserX}
          title="Autor não encontrado"
          body="Este autor não existe neste navegador."
          action={
            <Button asChild>
              <Link to="/library">Voltar</Link>
            </Button>
          }
        />
      </Page>
    );

  const stats = [
    { label: "Documentos", value: style.docCount },
    { label: "Versões", value: style.versionCount },
    { label: "Páginas (média)", value: style.avgPages ?? "—" },
    { label: "Origem humana", value: mine.length ? `${style.humanShare}%` : "—" },
  ];

  return (
    <Page
      crumbs={[{ label: "Biblioteca de autores", to: "/library" }, { label: author.name }]}
      title={
        <span className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-muted text-[13px] font-semibold">
            {author.name
              .split(" ")
              .map((x) => x[0])
              .slice(0, 2)
              .join("")}
          </span>
          {author.name}
        </span>
      }
      description={`Perfil de escrita construído a partir de ${style.docCount} documento(s).`}
    >
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-card px-4 py-3.5">
            <div className="text-[12px] text-muted-foreground">{s.label}</div>
            <div className="tnum mt-1 text-[22px] font-semibold tracking-tight">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section
          title="Secções frequentes"
          description="Títulos que se repetem nos documentos deste autor."
          className="!mt-0"
        >
          {style.sections.length ? (
            <ul className="panel divide-y divide-border">
              {style.sections.map((s) => (
                <li key={s.name} className="flex items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{s.name}</span>
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                    <motion.span
                      className="block h-full origin-left rounded-full bg-primary"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: s.count / Math.max(1, style.docCount) }}
                      transition={{ duration: 0.5 }}
                    />
                  </span>
                  <span className="tnum w-8 text-right text-[12px] text-muted-foreground">
                    {s.count}/{style.docCount}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="panel p-4 text-[12.5px] text-muted-foreground">
              Ainda não há secções identificadas.
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {style.kinds.map((k) => (
              <span
                key={k.kind}
                className="rounded border border-border bg-card px-2 py-0.5 text-[12px]"
              >
                {kindLabel[k.kind]} <span className="tnum text-muted-foreground">{k.count}</span>
              </span>
            ))}
            {style.fonts.map((f) => (
              <span
                key={f.name}
                className="rounded border border-border bg-card px-2 py-0.5 text-[12px] text-muted-foreground"
              >
                {f.name}
              </span>
            ))}
          </div>
        </Section>

        <Section
          title="Sugestões baseadas no seu estilo"
          description="Versão heurística. Será substituída pelo modelo treinado com este corpus."
          className="!mt-0"
        >
          <div className="panel divide-y divide-border">
            {suggestions.length ? (
              suggestions.map((s, i) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex gap-3 px-4 py-3"
                >
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={1.6} />
                  <div>
                    <div className="text-[13px] font-medium">{s.title}</div>
                    <div className="text-[12.5px] text-muted-foreground">{s.body}</div>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="p-4 text-[12.5px] text-muted-foreground">
                São precisos pelo menos dois documentos para sugerir.
              </div>
            )}
          </div>
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-dashed border-border p-3 text-[12px] text-muted-foreground">
            <Database className="mt-0.5 size-4 shrink-0" strokeWidth={1.6} />
            <span>
              Corpus pronto para indexação: {style.versionCount} versões com estrutura, tipografia e
              metadados. A indexação vetorial (RAG) e o fine-tuning por autor ficam disponíveis
              quando o backend for ligado.
            </span>
          </div>
        </Section>
      </div>

      <Section title="Documentos">
        <DocumentsTable docs={mine} authors={authors} />
      </Section>
    </Page>
  );
}
