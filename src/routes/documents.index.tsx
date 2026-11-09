import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Files, Search, UploadCloud, X } from "lucide-react";
import { Page, EmptyState } from "@/components/app/page";
import { DocumentsTable } from "@/components/app/documents-table";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { useAuthors, useDocuments } from "@/services/queries";
import { kindLabel } from "@/lib/format";
import type { DocKind } from "@/types/domain";

export const Route = createFileRoute("/documents/")({
  head: () => ({ meta: [{ title: "Documentos · DocQC" }] }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const { data: docs = [], isPending } = useDocuments();
  const { data: authors = [] } = useAuthors();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [origin, setOrigin] = useState("");
  const [sec, setSec] = useState("");

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return docs.filter((d) => {
      const v = d.versions[d.versions.length - 1];
      if (!v) return false;
      if (
        n &&
        !`${d.name} ${v.analysis.title ?? ""} ${v.analysis.author ?? ""}`.toLowerCase().includes(n)
      )
        return false;
      if (kind && d.kind !== kind) return false;
      if (origin && v.analysis.origin.verdict !== origin) return false;
      if (sec && v.analysis.securityState !== sec) return false;
      return true;
    });
  }, [docs, q, kind, origin, sec]);
  const anyFilter = q || kind || origin || sec;

  return (
    <Page
      crumbs={[{ label: "Documentos" }]}
      title="Documentos"
      description="Todos os documentos analisados, com o estado da versão mais recente."
      actions={
        <Button asChild>
          <Link to="/upload">
            <UploadCloud /> Carregar
          </Link>
        </Button>
      }
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrar por nome, título ou autor"
            className="pl-8"
          />
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex">
          <NativeSelect
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="sm:w-32"
            aria-label="Tipo"
          >
            <option value="">Todos os tipos</option>
            {(Object.keys(kindLabel) as DocKind[]).map((k) => (
              <option key={k} value={k}>
                {kindLabel[k]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="sm:w-44"
            aria-label="Origem"
          >
            <option value="">Qualquer origem</option>
            <option>Provável origem humana</option>
            <option>Indícios de IA</option>
            <option>Gerado em sandbox de IA</option>
          </NativeSelect>
          <NativeSelect
            value={sec}
            onChange={(e) => setSec(e.target.value)}
            className="sm:w-36"
            aria-label="Segurança"
          >
            <option value="">Qualquer estado</option>
            <option>Seguro</option>
            <option>Atenção</option>
            <option>Perigoso</option>
          </NativeSelect>
        </div>
        {anyFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (setQ(""), setKind(""), setOrigin(""), setSec(""))}
          >
            <X /> Limpar
          </Button>
        )}
        <span className="tnum text-[12px] text-muted-foreground sm:ml-auto">
          {filtered.length} de {docs.length}
        </span>
      </div>
      {!isPending && filtered.length === 0 ? (
        <EmptyState
          icon={Files}
          title={
            docs.length ? "Nenhum documento corresponde aos filtros" : "Ainda não há documentos"
          }
          body={
            docs.length
              ? "Ajuste ou limpe os filtros para ver mais resultados."
              : "Carregue o primeiro ficheiro para ver a análise de origem e segurança."
          }
          action={
            !docs.length && (
              <Button asChild>
                <Link to="/upload">Carregar ficheiros</Link>
              </Button>
            )
          }
        />
      ) : (
        <DocumentsTable docs={filtered} authors={authors} loading={isPending} />
      )}
    </Page>
  );
}
