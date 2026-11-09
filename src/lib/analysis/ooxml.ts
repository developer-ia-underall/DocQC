import JSZip from "jszip";
import type { DocKind, Finding } from "@/types/domain";
import { type Analyzer, AnalysisError, xmlTag, xmlUnescape, uniq } from "./common";

export interface ZipHandle {
  zip: JSZip;
  kind: DocKind;
  files: string[];
}

async function text(zip: JSZip, path: string) {
  const f = zip.file(path);
  return f ? f.async("string") : undefined;
}

export const zipLoad = async (bytes: Uint8Array, kind: DocKind): Promise<ZipHandle> => {
  try {
    const zip = await JSZip.loadAsync(bytes);
    return { zip, kind, files: Object.keys(zip.files) };
  } catch {
    throw new AnalysisError(
      "corrupt",
      "Documento corrompido: não foi possível abrir o contentor ZIP.",
    );
  }
};

const REL_SEVERITY: {
  re: RegExp;
  severity: Finding["severity"];
  title: string;
  explain: (t: string) => string;
}[] = [
  {
    re: /attachedTemplate/,
    severity: "crítico",
    title: "Modelo remoto (remote template)",
    explain: (t) =>
      `Ao abrir, o Office descarrega o modelo de ${t}. Técnica comum para carregar macros maliciosas e confirmar que o documento foi aberto.`,
  },
  {
    re: /oleObject|frame|subDocument/,
    severity: "alto",
    title: "Objeto externo ligado",
    explain: (t) =>
      `O documento carrega conteúdo de ${t} ao abrir ou atualizar ligações — pode revelar o seu IP.`,
  },
  {
    re: /image/,
    severity: "alto",
    title: "Imagem remota (tracking pixel)",
    explain: (t) =>
      `Ao abrir, o Office tenta descarregar uma imagem de ${t}. O remetente fica a saber quando e de onde o ficheiro foi aberto.`,
  },
  {
    re: /externalLinkPath|externalLink/,
    severity: "alto",
    title: "Livro externo ligado",
    explain: (t) =>
      `A folha de cálculo referencia dados em ${t}. Ao atualizar ligações, o Excel contacta essa origem.`,
  },
  {
    re: /hyperlink/,
    severity: "info",
    title: "Hiperligação",
    explain: (t) => `Ligação clicável para ${t}. Só é contactada se clicar.`,
  },
];

const num = (v: string | undefined) => (v !== undefined ? parseInt(v) : undefined);

