import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ClipboardPaste,
  FileUp,
  RotateCw,
  X,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Page } from "@/components/app/page";
import { KindIcon, SecurityBadge, VerdictBadge, Kbd } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { ACCEPT } from "@/lib/analysis/common";
import { STAGES } from "@/lib/analysis";
import { uploadQueue, useUploadQueue, type QueueItem } from "@/lib/upload-queue";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSettings } from "@/services/queries";
import type { DocKind } from "@/types/domain";

export const Route = createFileRoute("/upload")({
  head: () => ({ meta: [{ title: "Carregar · DocQC" }] }),
  component: UploadPage,
});

const guessKind = (name: string): DocKind => {
  const e = name.toLowerCase().split(".").pop() ?? "";
  if (e === "pdf") return "pdf";
  if (/^doc[xm]?$|^dotx$/.test(e)) return "docx";
  if (/^xls[xm]?$/.test(e)) return "xlsx";
  if (/^ppt[xm]?$/.test(e)) return "pptx";
  if (e === "odt") return "odt";
  if (/jpe?g|png|hei[cf]/.test(e)) return "image";
  return "text";
};

function UploadPage() {
  const items = useUploadQueue();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    uploadQueue.setOnDone(() => void qc.invalidateQueries());
  }, [qc]);

  const add = useCallback((files: File[]) => {
    if (!files.length) return;
    uploadQueue.add(files);
  }, []);

  // Paste files from the clipboard (e.g. a screenshot or a file copied in Explorer/Finder).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        add(
          files.map((f, i) =>
            f.name === "image.png"
              ? new File([f], `colado-${Date.now()}-${i}.png`, { type: f.type })
              : f,
          ),
        );
        toast.success(`${files.length} ficheiro(s) colado(s)`);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [add]);

  const finished = items.filter(
    (i) => i.stage === "done" || i.stage === "error" || i.stage === "cancelled",
  ).length;

  return (
    <Page
      crumbs={[{ label: "Carregar" }]}
      title="Carregar documentos"
      description="A análise corre no seu navegador: o ficheiro não é aberto nem executado, apenas lido como dados."
    >
      <motion.div
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current++;
          setOver(true);
        }}
        onDragLeave={() => {
          depth.current--;
          if (depth.current <= 0) setOver(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          add(Array.from(e.dataTransfer.files));
        }}
        animate={{ scale: over ? 1.006 : 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed px-6 py-14 text-center transition-colors duration-150",
          over
            ? "border-primary bg-primary/[0.04]"
            : "border-border-strong bg-card hover:border-foreground/30",
        )}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      >
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <motion.div
          animate={over ? { y: -4 } : { y: 0 }}
          className={cn(
            "grid size-11 place-items-center rounded-xl border bg-background transition-colors",
            over ? "border-primary text-primary" : "border-border text-muted-foreground",
          )}
        >
          <FileUp className="size-5" strokeWidth={1.6} />
        </motion.div>
        <div className="mt-4 text-[14px] font-medium">
          {over ? "Largue para analisar" : "Arraste ficheiros para aqui"}
        </div>
        <div className="mt-1 text-[12.5px] text-muted-foreground">
          ou <span className="font-medium text-primary">escolha do computador</span> · cole com{" "}
          <Kbd>⌘</Kbd> <Kbd>V</Kbd>
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-1.5 text-[11px] text-muted-foreground">
          {["PDF", "DOCX", "XLSX", "PPTX", "ODT", "JPG", "PNG", "HEIC", "TXT", "MD"].map((t) => (
            <span key={t} className="rounded border border-border px-1.5 py-0.5 font-mono">
              {t}
            </span>
          ))}
          <span className="px-1.5 py-0.5">até {settings?.scanning.maxSizeMb ?? 50} MB</span>
        </div>
      </motion.div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Lock className="size-3.5" /> Processado localmente, sem envio para servidores
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" /> JavaScript, ações automáticas, macros e rastreadores
        </span>
        <span className="flex items-center gap-1.5">
          <ClipboardPaste className="size-3.5" /> O mesmo ficheiro com outro nome é reconhecido pelo
          hash
        </span>
      </div>

      {items.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold tracking-tight">
              Fila{" "}
              <span className="tnum ml-1 font-normal text-muted-foreground">{items.length}</span>
            </h2>
            {finished > 0 && (
              <Button variant="ghost" size="sm" onClick={() => uploadQueue.clearFinished()}>
                Limpar concluídos
              </Button>
            )}
          </div>
          <ul className="panel divide-y divide-border overflow-hidden">
            <AnimatePresence initial={false}>
              {items.map((it) => (
                <QueueRow key={it.id} it={it} />
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}
    </Page>
  );
}

function QueueRow({ it }: { it: QueueItem }) {
  const stageIdx = STAGES.findIndex((s) => s.id === it.stage);
  const label =
    it.stage === "error"
      ? "Falhou"
      : it.stage === "cancelled"
        ? "Cancelado"
        : (STAGES[stageIdx]?.label ?? "A carregar");
  const busy = it.stage !== "done" && it.stage !== "error" && it.stage !== "cancelled";
  const r = it.result;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="overflow-hidden"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <KindIcon kind={r?.analysis.kind ?? guessKind(it.file.name)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{it.file.name}</span>
            <span className="tnum shrink-0 text-[12px] text-muted-foreground">
              {formatBytes(it.file.size)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[12px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={label}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.12 }}
                className={cn(
                  "flex items-center gap-1.5",
                  it.stage === "error"
                    ? "text-danger"
                    : it.stage === "done"
                      ? "text-safe"
                      : "text-muted-foreground",
                )}
              >
                {it.stage === "done" ? (
                  <Check className="size-3.5" />
                ) : it.stage === "error" ? (
                  <AlertCircle className="size-3.5" />
                ) : null}
                {label}
                {it.stage === "done" && r && (
                  <span className="text-muted-foreground">
                    ·{" "}
                    {r.status === "duplicate"
                      ? `já existia (v${r.versionN})`
                      : r.status === "new-version"
                        ? `guardado como versão ${r.versionN}`
                        : "novo documento"}
                  </span>
                )}
              </motion.span>
            </AnimatePresence>
            {busy && (
              <span className="hidden gap-1 sm:flex">
                {STAGES.slice(0, 4).map((s, i) => (
                  <span
                    key={s.id}
                    className={cn(
                      "h-1 w-4 rounded-full transition-colors duration-300",
                      i <= stageIdx ? "bg-primary" : "bg-border",
                    )}
                  />
                ))}
              </span>
            )}
          </div>
          {it.error && <div className="mt-1 text-[12px] text-muted-foreground">{it.error}</div>}
        </div>
        {r && it.stage === "done" && (
          <div className="hidden items-center gap-1.5 md:flex">
            <VerdictBadge v={r.analysis.origin.verdict} short />
            <SecurityBadge s={r.analysis.securityState} />
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {busy && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => uploadQueue.cancel(it.id)}
              aria-label="Cancelar"
            >
              <X />
            </Button>
          )}
          {(it.stage === "error" || it.stage === "cancelled") && (
            <>
              {it.stage === "cancelled" && (
                <Button variant="ghost" size="sm" onClick={() => uploadQueue.retry(it.id)}>
                  <RotateCw /> Repetir
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => uploadQueue.remove(it.id)}
                aria-label="Remover"
              >
                <X />
              </Button>
            </>
          )}
          {it.stage === "done" && r && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/documents/$id" params={{ id: r.docId }}>
                Ver análise <ArrowRight />
              </Link>
            </Button>
          )}
        </div>
      </div>
      <div className="h-px bg-transparent">
        {(busy || it.stage === "done") && (
          <motion.div
            className={cn("h-px origin-left", it.stage === "done" ? "bg-safe/60" : "bg-primary")}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: it.progress, opacity: it.stage === "done" ? 0 : 1 }}
            transition={{
              scaleX: { duration: 0.25, ease: "easeOut" },
              opacity: { delay: 0.6, duration: 0.4 },
            }}
          />
        )}
      </div>
    </motion.li>
  );
}
