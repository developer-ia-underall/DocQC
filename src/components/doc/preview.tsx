import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { DocVersion } from "@/types/domain";
import { getFile } from "@/services/store";
import { Skeleton } from "@/components/ui/skeleton";
import { KindIcon } from "@/components/app/status";
import { kindLabel } from "@/lib/format";

/**
 * First-page preview. PDFs are rendered with pdf.js with scripting disabled (it never executes
 * document JavaScript), images via an object URL, everything else as a structural outline.
 */
export function Preview({ version }: { version: DocVersion }) {
  const [bytes, setBytes] = useState<Uint8Array | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setBytes(undefined);
    void getFile(version.id).then((b) => alive && setBytes(b));
    return () => {
      alive = false;
    };
  }, [version.id]);

  const a = version.analysis;
  return (
    <div className="panel overflow-hidden">
      <div className="flex aspect-[1/1.2] items-center justify-center bg-subtle p-5">
        {bytes === undefined ? (
          <Skeleton className="h-full w-[78%]" />
        ) : bytes && a.kind === "pdf" ? (
          <PdfCanvas bytes={bytes} />
        ) : bytes && a.kind === "image" && a.mime !== "image/heic" ? (
          <ImageView bytes={bytes} mime={a.mime} />
        ) : (
          <Outline version={version} />
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
        <span>{kindLabel[a.kind]}</span>
        <span className="tnum">
          {[
            a.structure.pages
              ? `${a.structure.pages} ${a.kind === "xlsx" ? "folha(s)" : a.kind === "pptx" ? "diapositivo(s)" : "página(s)"}`
              : "",
            a.structure.words ? `${a.structure.words.toLocaleString("pt-PT")} palavras` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
}

function PdfCanvas({ bytes }: { bytes: Uint8Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const task = pdfjs.getDocument({ data: bytes.slice(), enableXfa: false });
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const canvas = ref.current;
        if (!canvas || cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = (560 / base.width) * Math.min(2, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport } as never)
          .promise;
        if (!cancelled) setState("ok");
        void task.destroy();
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {state === "loading" && <Skeleton className="absolute h-full w-[78%]" />}
      {state === "error" && (
        <div className="text-[12.5px] text-muted-foreground">Pré-visualização indisponível</div>
      )}
      <motion.canvas
        ref={ref}
        initial={{ opacity: 0 }}
        animate={{ opacity: state === "ok" ? 1 : 0 }}
        className="max-h-full max-w-full rounded-sm bg-white shadow-[0_1px_3px_rgb(0_0_0/0.08),0_8px_24px_-8px_rgb(0_0_0/0.15)]"
      />
    </div>
  );
}

function ImageView({ bytes, mime }: { bytes: Uint8Array; mime: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, mime]);
  return url ? (
    <motion.img
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      src={url}
      alt=""
      className="max-h-full max-w-full rounded-sm object-contain shadow-sm"
    />
  ) : null;
}

function Outline({ version }: { version: DocVersion }) {
  const a = version.analysis;
  return (
    <div className="flex h-full w-[78%] flex-col rounded-sm bg-card p-5 shadow-[0_1px_3px_rgb(0_0_0/0.06),0_8px_24px_-8px_rgb(0_0_0/0.12)]">
      <div className="flex items-center gap-2">
        <KindIcon kind={a.kind} className="size-6" />
        <span className="truncate text-[12px] font-medium">{a.title ?? version.fileName}</span>
      </div>
      <div className="mt-4 space-y-2.5 overflow-hidden">
        {a.structure.sections.length
          ? a.structure.sections.slice(0, 9).map((s, i) => (
              <div key={i}>
                <div className="truncate text-[11px] font-medium">{s}</div>
                <div className="mt-1 h-1.5 w-full rounded bg-muted" />
                <div className="mt-1 h-1.5 w-4/5 rounded bg-muted" />
              </div>
            ))
          : Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-1.5 rounded bg-muted"
                style={{ width: `${60 + ((i * 37) % 40)}%` }}
              />
            ))}
      </div>
    </div>
  );
}
