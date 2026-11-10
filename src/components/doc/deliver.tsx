import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Download, Fingerprint, Loader2, Monitor, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import type { DocumentRecord, DocVersion, IdentityProfile, RewriteOptions } from "@/types/domain";
import { useProfiles, useSettings } from "@/services/queries";
import { identityAccess } from "@/services/identities";
import { useAuth } from "@/lib/auth/context";
import * as store from "@/services/store";
import { rewriteDocument } from "@/lib/rewrite";
import { analyzeBytes } from "@/lib/analysis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SecurityBadge, VerdictBadge } from "@/components/app/status";
import { DiffTable, metadataDiff } from "./panels";
import { cn } from "@/lib/utils";
import { saveFile } from "@/lib/platform";

type Result = {
  bytes: Uint8Array;
  fileName: string;
  mime: string;
  changes: string[];
  before: DocVersion["analysis"];
  after: DocVersion;
  versionN: number;
};

export const download = (bytes: Uint8Array, name: string, mime: string) =>
  saveFile(bytes, name, mime);

export function DeliverPanel({ doc, version }: { doc: DocumentRecord; version: DocVersion }) {
  const { data: allProfiles = [] } = useProfiles();
  const { session, profile: account } = useAuth();
  // Assina-se com identidades próprias; o administrador pode usar qualquer uma.
  // (O gestor vê as dos outros na página Identidades, mas não as usa para entregar.)
  const profiles = useMemo(
    () =>
      allProfiles.filter(
        (p) => identityAccess(p, { id: session?.user.id, role: account?.role }).canEdit,
      ),
    [allProfiles, session?.user.id, account?.role],
  );
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const a = version.analysis;
  const hasActive = a.findings.some((f) => f.severity === "crítico" || f.severity === "alto");
  const [profileId, setProfileId] = useState<string>("");
  const [opts, setOpts] = useState<RewriteOptions>({
    removeActive: hasActive,
    removeExternal: hasActive,
    normalizeDates: true,
    suffix: "",
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [hasFile, setHasFile] = useState<boolean | null>(null);

  useEffect(() => {
    if (!profileId && profiles[0]) setProfileId(profiles[0].id);
  }, [profiles, profileId]);
  useEffect(() => {
    // Keep the success screen when the page switches to the version we just generated.
    setResult((r) => (r && r.after.id === version.id ? r : null));
    void store.getFile(version.id).then((b) => setHasFile(!!b));
  }, [version.id]);

  const profile = profiles.find((p) => p.id === profileId);
  const planned = useMemo(() => plan(a.kind, profile, opts), [a.kind, profile, opts]);

  const run = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const bytes = await store.getFile(version.id);
      if (!bytes) throw new Error("O ficheiro original não está disponível.");
      const out = await rewriteDocument({
        bytes,
        fileName: version.fileName,
        kind: a.kind,
        title: a.title,
        created: a.created,
        profile,
        options: opts,
      });
      const analysed = await analyzeBytes(out.bytes, out.fileName, {
        ...(settings?.scanning ?? store.DEFAULT_SETTINGS.scanning),
        maxSizeMb: 500,
      });
      const res = await store.ingest({
        fileName: out.fileName,
        size: out.bytes.length,
        hash: analysed.hash,
        bytes: out.bytes,
        analysis: analysed.analysis,
        uploadedBy: profile.fullName,
        documentId: doc.id,
        rewrittenWith: profile.fullName,
        note: out.changes.join(" "),
      });
      await qc.invalidateQueries();
      setResult({ ...out, before: a, after: res.version, versionN: res.version.n });
      void download(out.bytes, out.fileName, out.mime);
      toast.success("Ficheiro gerado", {
        description: `${out.fileName} · guardado como versão ${res.version.n}`,
      });
    } catch (e) {
      toast.error("Não foi possível gerar o ficheiro", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  if (hasFile === false)
    return (
      <div className="panel p-5 text-[13px] text-muted-foreground">
        O ficheiro desta versão não está disponível (os exemplos de demonstração não têm ficheiro).
        Carregue-o novamente para o poder entregar.
      </div>
    );

  if (!profiles.length)
    return (
      <div className="panel flex flex-col items-center p-8 text-center">
        <Fingerprint className="size-5 text-muted-foreground" />
        <div className="mt-2 font-medium">Crie primeiro uma identidade</div>
        <p className="mt-1 max-w-xs text-[12.5px] text-muted-foreground">
          A identidade define a pessoa e a máquina que ficam registadas nos metadados.
        </p>
        <Button asChild className="mt-4">
          <Link to="/profiles">
            <Plus /> Nova identidade
          </Link>
        </Button>
      </div>
    );

  return (
    <AnimatePresence mode="wait">
      {result ? (
        <motion.div
          key="done"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="space-y-5"
        >
          <div className="panel flex flex-col items-center p-6 text-center">
            <SuccessCheck />
            <div className="mt-3 text-[15px] font-semibold">Ficheiro pronto</div>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {result.fileName} foi descarregado e guardado como versão {result.versionN}.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button onClick={() => void download(result.bytes, result.fileName, result.mime)}>
                <Download /> Descarregar de novo
              </Button>
              <Button variant="outline" onClick={() => setResult(null)}>
                Gerar outra
              </Button>
            </div>
          </div>
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-border border-b border-border text-[12px]">
              <div className="p-3">
                <div className="mb-1.5 text-muted-foreground">Antes</div>
                <div className="flex flex-wrap gap-1.5">
                  <VerdictBadge v={result.before.origin.verdict} short />
                  <SecurityBadge s={result.before.securityState} />
                </div>
              </div>
              <div className="p-3">
                <div className="mb-1.5 text-muted-foreground">Depois</div>
                <div className="flex flex-wrap gap-1.5">
                  <VerdictBadge v={result.after.analysis.origin.verdict} short />
                  <SecurityBadge s={result.after.analysis.securityState} />
                </div>
              </div>
            </div>
            <ul className="space-y-1 border-b border-border px-4 py-3 text-[12.5px]">
              {result.changes.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-primary" />
                  {c}
                </li>
              ))}
            </ul>
            <div className="bg-subtle px-4 py-1.5 text-[11.5px] text-muted-foreground">
              Diferenças nos metadados
            </div>
            <DiffTable
              rows={metadataDiff(result.before.metadata, result.after.analysis.metadata)}
            />
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="form"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="space-y-5"
        >
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Identidade a registar</h3>
              <Link
                to="/profiles"
                className="text-[12px] text-muted-foreground hover:text-foreground"
              >
                Gerir identidades
              </Link>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProfileId(p.id)}
                  className={cn(
                    "relative rounded-lg border p-3 text-left transition-colors",
                    p.id === profileId
                      ? "border-primary bg-primary/[0.04] ring-1 ring-primary"
                      : "border-border bg-card hover:border-border-strong",
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-8 place-items-center rounded-full bg-muted text-[11.5px] font-semibold">
                      {p.fullName
                        .split(" ")
                        .map((x) => x[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.fullName}</div>
                      <div className="truncate text-[12px] text-muted-foreground">{p.role}</div>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <Monitor className="size-3.5" />
                    <span className="truncate">
                      {p.computerName} · {p.application}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="panel divide-y divide-border">
            {(
              [
                [
                  "removeActive",
                  "Remover conteúdo ativo",
                  "JavaScript, ações automáticas ao abrir, macros, ficheiros incorporados.",
                ],
                [
                  "removeExternal",
                  "Remover ligações externas",
                  "Modelos remotos, imagens remotas (pixels de rastreio) e ações /URI. Hiperligações de texto no Word são mantidas.",
                ],
                [
                  "normalizeDates",
                  "Normalizar datas",
                  `Datas no fuso da identidade (${profile?.timezone ?? "—"}) em vez de UTC, com modificação posterior à criação.`,
                ],
              ] as const
            ).map(([k, title, body]) => (
              <label
                key={k}
                className="flex cursor-pointer items-start justify-between gap-4 px-4 py-3"
              >
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{body}</span>
                </span>
                <Switch
                  checked={opts[k]}
                  onCheckedChange={(v) => setOpts((o) => ({ ...o, [k]: v }))}
                  className="mt-0.5"
                />
              </label>
            ))}
            <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <Label htmlFor="suffix">Sufixo no nome do ficheiro</Label>
              <Input
                id="suffix"
                value={opts.suffix}
                onChange={(e) => setOpts((o) => ({ ...o, suffix: e.target.value }))}
                placeholder="opcional, ex.: final"
                className="sm:w-48"
              />
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-[13px] font-semibold">O que vai mudar</h3>
            <ul className="panel space-y-1.5 p-4 text-[12.5px]">
              {planned.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-primary" />
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] text-muted-foreground">
              O conteúdo do documento não é alterado. O original fica guardado nas versões.
            </p>
            <Button onClick={run} disabled={busy || !profile} size="lg">
              {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {busy ? "A gerar…" : "Gerar ficheiro"}
              {!busy && <ArrowRight />}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function plan(kind: string, p: IdentityProfile | undefined, o: RewriteOptions): string[] {
  if (!p) return [];
  if (kind === "text")
    return ["Ficheiros de texto não têm metadados: o ficheiro é entregue sem alterações."];
  if (kind === "image")
    return [
      "Remover EXIF, XMP, IPTC, GPS, parâmetros de geração e manifestos C2PA.",
      "Manter o perfil de cor para a imagem ficar idêntica.",
    ];
  const out = [`Autor e última modificação → ${p.fullName}`, `Aplicação → ${p.application}`];
  if (p.company && kind !== "odt") out.push(`Empresa → ${p.company}`);
  if (o.normalizeDates) out.push(`Datas no fuso ${p.timezone}`);
  if (kind === "pdf") out.push("Regenerar XMP coerente com o dicionário Info");
  if (o.removeActive) out.push("Neutralizar conteúdo ativo");
  if (o.removeExternal) out.push("Remover relações e ações externas");
  return out;
}

function SuccessCheck() {
  return (
    <motion.svg viewBox="0 0 52 52" className="size-12" initial="h" animate="s">
      <motion.circle
        cx="26"
        cy="26"
        r="24"
        fill="none"
        stroke="var(--safe)"
        strokeWidth="2"
        variants={{
          h: { pathLength: 0, opacity: 0 },
          s: { pathLength: 1, opacity: 1, transition: { duration: 0.45, ease: "easeOut" } },
        }}
      />
      <motion.path
        d="M15 27l7 7 15-16"
        fill="none"
        stroke="var(--safe)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={{
          h: { pathLength: 0 },
          s: { pathLength: 1, transition: { delay: 0.35, duration: 0.3, ease: "easeOut" } },
        }}
      />
    </motion.svg>
  );
}
