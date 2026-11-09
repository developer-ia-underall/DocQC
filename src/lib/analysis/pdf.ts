import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFString, PDFHexString } from "pdf-lib";
import type { Finding, Severity } from "@/types/domain";
import { type Analyzer, AnalysisError, latin1, xmlTag, URL_RE, uniq } from "./common";
import { parsePdfDate } from "@/lib/dates";

export interface PdfHandle {
  bytes: Uint8Array;
  raw: string;
  doc: PDFDocument;
}

/** Decode #xx escapes in PDF names (e.g. /J#61vaScript) so obfuscated keys are still detected. */
export const decodeNames = (s: string) =>
  s.replace(/\/[A-Za-z0-9#]*#[0-9A-Fa-f]{2}[A-Za-z0-9#]*/g, (n) =>
    n.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
  );

function str(v: unknown): string | undefined {
  if (v instanceof PDFString || v instanceof PDFHexString)
    return v.decodeText().trim() || undefined;
  return undefined;
}

/** Data-driven PDF active-content catalogue. */
export const PDF_KEYS: {
  key: string;
  id: string;
  severity: Severity;
  title: string;
  explanation: string;
}[] = [
  {
    key: "JavaScript",
    id: "pdf.javascript",
    severity: "crítico",
    title: "JavaScript incorporado",
    explanation:
      "O PDF contém código JavaScript. Leitores compatíveis (Acrobat, Foxit) podem executá-lo ao abrir ou ao interagir, por exemplo para contactar servidores ou explorar vulnerabilidades.",
  },
  {
    key: "JS",
    id: "pdf.js",
    severity: "crítico",
    title: "Ação de script (/JS)",
    explanation:
      "Existe uma ação de script que pode ser executada automaticamente pelo leitor de PDF.",
  },
  {
    key: "Launch",
    id: "pdf.launch",
    severity: "crítico",
    title: "Ação de execução (/Launch)",
    explanation:
      "O PDF pode pedir ao sistema para abrir um programa ou ficheiro externo — técnica usada para executar malware.",
  },
  {
    key: "OpenAction",
    id: "pdf.openaction",
    severity: "alto",
    title: "Ação automática ao abrir (/OpenAction)",
    explanation:
      "Há uma ação que corre assim que o documento é aberto, sem qualquer clique do leitor.",
  },
  {
    key: "AA",
    id: "pdf.aa",
    severity: "alto",
    title: "Ações adicionais (/AA)",
    explanation:
      "Ações disparadas por eventos (abrir página, fechar, passar o rato). Podem contactar servidores sem o leitor perceber.",
  },
  {
    key: "SubmitForm",
    id: "pdf.submitform",
    severity: "alto",
    title: "Envio de formulário (/SubmitForm)",
    explanation: "O PDF pode enviar dados do formulário para um servidor remoto.",
  },
  {
    key: "GoToR",
    id: "pdf.gotor",
    severity: "alto",
    title: "Referência a documento remoto (/GoToR)",
    explanation:
      "O PDF aponta para outro documento externo, que o leitor pode tentar abrir — pode revelar o seu IP ou credenciais de rede (SMB).",
  },
  {
    key: "ImportData",
    id: "pdf.importdata",
    severity: "alto",
    title: "Importação de dados (/ImportData)",
    explanation: "O documento pode importar dados de um ficheiro externo.",
  },
  {
    key: "RichMedia",
    id: "pdf.richmedia",
    severity: "alto",
    title: "Conteúdo multimédia ativo (/RichMedia)",
    explanation:
      "Conteúdo Flash/multimédia incorporado, historicamente usado para explorar leitores de PDF.",
  },
  {
    key: "EmbeddedFile",
    id: "pdf.embeddedfile",
    severity: "médio",
    title: "Ficheiro incorporado",
    explanation:
      "O PDF transporta outro ficheiro no seu interior. Não é executado sozinho, mas pode ser um executável ou documento malicioso.",
  },
  {
    key: "XFA",
    id: "pdf.xfa",
    severity: "médio",
    title: "Formulário XFA",
    explanation: "Formulários XFA são dinâmicos e podem conter scripts e ligações de dados.",
  },
  {
    key: "AcroForm",
    id: "pdf.acroform",
    severity: "info",
    title: "Formulário interativo",
    explanation: "O documento tem campos de formulário. Normalmente inofensivo.",
  },
];

const has = (txt: string, key: string) => new RegExp(`/${key}(?![A-Za-z0-9])`).test(txt);

export function scanPdfText(txt: string, reportLinks: boolean): Finding[] {
  const t = decodeNames(txt);
  const out: Finding[] = [];
  for (const k of PDF_KEYS)
    if (has(t, k.key))
      out.push({ id: k.id, severity: k.severity, title: k.title, explanation: k.explanation });
  const auto = has(t, "OpenAction") || has(t, "AA");
  const uriActions = uniq(
    Array.from(t.matchAll(/\/URI\s*\(([^)]{4,300})\)/g)).map((m) => (m[1] ?? "").trim()),
  );
  const autoUri = uniq(
    Array.from(t.matchAll(/\/OpenAction[\s\S]{0,200}?\/URI\s*\(([^)]+)\)/g)).map((m) =>
      (m[1] ?? "").trim(),
    ),
  );
  for (const u of uriActions) {
    const isAuto = autoUri.includes(u);
    if (isAuto)
      out.push({
        id: "pdf.uri.auto",
        severity: "crítico",
        title: "Contacto remoto ao abrir",
        explanation: `Ao abrir, o PDF tenta contactar ${u} — pode revelar o seu IP e a hora de abertura ao remetente.`,
        detail: u,
      });
    else if (reportLinks || auto)
      out.push({
        id: "pdf.uri",
        severity: auto ? "médio" : "info",
        title: "Ligação externa (/URI)",
        explanation: `Contém uma ligação para ${u}. Só contacta o servidor se clicar${auto ? ", mas o documento também tem ações automáticas" : ""}.`,
        detail: u,
      });
  }
  const imgs = uniq(
    (t.match(URL_RE) ?? []).filter((u) => /\.(png|jpe?g|gif|svg|webp)(\?|$)/i.test(u)),
  );
  for (const u of imgs)
    out.push({
      id: "pdf.remote-image",
      severity: "alto",
      title: "Imagem remota",
      explanation: `O documento referencia uma imagem alojada em ${u}. Ao carregá-la, o leitor contacta o servidor (tracking pixel).`,
      detail: u,
    });
  if (reportLinks) {
    const others = uniq(
      (t.match(URL_RE) ?? []).filter(
        (u) =>
          !uriActions.includes(u) &&
          !imgs.includes(u) &&
          !/ns\.adobe\.com|w3\.org|purl\.org|iptc\.org|aiim\.org|reportlab\.com|npes\.org/.test(u),
      ),
    );
    for (const u of others.slice(0, 10))
      out.push({
        id: "pdf.url",
        severity: "info",
        title: "Endereço externo no conteúdo",
        explanation: `O endereço ${u} aparece no ficheiro. Por si só não é contactado ao abrir.`,
        detail: u,
      });
  }
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = f.id + (f.detail ?? "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const pdfAnalyzer: Analyzer<PdfHandle> = {
  async load(bytes) {
    const raw = latin1(bytes);
    if (!raw.slice(0, 1024).includes("%PDF"))
      throw new AnalysisError("corrupt", "PDF corrompido: cabeçalho em falta.");
    if (/\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(raw))
      throw new AnalysisError(
        "encrypted",
        "PDF encriptado: remova a palavra-passe antes de analisar.",
      );
    try {
      const doc = await PDFDocument.load(bytes, {
        updateMetadata: false,
        throwOnInvalidObject: false,
      });
      return { bytes, raw, doc };
    } catch (e) {
      throw new AnalysisError(
        "corrupt",
        `PDF corrompido ou ilegível (${(e as Error).message.slice(0, 80)}).`,
      );
    }
  },
  async extract({ doc, raw }) {
    const md: Record<string, string> = {};
    const infoRef = doc.context.trailerInfo.Info;
    const info = infoRef ? doc.context.lookup(infoRef) : undefined;
    let rawCreated: string | undefined, rawModified: string | undefined;
    if (info instanceof PDFDict) {
      for (const [k, v] of info.entries()) {
        const s = str(v) ?? (v instanceof PDFName ? v.decodeText() : undefined);
        if (s) md[`Info.${k.decodeText()}`] = s;
      }
      rawCreated = md["Info.CreationDate"];
      rawModified = md["Info.ModDate"];
    }
    let xmpRaw: string | undefined;
    const meta = doc.catalog.lookup(PDFName.of("Metadata"));
    if (meta instanceof PDFRawStream) {
      const s = new TextDecoder().decode(meta.contents);
      if (s.includes("xmpmeta")) xmpRaw = s;
    }
    if (!xmpRaw) {
      const m = raw.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/);
      if (m) xmpRaw = m[0];
    }
    if (xmpRaw) {
      for (const tag of [
        "xmp:CreatorTool",
        "pdf:Producer",
        "dc:creator",
        "dc:title",
        "xmp:CreateDate",
        "xmp:ModifyDate",
        "xmp:MetadataDate",
        "pdf:Keywords",
        "xmpMM:DocumentID",
      ]) {
        const v = xmlTag(xmpRaw, tag);
        if (v) md[`XMP.${tag}`] = v;
      }
    }
    const pc = parsePdfDate(rawCreated),
      pm = parsePdfDate(rawModified);
    const fonts = uniq(
      Array.from(raw.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-,_]+)/g)).map((m) =>
        (m[1] ?? "")
          .replace(/^[A-Z]{6}\+/, "")
          .replace(/[-,](Bold|Italic|Regular|BoldItalic|Oblique)$/i, ""),
      ),
    ).slice(0, 12);
    md["Estrutura.Páginas"] = String(doc.getPageCount());
    md["Estrutura.Versão PDF"] = raw.match(/%PDF-(\d\.\d)/)?.[1] ?? "?";
    const outline: string[] = Array.from(raw.matchAll(/\/Title\s*\(([^)]{2,80})\)/g))
      .map((m) => m[1] ?? "")
      .filter((t) => t !== md["Info.Title"])
      .slice(0, 20);
    const author = md["Info.Author"] ?? md["XMP.dc:creator"];
    const n = Object.keys(md).filter((k) => !k.startsWith("Estrutura")).length;
    return {
      metadata: md,
      xmpRaw,
      structure: { pages: doc.getPageCount(), sections: uniq(outline), fonts },
      title: md["Info.Title"] ?? md["XMP.dc:title"],
      author,
      created: pc.iso,
      modified: pm.iso,
      origin: {
        kind: "pdf",
        author,
        creator: md["Info.Creator"],
        producer: md["Info.Producer"] ?? md["XMP.pdf:Producer"],
        creatorTool: md["XMP.xmp:CreatorTool"],
        created: pc.iso,
        modified: pm.iso,
        utcDates: !!rawCreated && pc.utc,
        hasEmbeddedMetadata: n > 0,
        metadataCount: n,
        allText: Object.values(md).join("\n"),
      },
    };
  },
  async scan(h, opts) {
    let text = h.raw;
    if (opts.deepPdf) {
      // Objects stored inside compressed object streams are parsed by pdf-lib; serialise their dictionaries too.
      const parts: string[] = [];
      for (const [, obj] of h.doc.context.enumerateIndirectObjects()) {
        const d = obj instanceof PDFDict ? obj : obj instanceof PDFRawStream ? obj.dict : undefined;
        if (d)
          try {
            parts.push(d.toString());
          } catch {
            /* ignore */
          }
      }
      text += "\n" + parts.join("\n");
    }
    return scanPdfText(text, opts.reportLinks);
  },
};
