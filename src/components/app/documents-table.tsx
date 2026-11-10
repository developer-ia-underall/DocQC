import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ChevronRight, GitBranch } from "lucide-react";
import type { Author, DocumentRecord } from "@/types/domain";
import { kindLabel, relativeTime } from "@/lib/format";
import { KindIcon, SecurityBadge, VerdictBadge } from "./status";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/context";

export function DocumentsTable({
  docs,
  authors,
  loading,
  limit,
}: {
  docs: DocumentRecord[];
  authors: Author[];
  loading?: boolean;
  limit?: number;
}) {
  const rows = limit ? docs.slice(0, limit) : docs;
  const authorName = (id: string | null) => authors.find((a) => a.id === id)?.name;
  const me = useAuth().session?.user.id;

  if (loading)
    return (
      <div className="panel divide-y divide-border">
        {Array.from({ length: limit ?? 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-7" />
            <Skeleton className="h-3.5 w-56" />
            <Skeleton className="ml-auto h-5 w-24 rounded-full" />
            <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
          </div>
        ))}
      </div>
    );

  return (
    <div className="panel overflow-hidden">
      <div className="hidden grid-cols-[minmax(0,1fr)_150px_110px_150px_64px_110px_20px] items-center gap-4 border-b border-border bg-subtle px-4 py-2 text-[11.5px] font-medium text-muted-foreground lg:grid">
        <span>Documento</span>
        <span>Origem</span>
        <span>Segurança</span>
        <span>Autor</span>
        <span className="text-right">Versões</span>
        <span className="text-right">Atualizado</span>
        <span />
      </div>
      <motion.ul
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.025 } } }}
      >
        {rows.map((d) => {
          const last = d.versions[d.versions.length - 1];
          if (!last) return null;
          const a = last.analysis;
          return (
            <motion.li
              key={d.id}
              variants={{
                hidden: { opacity: 0, y: 4 },
                show: { opacity: 1, y: 0, transition: { duration: 0.18 } },
              }}
              className="border-b border-border last:border-0"
            >
              <Link
                to="/documents/$id"
                params={{ id: d.id }}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-2.5 transition-colors hover:bg-subtle lg:grid-cols-[minmax(0,1fr)_150px_110px_150px_64px_110px_20px]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <KindIcon kind={d.kind} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{d.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {kindLabel[d.kind]}
                      {d.ownerId && d.ownerId !== me
                        ? ` · carregado por ${d.ownerName || d.ownerEmail}`
                        : a.title
                          ? ` · ${a.title}`
                          : ""}
                    </span>
                  </span>
                </span>
                <span className="justify-self-end lg:justify-self-start">
                  <VerdictBadge v={a.origin.verdict} short />
                </span>
                <span className="col-span-2 flex flex-wrap items-center gap-2 lg:contents">
                  <span>
                    <SecurityBadge s={a.securityState} />
                  </span>
                  <span className="truncate text-[12.5px] text-muted-foreground lg:text-foreground/80">
                    {authorName(d.authorId) ?? "—"}
                  </span>
                  <span className="tnum inline-flex items-center gap-1 text-[12.5px] text-muted-foreground lg:justify-end">
                    <GitBranch className="size-3.5 lg:hidden" />v{d.versions.length}
                  </span>
                  <span className="ml-auto text-[12.5px] text-muted-foreground lg:ml-0 lg:text-right">
                    {relativeTime(d.updatedAt)}
                  </span>
                  <ChevronRight className="hidden size-4 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground lg:block" />
                </span>
              </Link>
            </motion.li>
          );
        })}
      </motion.ul>
    </div>
  );
}
