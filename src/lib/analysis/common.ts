import type { DocKind, Finding, SecurityState, DocStructure } from "@/types/domain";

export type AnalysisErrorCode =
  "too_large" | "unsupported" | "corrupt" | "encrypted" | "empty" | "cancelled";
export class AnalysisError extends Error {
  constructor(
    public code: AnalysisErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface OriginInput {
  kind: DocKind;
  author?: string | undefined;
  creator?: string | undefined;
  lastModifiedBy?: string | undefined;
  producer?: string | undefined;
  creatorTool?: string | undefined;
  application?: string | undefined;
  appVersion?: string | undefined;
  company?: string | undefined;
  template?: string | undefined;
  totalTime?: number | undefined;
  revision?: number | undefined;
  created?: string | undefined;
  modified?: string | undefined;
  utcDates?: boolean | undefined;
  hasEmbeddedMetadata: boolean;
  metadataCount: number;
  c2pa?: { present: boolean; ai: boolean; claim?: string | undefined } | undefined;
  digitalSourceType?: string | undefined;
  allText: string;
}

export interface Extracted {
  metadata: Record<string, string>;
  xmpRaw?: string | undefined;
  structure: DocStructure;
  title?: string | undefined;
  author?: string | undefined;
  created?: string | undefined;
  modified?: string | undefined;
  origin: OriginInput;
}

export interface Analyzer<H> {
  load(bytes: Uint8Array, fileName: string): Promise<H>;
  extract(h: H): Promise<Extracted>;
  scan(h: H, opts: ScanOptions): Promise<Finding[]>;
}
export interface ScanOptions {
  deepPdf: boolean;
  reportLinks: boolean;
}

export const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000)
    s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)));
  return s;
};

export function xmlUnescape(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
export function xmlEscape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Value of a simple XML element like <dc:creator>x</dc:creator>; handles rdf:li nesting and attribute form. */
export function xmlTag(xml: string, tag: string): string | undefined {
  const t = reEsc(tag);
  const el = xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`));
  if (el) {
    const inner = el[1] ?? "";
    const li = inner.match(/<rdf:li(?:\s[^>]*)?>([\s\S]*?)<\/rdf:li>/);
    const v = xmlUnescape((li ? (li[1] ?? "") : inner).replace(/<[^>]+>/g, "")).trim();
    return v || undefined;
  }
  const attr = xml.match(new RegExp(`\\s${t}="([^"]*)"`));
  return attr ? xmlUnescape(attr[1] ?? "").trim() || undefined : undefined;
}
export function setXmlTag(xml: string, tag: string, value: string, attrs = ""): string {
  const t = reEsc(tag);
  const re = new RegExp(`<${t}(\\s[^>]*)?(?:/>|>[\\s\\S]*?</${t}>)`);
  const node = (a?: string) => `<${tag}${a ?? attrs}>${xmlEscape(value)}</${tag}>`;
  if (re.test(xml)) return xml.replace(re, (_m, a) => node(a));
  return xml.replace(/<\/[A-Za-z:]+>\s*$/, (end) => node() + end);
}

export function securityStateOf(f: Finding[]): SecurityState {
  if (f.some((x) => x.severity === "crítico")) return "Perigoso";
  if (f.some((x) => x.severity === "alto" || x.severity === "médio")) return "Atenção";
  return "Seguro";
}

const EXT: Record<string, DocKind> = {
  pdf: "pdf",
  docx: "docx",
  docm: "docx",
  dotx: "docx",
  xlsx: "xlsx",
  xlsm: "xlsx",
  pptx: "pptx",
  pptm: "pptx",
  odt: "odt",
  jpg: "image",
  jpeg: "image",
  png: "image",
  heic: "image",
  heif: "image",
  txt: "text",
  md: "text",
  markdown: "text",
};
export const ACCEPT =
  ".pdf,.docx,.docm,.xlsx,.xlsm,.pptx,.pptm,.odt,.jpg,.jpeg,.png,.heic,.heif,.txt,.md";

export function detectKind(name: string, head: Uint8Array): DocKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const sig = latin1(head.subarray(0, 16));
  if (sig.includes("%PDF")) return "pdf";
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0)
    throw new AnalysisError(
      "encrypted",
      "Ficheiro Office encriptado com palavra-passe ou formato antigo (.doc/.xls) — não é possível ler os metadados.",
    );
  if (head[0] === 0xff && head[1] === 0xd8) return "image";
  if (sig.startsWith("\x89PNG")) return "image";
  if (sig.slice(4, 8) === "ftyp" && /hei|mif|heix/.test(sig.slice(8, 12))) return "image";
  const k = EXT[ext];
  if (!k)
    throw new AnalysisError(
      "unsupported",
      `Tipo de ficheiro não suportado (.${ext || "?"}). Aceitamos PDF, Office, ODT, imagens e texto.`,
    );
  if (k === "pdf")
    throw new AnalysisError(
      "corrupt",
      "PDF corrompido: o ficheiro não começa com um cabeçalho PDF válido.",
    );
  if (["docx", "xlsx", "pptx", "odt"].includes(k) && !sig.startsWith("PK"))
    throw new AnalysisError(
      "corrupt",
      "Documento corrompido: o contentor ZIP do ficheiro não é válido.",
    );
  return k;
}

export const mimeOf: Record<DocKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  image: "image/*",
  text: "text/plain",
};

export const URL_RE = /https?:\/\/[^\s<>"'()\\\]]{4,200}/g;
export function uniq<T>(a: T[]) {
  return Array.from(new Set(a));
}
