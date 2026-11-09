import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Download, GitBranch, MoreHorizontal, Trash2, FileQuestion, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Page, EmptyState } from "@/components/app/page";
import { KindIcon, SecurityBadge, VerdictBadge } from "@/components/app/status";
import { Preview } from "@/components/doc/preview";
import {
  MetadataPanel,
  OriginPanel,
  SecurityPanel,
  VersionMeta,
  VersionsPanel,
} from "@/components/doc/panels";
import { DeliverPanel, download } from "@/components/doc/deliver";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthors, useDeleteDocument, useDocument, useDocuments } from "@/services/queries";
import { getFile } from "@/services/store";
import { authorStyle, suggestFor } from "@/lib/suggestions";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "origem", label: "Origem" },
  { id: "seguranca", label: "Segurança" },
  { id: "metadados", label: "Metadados" },
  { id: "versoes", label: "Versões" },
  { id: "entregar", label: "Entregar" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export const Route = createFileRoute("/documents/$id")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; v?: string } => ({
    ...(TABS.some((t) => t.id === s["tab"]) ? { tab: s["tab"] as Tab } : {}),
    ...(typeof s["v"] === "string" ? { v: s["v"] } : {}),
  }),
  head: () => ({ meta: [{ title: "Documento · DocQC" }] }),
  component: DocumentPage,
});

function DocumentPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: doc, isPending } = useDocument(id);
  const { data: authors = [] } = useAuthors();
  const { data: allDocs = [] } = useDocuments();
  const del = useDeleteDocument();
  const tab: Tab = search.tab ?? "origem";
  const setTab = (t: Tab) => void navigate({ search: (s) => ({ ...s, tab: t }), replace: true });

  const latest = doc?.versions[doc.versions.length - 1];
  const version = doc?.versions.find((v) => v.id === search.v) ?? latest;

  if (isPending)
    return (
      <Page crumbs={[{ label: "Documentos", to: "/documents" }, { label: "…" }]} wide>
        <Skeleton className="h-7 w-72" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr]">
          <Skeleton className="aspect-[1/1.2]" />
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </Page>
    );

  if (!doc || !version)
    return (
      <Page crumbs={[{ label: "Documentos", to: "/documents" }, { label: "Não encontrado" }]}>
        <EmptyState
          icon={FileQuestion}
          title="Documento não encontrado"
          body="Pode ter sido removido, ou foi carregado noutro navegador."
          action={
            <Button asChild>
              <Link to="/documents">Ver documentos</Link>
            </Button>
          }
        />
      </Page>
    );

  const author = authors.find((a) => a.id === doc.authorId);
  const a = version.analysis;
  const isLatest = version.id === latest?.id;
  const style = author ? authorStyle(allDocs.filter((d) => d.authorId === author.id)) : null;
  const suggestions = style && style.docCount > 1 ? suggestFor(style, doc).slice(0, 2) : [];

  const downloadOriginal = async () => {
    const b = await getFile(version.id);
    if (!b) {
      toast.error("Ficheiro não disponível neste navegador");
      return;
    }
    download(b, version.fileName, a.mime === "image/*" ? "application/octet-stream" : a.mime);
  };

  return (
    <Page crumbs={[{ label: "Documentos", to: "/documents" }, { label: doc.name }]} wide>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <KindIcon kind={doc.kind} className="mt-0.5 size-9" />
          <div className="min-w-0">
            <h1 className="truncate text-[20px] font-semibold tracking-tight">{doc.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <VerdictBadge v={a.origin.verdict} />
              <SecurityBadge s={a.securityState} />
              {author && (
                <Link
                  to="/library/$authorId"
                  params={{ authorId: author.id }}
                  className="text-[12.5px] text-muted-foreground hover:text-foreground"
                >
                  {author.name}
                </Link>
              )}
              <VersionMeta v={version} />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <GitBranch /> v{version.n}
                <span className="text-muted-foreground">/ {doc.versions.length}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Versões</DropdownMenuLabel>
              {[...doc.versions].reverse().map((v) => (
                <DropdownMenuItem
                  key={v.id}
                  onSelect={() =>
                    void navigate({ search: (s) => ({ ...s, v: v.id }), replace: true })
                  }
                >
                  <span
                    className={cn(
                      "tnum w-6 font-mono text-[12px]",
                      v.id === version.id && "text-primary",
                    )}
                  >
                    v{v.n}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{v.fileName}</span>
                  {v.rewrittenWith && <Sparkles className="!text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={downloadOriginal}>
            <Download /> <span className="hidden sm:inline">Descarregar</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Mais ações">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setTab("entregar")}>
                <Sparkles /> Entregar com identidade
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-danger focus:text-danger [&_svg]:!text-danger"
                onSelect={async () => {
                  if (!confirm(`Remover "${doc.name}" e as ${doc.versions.length} versões?`))
                    return;
                  await del.mutateAsync(doc.id);
                  toast.success("Documento removido");
                  void navigate({ to: "/documents" });
                }}
              >
                <Trash2 /> Remover documento
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!isLatest && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-subtle px-4 py-2 text-[12.5px]">
          <span>
            Está a ver a versão {version.n}. A mais recente é a versão {latest?.n}.
          </span>
          <button
            className="font-medium text-primary"
            onClick={() => void navigate({ search: ({ v: _v, ...s }) => s, replace: true })}
          >
            Ver mais recente
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <div className="space-y-4 lg:sticky lg:top-[72px] lg:self-start">
          <Preview version={version} />
          {a.structure.sections.length > 0 && (
            <div className="panel p-4">
              <div className="eyebrow mb-2">Estrutura</div>
              <ol className="space-y-1 text-[12.5px]">
                {a.structure.sections.slice(0, 10).map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="tnum w-4 text-muted-foreground">{i + 1}</span>
                    <span className="truncate">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="panel p-4">
              <div className="mb-2 flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary" />
                <span className="eyebrow">
                  Sugestões baseadas no estilo de {author?.name.split(" ")[0]}
                </span>
              </div>
              <ul className="space-y-2.5">
                {suggestions.map((s) => (
                  <li key={s.id} className="text-[12.5px]">
                    <div className="font-medium">{s.title}</div>
                    <div className="text-muted-foreground">{s.body}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div
            className="relative mb-5 flex gap-1 overflow-x-auto border-b border-border"
            role="tablist"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative shrink-0 px-3 pb-2.5 pt-1 text-[13px] transition-colors",
                  tab === t.id
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {t.id === "seguranca" && a.findings.length > 0 && (
                  <span
                    className={cn(
                      "tnum ml-1.5 rounded-full px-1.5 text-[10.5px]",
                      a.securityState === "Perigoso"
                        ? "bg-danger-soft text-danger"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {a.findings.length}
                  </span>
                )}
                {t.id === "versoes" && (
                  <span className="tnum ml-1.5 rounded-full bg-muted px-1.5 text-[10.5px] text-muted-foreground">
                    {doc.versions.length}
                  </span>
                )}
                {tab === t.id && (
                  <motion.span
                    layoutId="doc-tab"
                    className="absolute inset-x-1 -bottom-px h-[2px] rounded-full bg-foreground"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={tab === "entregar" ? tab : tab + version.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={{ duration: 0.15 }}
            >
              {tab === "origem" && <OriginPanel a={a} />}
              {tab === "seguranca" && <SecurityPanel a={a} />}
              {tab === "metadados" && <MetadataPanel a={a} />}
              {tab === "versoes" && (
                <VersionsPanel
                  doc={doc}
                  selected={version.id}
                  onSelect={(v) =>
                    void navigate({ search: (s) => ({ ...s, v, tab: "origem" }), replace: true })
                  }
                />
              )}
              {tab === "entregar" && <DeliverPanel doc={doc} version={version} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Page>
  );
}
