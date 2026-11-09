import type { AnalysisResult, DocKind } from "@/types/domain";
import {
  type Analyzer,
  type ScanOptions,
  AnalysisError,
  detectKind,
  mimeOf,
  securityStateOf,
} from "./common";
import { pdfAnalyzer } from "./pdf";
import { ooxmlAnalyzer, odtAnalyzer } from "./ooxml";
import { imageAnalyzer, textAnalyzer } from "./image";
import { evaluateOrigin } from "@/lib/origin/engine";
import { sha256 } from "@/lib/hash";

export { AnalysisError } from "./common";

export type Stage = "upload" | "hash" | "extract" | "scan" | "done";
export const STAGES: { id: Stage; label: string }[] = [
  { id: "upload", label: "A carregar" },
  { id: "hash", label: "A calcular hash" },
  { id: "extract", label: "A extrair metadados" },
  { id: "scan", label: "Verificação de segurança" },
  { id: "done", label: "Concluído" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ANALYZERS: Record<DocKind, Analyzer<any>> = {
  pdf: pdfAnalyzer,
  docx: ooxmlAnalyzer,
  xlsx: ooxmlAnalyzer,
  pptx: ooxmlAnalyzer,
  odt: odtAnalyzer,
  image: imageAnalyzer,
  text: textAnalyzer,
};

export interface AnalyzeOptions extends ScanOptions {
  maxSizeMb: number;
  signal?: AbortSignal;
  onStage?: (s: Stage, progress: number) => void;
}

export interface AnalyzeOutput {
  hash: string;
  bytes: Uint8Array;
  analysis: AnalysisResult;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Reads a File with real progress events (FileReader), so the upload bar reflects actual bytes read. */
export function readFile(
  file: File,
  onProgress: (p: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(new AnalysisError("corrupt", "Não foi possível ler o ficheiro."));
    r.onabort = () => reject(new AnalysisError("cancelled", "Cancelado."));
    signal?.addEventListener("abort", () => r.abort());
    r.readAsArrayBuffer(file);
  });
}

export async function analyzeBytes(
  bytes: Uint8Array,
  fileName: string,
  opts: AnalyzeOptions,
): Promise<AnalyzeOutput> {
  const check = () => {
    if (opts.signal?.aborted) throw new AnalysisError("cancelled", "Cancelado.");
  };
  if (bytes.length === 0) throw new AnalysisError("empty", "O ficheiro está vazio.");
  if (bytes.length > opts.maxSizeMb * 1024 * 1024)
    throw new AnalysisError("too_large", `Ficheiro demasiado grande (máx. ${opts.maxSizeMb} MB).`);

  opts.onStage?.("hash", 0.3);
  await tick();
  const hash = await sha256(bytes);
  check();

  const kind = detectKind(fileName, bytes.subarray(0, 32));
  const a = ANALYZERS[kind];
  opts.onStage?.("extract", 0.55);
  await tick();
  const h = await a.load(bytes, fileName);
  const ex = await a.extract(h);
  check();

  opts.onStage?.("scan", 0.8);
  await tick();
  const findings = await a.scan(h, opts);
  check();

  const realKind = (ex.origin.kind ?? kind) as DocKind;
  const analysis: AnalysisResult = {
    kind: realKind,
    mime: kind === "image" ? imageMime(bytes) : mimeOf[realKind],
    metadata: ex.metadata,
    xmpRaw: ex.xmpRaw,
    findings: sortFindings(findings),
    securityState: securityStateOf(findings),
    origin: evaluateOrigin(ex.origin),
    structure: ex.structure,
    title: ex.title,
    author: ex.author,
    created: ex.created,
    modified: ex.modified,
  };
  opts.onStage?.("done", 1);
  return { hash, bytes, analysis };
}

const SEV_ORDER = { crítico: 0, alto: 1, médio: 2, info: 3 } as const;
export const sortFindings = <T extends { severity: keyof typeof SEV_ORDER }>(f: T[]) =>
  [...f].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

function imageMime(b: Uint8Array) {
  if (b[0] === 0xff) return "image/jpeg";
  if (b[0] === 0x89) return "image/png";
  return "image/heic";
}
