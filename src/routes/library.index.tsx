import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ChevronRight, Library } from "lucide-react";
import { Page, EmptyState } from "@/components/app/page";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthors, useDocuments } from "@/services/queries";
import { authorStyle } from "@/lib/suggestions";
import { relativeTime } from "@/lib/format";

export const Route = createFileRoute("/library/")({
  head: () => ({ meta: [{ title: "Biblioteca · DocQC" }] }),
  component: LibraryPage,
});

function LibraryPage() {
  const { data: authors = [], isPending } = useAuthors();
  const { data: docs = [] } = useDocuments();
  const rows = authors
    .map((a) => {
      const mine = docs.filter((d) => d.authorId === a.id);
      return { a, mine, style: authorStyle(mine), last: mine[0]?.updatedAt };
    })
    .sort((x, y) => y.mine.length - x.mine.length);

  return (
    <Page
      crumbs={[{ label: "Biblioteca de autores" }]}
      title="Biblioteca de autores"
      description="Documentos agrupados por autor. É este corpus que alimenta as sugestões e, numa fase seguinte, a indexação RAG e o fine-tuning por pessoa."
    >
      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Library}
          title="Ainda sem autores"
          body="Os autores são criados automaticamente a partir dos metadados e das identidades."
        />
      ) : (
        <div className="panel overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1fr)_90px_90px_140px_120px_20px] gap-4 border-b border-border bg-subtle px-4 py-2 text-[11.5px] font-medium text-muted-foreground md:grid">
            <span>Autor</span>
            <span className="text-right">Documentos</span>
            <span className="text-right">Versões</span>
            <span>Origem humana</span>
            <span className="text-right">Atividade</span>
            <span />
          </div>
          <motion.ul
            initial="h"
            animate="s"
            variants={{ s: { transition: { staggerChildren: 0.03 } } }}
          >
            {rows.map(({ a, mine, style, last }) => (
              <motion.li
                key={a.id}
                variants={{ h: { opacity: 0, y: 4 }, s: { opacity: 1, y: 0 } }}
                className="border-b border-border last:border-0"
              >
                <Link
                  to="/library/$authorId"
                  params={{ authorId: a.id }}
                  className="group grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 transition-colors hover:bg-subtle md:grid-cols-[minmax(0,1fr)_90px_90px_140px_120px_20px]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[11.5px] font-semibold">
                      {a.name
                        .split(" ")
                        .map((x) => x[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {style.kinds.map((k) => k.kind.toUpperCase()).join(" · ") ||
                          "sem documentos"}
                      </span>
                    </span>
                  </span>
                  <span className="tnum text-right text-[12.5px] md:text-[13px]">
                    {mine.length}
                    <span className="text-muted-foreground md:hidden"> docs</span>
                  </span>
                  <span className="tnum hidden text-right md:block">{style.versionCount}</span>
                  <span className="hidden items-center gap-2 md:flex">
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <motion.span
                        className="block h-full origin-left rounded-full bg-safe"
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: style.humanShare / 100 }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                      />
                    </span>
                    <span className="tnum text-[12px] text-muted-foreground">
                      {mine.length ? `${style.humanShare}%` : "—"}
                    </span>
                  </span>
                  <span className="hidden text-right text-[12.5px] text-muted-foreground md:block">
                    {last ? relativeTime(last) : "—"}
                  </span>
                  <ChevronRight className="hidden size-4 text-transparent group-hover:text-muted-foreground md:block" />
                </Link>
              </motion.li>
            ))}
          </motion.ul>
        </div>
      )}
    </Page>
  );
}