export const ooxmlAnalyzer: Analyzer<ZipHandle> = {
  load: async (b, name) => {
    const n = name.toLowerCase();
    return zipLoad(b, /\.xls[xm]$/.test(n) ? "xlsx" : /\.ppt[xm]$/.test(n) ? "pptx" : "docx");
  },
  async extract(h) {
    const { zip } = h;
    const ct = (await text(zip, "[Content_Types].xml")) ?? "";
    if (ct.includes("spreadsheetml")) h.kind = "xlsx";
    else if (ct.includes("presentationml")) h.kind = "pptx";
    else if (ct.includes("wordprocessingml")) h.kind = "docx";
    const core = (await text(zip, "docProps/core.xml")) ?? "";
    const app = (await text(zip, "docProps/app.xml")) ?? "";
    const md: Record<string, string> = {};
    for (const t of [
      "dc:title",
      "dc:subject",
      "dc:creator",
      "cp:keywords",
      "dc:description",
      "cp:lastModifiedBy",
      "cp:revision",
      "dcterms:created",
      "dcterms:modified",
      "cp:category",
      "cp:lastPrinted",
    ]) {
      const v = xmlTag(core, t);
      if (v) md[`core.${t}`] = v;
    }
    for (const t of [
      "Application",
      "AppVersion",
      "Company",
      "Manager",
      "Template",
      "TotalTime",
      "Pages",
      "Words",
      "Slides",
      "DocSecurity",
    ]) {
      const v = xmlTag(app, t);
      if (v) md[`app.${t}`] = v;
    }
    const sections: string[] = [];
    const fonts: string[] = [];
    let words: number | undefined;
    let pages: number | undefined;
    if (h.kind === "docx") {
      const doc = (await text(zip, "word/document.xml")) ?? "";
      for (const p of doc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
        if (
          /<w:pStyle w:val="(Heading|Titulo|Título|Ttulo|Title|Cabealho|Cabeçalho)\d*"/i.test(p)
        ) {
          const t = xmlUnescape(
            (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
              .map((x) => x.replace(/<[^>]+>/g, ""))
              .join(""),
          ).trim();
          if (t) sections.push(t);
        }
      }
      const fx = ((await text(zip, "word/fontTable.xml")) ?? "") + doc;
      fonts.push(...Array.from(fx.matchAll(/w:(?:name|ascii)="([^"]+)"/g)).map((m) => m[1] ?? ""));
      words = (doc.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .split(/\s+/)
        .filter(Boolean).length;
      pages = num(md["app.Pages"]);
    } else if (h.kind === "xlsx") {
      const wb = (await text(zip, "xl/workbook.xml")) ?? "";
      sections.push(
        ...Array.from(wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)).map((m) =>
          xmlUnescape(m[1] ?? ""),
        ),
      );
      pages = sections.length;
    } else {
      pages = h.files.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
      for (let i = 1; i <= Math.min(pages, 30); i++) {
        const s = (await text(zip, `ppt/slides/slide${i}.xml`)) ?? "";
        const t = s.match(/type="(?:title|ctrTitle)"[\s\S]*?<a:t>([^<]+)<\/a:t>/);
        if (t) sections.push(xmlUnescape(t[1] ?? ""));
      }
    }
    md["Estrutura.Partes no pacote"] = String(h.files.length);
    const n = Object.keys(md).length - 1;
    // Custom properties and customXml parts often leak the generating environment (paths, user names).
    let hidden = "";
    for (const f of h.files
      .filter((x) => x === "docProps/custom.xml" || /^customXml\/item\d+\.xml$/.test(x))
      .slice(0, 10))
      hidden += "\n" + ((await text(zip, f)) ?? "").slice(0, 20000);
    return {
      metadata: md,
      structure: {
        pages,
        sections: uniq(sections).slice(0, 40),
        fonts: uniq(fonts).slice(0, 12),
        words,
      },
      title: md["core.dc:title"],
      author: md["core.dc:creator"],
      created: md["core.dcterms:created"],
      modified: md["core.dcterms:modified"],
      origin: {
        kind: h.kind,
        author: md["core.dc:creator"],
        creator: md["core.dc:creator"],
        lastModifiedBy: md["core.cp:lastModifiedBy"],
        application: md["app.Application"],
        appVersion: md["app.AppVersion"],
        company: md["app.Company"],
        template: md["app.Template"],
        totalTime: num(md["app.TotalTime"]),
        revision: num(md["core.cp:revision"]),
        created: md["core.dcterms:created"],
        modified: md["core.dcterms:modified"],
        hasEmbeddedMetadata: !!(core || app),
        metadataCount: n,
        allText: Object.values(md).join("\n") + hidden,
      },
    };
  },
  async scan(h, opts) {
    const out: Finding[] = [];
    const { files, zip } = h;
    const vba = files.filter((f) => /vbaProject\.bin$/i.test(f));
    if (vba.length)
      out.push({
        id: "ooxml.macro",
        severity: "crítico",
        title: "Macros VBA",
        explanation:
          "O documento contém macros. Se o utilizador as ativar, podem executar qualquer ação no computador (descarregar malware, enviar ficheiros).",
        detail: vba.join(", "),
      });
    const ole = files.filter((f) => /\/embeddings\/.*(oleObject|\.bin$)/i.test(f));
    if (ole.length)
      out.push({
        id: "ooxml.ole",
        severity: "alto",
        title: "Objetos OLE incorporados",
        explanation:
          "Contém objetos OLE (ex.: pacotes, executáveis ou outros documentos) que podem ser abertos com duplo clique.",
        detail: ole.join(", "),
      });
    if (files.some((f) => /activeX/i.test(f)))
      out.push({
        id: "ooxml.activex",
        severity: "alto",
        title: "Controlos ActiveX",
        explanation:
          "Controlos ActiveX podem executar código quando o documento é aberto em modo de edição.",
      });
    const cx = files.filter((f) => /^customXml\/item\d+\.xml$/.test(f));
    if (cx.length)
      out.push({
        id: "ooxml.customxml",
        severity: "info",
        title: "Dados XML personalizados",
        explanation: `Existem ${cx.length} partes customXml (normalmente de SharePoint ou modelos corporativos). Podem conter identificadores internos.`,
      });
    for (const rel of files.filter((f) => f.endsWith(".rels"))) {
      const x = (await text(zip, rel)) ?? "";
      for (const m of x.matchAll(/<Relationship\s[^>]*>/g)) {
        const tag = m[0];
        if (!/TargetMode="External"/.test(tag)) continue;
        const target = xmlUnescape(tag.match(/Target="([^"]*)"/)?.[1] ?? "");
        const type = tag.match(/Type="([^"]*)"/)?.[1] ?? "";
        const r = REL_SEVERITY.find((s) => s.re.test(type)) ?? {
          severity: "médio" as const,
          title: "Relação externa",
          explain: (t: string) => `O pacote referencia um recurso externo em ${t}.`,
        };
        if (r.severity === "info" && !opts.reportLinks) continue;
        out.push({
          id: `ooxml.external.${type.split("/").pop()}`,
          severity: r.severity,
          title: r.title,
          explanation: r.explain(target),
          detail: `${rel} → ${target}`,
        });
      }
    }
    if (h.kind === "docx") {
      const doc = (await text(zip, "word/document.xml")) ?? "";
      if (
        /<w:instrText[^>]*>\s*DDE(AUTO)?\b/i.test(doc) ||
        /<w:fldSimple[^>]*w:instr="\s*DDE/i.test(doc)
      )
        out.push({
          id: "ooxml.dde",
          severity: "crítico",
          title: "Campo DDE",
          explanation:
            "Campo DDE pode executar comandos no sistema quando o utilizador aceita atualizar ligações.",
        });
    }
    return out;
  },
};

/** OpenDocument (ODT) */
export const odtAnalyzer: Analyzer<ZipHandle> = {
  load: (b) => zipLoad(b, "odt"),
  async extract(h) {
    const meta = (await text(h.zip, "meta.xml")) ?? "";
    const content = (await text(h.zip, "content.xml")) ?? "";
    const md: Record<string, string> = {};
    for (const t of [
      "dc:title",
      "dc:creator",
      "meta:initial-creator",
      "meta:generator",
      "meta:creation-date",
      "dc:date",
      "meta:editing-duration",
      "meta:editing-cycles",
    ]) {
      const v = xmlTag(meta, t);
      if (v) md[`meta.${t}`] = v;
    }
    const sections = Array.from(content.matchAll(/<text:h[^>]*>([\s\S]*?)<\/text:h>/g))
      .map((m) => xmlUnescape((m[1] ?? "").replace(/<[^>]+>/g, "")).trim())
      .filter(Boolean);
    const fonts = Array.from(content.matchAll(/style:font-face style:name="([^"]+)"/g)).map(
      (m) => m[1] ?? "",
    );
    const dur = md["meta.meta:editing-duration"];
    const mins = dur
      ? (() => {
          const m = dur.match(/P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
          return m ? +(m[1] ?? 0) * 60 + +(m[2] ?? 0) : undefined;
        })()
      : undefined;
    const cycles = md["meta.meta:editing-cycles"];
    const n = Object.keys(md).length;
    return {
      metadata: md,
      structure: { sections: uniq(sections).slice(0, 40), fonts: uniq(fonts) },
      title: md["meta.dc:title"],
      author: md["meta.dc:creator"] ?? md["meta.meta:initial-creator"],
      created: md["meta.meta:creation-date"],
      modified: md["meta.dc:date"],
      origin: {
        kind: "odt",
        author: md["meta.meta:initial-creator"],
        creator: md["meta.meta:initial-creator"],
        lastModifiedBy: md["meta.dc:creator"],
        application: md["meta.meta:generator"],
        totalTime: mins,
        revision: cycles ? +cycles : undefined,
        created: md["meta.meta:creation-date"],
        modified: md["meta.dc:date"],
        hasEmbeddedMetadata: !!meta,
        metadataCount: n,
        allText: Object.values(md).join("\n"),
      },
    };
  },
  async scan(h, opts) {
    const out: Finding[] = [];
    if (h.files.some((f) => /^Basic\/|^Scripts\//.test(f)))
      out.push({
        id: "odt.macro",
        severity: "crítico",
        title: "Macros / scripts",
        explanation:
          "O documento inclui macros Basic ou scripts que podem ser executados ao abrir, se permitidos.",
      });
    const content = (await text(h.zip, "content.xml")) ?? "";
    if (/<office:event-listeners/.test(content))
      out.push({
        id: "odt.events",
        severity: "alto",
        title: "Eventos automáticos",
        explanation:
          "Há eventos ligados a ações do documento (ex.: ao abrir) que podem disparar macros.",
      });
    for (const m of content.matchAll(/xlink:href="(https?:[^"]+)"/g)) {
      const url = m[1] ?? "";
      const isImg = /<draw:image[^>]*$/.test(
        content.slice(Math.max(0, (m.index ?? 0) - 200), m.index),
      );
      if (isImg)
        out.push({
          id: "odt.remote-image",
          severity: "alto",
          title: "Imagem remota",
          explanation: `Ao abrir, o processador tenta descarregar ${url} — pode revelar o seu IP.`,
          detail: url,
        });
      else if (opts.reportLinks)
        out.push({
          id: "odt.link",
          severity: "info",
          title: "Hiperligação",
          explanation: `Ligação para ${url}. Só é contactada se clicar.`,
          detail: url,
        });
    }
    return out;
  },
};
