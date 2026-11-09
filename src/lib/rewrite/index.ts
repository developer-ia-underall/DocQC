import JSZip from "jszip";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  PDFHexString,
} from "pdf-lib";
import type { DocKind, IdentityProfile, RewriteOptions } from "@/types/domain";
import { AnalysisError, setXmlTag, xmlEscape, xmlTag } from "@/lib/analysis/common";
import { isoUtcSeconds, isoWithOffset, parseApp, pdfDate } from "@/lib/dates";

export interface RewriteInput {
  bytes: Uint8Array;
  fileName: string;
  kind: DocKind;
  title?: string | undefined;
  created?: string | undefined;
  profile: IdentityProfile;
  options: RewriteOptions;
}

export interface RewriteOutput {
  bytes: Uint8Array;
  fileName: string;
  mime: string;
  changes: string[];
}

export function outputName(fileName: string, suffix: string, newExt?: string) {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = newExt ?? (dot > 0 ? fileName.slice(dot + 1) : "");
  const s = suffix.trim();
  return `${base}${s ? (s.startsWith("_") || s.startsWith("-") ? s : `_${s}`) : ""}${ext ? `.${ext}` : ""}`;
}

export async function rewriteDocument(input: RewriteInput): Promise<RewriteOutput> {
  switch (input.kind) {
    case "pdf":
      return rewritePdf(input);
    case "docx":
    case "xlsx":
    case "pptx":
      return rewriteOoxml(input);
    case "odt":
      return rewriteOdt(input);
    case "image":
      return rewriteImage(input);
    case "text":
      return {
        bytes: input.bytes,
        fileName: outputName(input.fileName, input.options.suffix),
        mime: "text/plain",
        changes: ["Ficheiros de texto não têm metadados incorporados: entregue sem alterações."],
      };
  }
}

/* ----------------------------------------------------------------------------------------------
 * Dates: keep the original creation date when it exists, unless "normalizar" is on. Normalising
 * expresses dates in the profile's timezone (instead of UTC +00:00, a common sandbox signal) and
 * guarantees modified > created.
 * -------------------------------------------------------------------------------------------- */
function datesFor(input: RewriteInput) {
  const now = new Date();
  const orig = input.created ? new Date(input.created) : undefined;
  const validOrig = orig && !isNaN(orig.getTime()) && orig < now ? orig : undefined;
  const created =
    input.options.normalizeDates || !validOrig
      ? (validOrig ?? new Date(now.getTime() - 47 * 60000))
      : validOrig;
  return { created, modified: now };
}

/* -------------------------------------------- PDF -------------------------------------------- */

const ACTIVE_ACTIONS = new Set([
  "JavaScript",
  "Launch",
  "SubmitForm",
  "ImportData",
  "GoToR",
  "RichMediaExecute",
  "GoToE",
]);
const ACTIVE_KEYS = ["OpenAction", "AA", "JavaScript", "JS", "RichMedia", "XFA"];

function nameOf(d: PDFDict, key: string) {
  const v = d.get(PDFName.of(key));
  return v instanceof PDFName ? v.decodeText() : undefined;
}

async function rewritePdf(input: RewriteInput): Promise<RewriteOutput> {
  const { profile, options } = input;
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input.bytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    throw new AnalysisError(
      "corrupt",
      `Não foi possível reescrever o PDF (${(e as Error).message.slice(0, 80)}).`,
    );
  }
  const changes: string[] = [];
  const ctx = doc.context;

  if (options.removeActive || options.removeExternal) {
    let neutered = 0,
      removedFiles = 0,
      removedLinks = 0;
    const toDelete: PDFRef[] = [];
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      const d = obj instanceof PDFDict ? obj : obj instanceof PDFRawStream ? obj.dict : undefined;
      if (!d) continue;
      if (options.removeActive) {
        if (nameOf(d, "Type") === "EmbeddedFile") {
          toDelete.push(ref);
          removedFiles++;
          continue;
        }
        const s = nameOf(d, "S");
        if (s && ACTIVE_ACTIONS.has(s)) {
          for (const k of d.keys()) d.delete(k);
          d.set(PDFName.of("S"), PDFName.of("Named"));
          d.set(PDFName.of("N"), PDFName.of("NextPage"));
          neutered++;
          continue;
        }
        for (const k of ACTIVE_KEYS)
          if (d.has(PDFName.of(k))) {
            d.delete(PDFName.of(k));
            neutered++;
          }
        if (d.has(PDFName.of("EF"))) {
          d.delete(PDFName.of("EF"));
        }
        const names = d.get(PDFName.of("Names"));
        const nd = names instanceof PDFRef ? ctx.lookup(names) : names;
        if (nd instanceof PDFDict) {
          for (const k of ["JavaScript", "EmbeddedFiles"])
            if (nd.has(PDFName.of(k))) {
              nd.delete(PDFName.of(k));
              neutered++;
            }
        }
        if (nameOf(d, "Subtype") === "FileAttachment" || nameOf(d, "Subtype") === "RichMedia") {
          d.delete(PDFName.of("FS"));
          d.delete(PDFName.of("RichMediaContent"));
          neutered++;
        }
      }
      if (options.removeExternal && nameOf(d, "S") === "URI") {
        d.delete(PDFName.of("URI"));
        d.set(PDFName.of("S"), PDFName.of("Named"));
        d.set(PDFName.of("N"), PDFName.of("NextPage"));
        removedLinks++;
      }
    }
    for (const r of toDelete) ctx.delete(r);
    if (neutered)
      changes.push(
        `Removidas ${neutered} entradas de conteúdo ativo (JavaScript, ações automáticas).`,
      );
    if (removedFiles) changes.push(`Removidos ${removedFiles} ficheiros incorporados.`);
    if (removedLinks) changes.push(`Desativadas ${removedLinks} ligações externas (/URI).`);
  }

  const { created, modified } = datesFor(input);
  const tz = profile.timezone || "Africa/Luanda";
  // Ensure the Info dictionary exists, then write raw values (pdf-lib's date setters force UTC "Z").
  doc.setTitle(input.title ?? doc.getTitle() ?? "", { showInWindowTitleBar: false });
  const infoRef = ctx.trailerInfo.Info;
  const info = infoRef ? ctx.lookup(infoRef) : undefined;
  if (info instanceof PDFDict) {
    const set = (k: string, v: string) => info.set(PDFName.of(k), PDFHexString.fromText(v));
    set("Author", profile.fullName);
    set("Creator", profile.application);
    set("Producer", profile.application);
    info.set(PDFName.of("CreationDate"), PDFString.of(pdfDate(created, tz)));
    info.set(PDFName.of("ModDate"), PDFString.of(pdfDate(modified, tz)));
    if (profile.company) set("Company", profile.company);
    if (!input.title) info.delete(PDFName.of("Title"));
  }
  changes.push(`Autor → ${profile.fullName}; Creator/Producer → ${profile.application}`);

  // Replace XMP so it agrees with the Info dictionary (a mismatch is itself a tell).
  const oldMeta = doc.catalog.get(PDFName.of("Metadata"));
  const oldXmp = (() => {
    const s = oldMeta instanceof PDFRef ? ctx.lookup(oldMeta) : undefined;
    return s instanceof PDFRawStream ? new TextDecoder().decode(s.contents) : undefined;
  })();
  const docId = (oldXmp && xmlTag(oldXmp, "xmpMM:DocumentID")) || `uuid:${crypto.randomUUID()}`;
  const xmp = buildXmp({
    title: input.title,
    author: profile.fullName,
    tool: profile.application,
    created: isoWithOffset(created, tz),
    modified: isoWithOffset(modified, tz),
    docId,
  });
  // XMP must be UTF-8; pdf-lib's string overload truncates non-Latin1 characters.
  const stream = ctx.stream(new TextEncoder().encode(xmp), { Type: "Metadata", Subtype: "XML" });
  const ref = ctx.register(stream);
  doc.catalog.set(PDFName.of("Metadata"), ref);
  if (oldMeta instanceof PDFRef) ctx.delete(oldMeta);
  changes.push(`Datas no fuso ${tz}; XMP regenerado e coerente com o dicionário Info.`);

  // Clean leftover PieceInfo (e.g. app-private data from the generating tool).
  for (const p of doc.getPages()) p.node.delete(PDFName.of("PieceInfo"));
  doc.catalog.delete(PDFName.of("PieceInfo"));
  const annotsCheck = (a: unknown) => a instanceof PDFArray;
  void annotsCheck;

  const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return {
    bytes: out,
    fileName: outputName(input.fileName, options.suffix),
    mime: "application/pdf",
    changes,
  };
}

function buildXmp(m: {
  title?: string | undefined;
  author: string;
  tool: string;
  created: string;
  modified: string;
  docId: string;
}) {
  const e = xmlEscape;
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">
   <dc:format>application/pdf</dc:format>
   ${m.title ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${e(m.title)}</rdf:li></rdf:Alt></dc:title>` : ""}
   <dc:creator><rdf:Seq><rdf:li>${e(m.author)}</rdf:li></rdf:Seq></dc:creator>
   <xmp:CreatorTool>${e(m.tool)}</xmp:CreatorTool>
   <xmp:CreateDate>${m.created}</xmp:CreateDate>
   <xmp:ModifyDate>${m.modified}</xmp:ModifyDate>
   <xmp:MetadataDate>${m.modified}</xmp:MetadataDate>
   <pdf:Producer>${e(m.tool)}</pdf:Producer>
   <xmpMM:DocumentID>${e(m.docId)}</xmpMM:DocumentID>
   <xmpMM:InstanceID>uuid:${crypto.randomUUID()}</xmpMM:InstanceID>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/* ------------------------------------------- OOXML ------------------------------------------- */

const SANDBOX_PATH_RE =
  /(?:\/mnt\/data|\/home\/oai|\/home\/user|\/home\/sandbox|\/workspace|\/content\/drive|\/tmp)(?:\/[^\s<>"']*)?/g;

const OFFICE_APP: Record<"docx" | "xlsx" | "pptx", string> = {
  docx: "Microsoft Office Word",
  xlsx: "Microsoft Excel",
  pptx: "Microsoft Office PowerPoint",
};

/** Office stores AppVersion as "16.0000"; derive it from the profile's application string. */
function officeApp(kind: "docx" | "xlsx" | "pptx", application: string) {
  const { name, version } = parseApp(application);
  const isMs = /microsoft|office|word|excel|powerpoint/i.test(name);
  const major = version.split(".")[0] || "16";
  return { app: isMs ? OFFICE_APP[kind] : name, version: `${major}.0000` };
}

const CORE_NS = `xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`;

async function rewriteOoxml(input: RewriteInput): Promise<RewriteOutput> {
  const kind = input.kind as "docx" | "xlsx" | "pptx";
  const { profile, options } = input;
  const zip = await JSZip.loadAsync(input.bytes);
  const changes: string[] = [];
  const { created, modified } = datesFor(input);
  const ct0 = (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
  let ct = ct0;
  let rootRels = (await zip.file("_rels/.rels")?.async("string")) ?? "";

  // core.xml
  let core =
    (await zip.file("docProps/core.xml")?.async("string")) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties ${CORE_NS}></cp:coreProperties>`;
  core = setXmlTag(core, "dc:creator", profile.fullName);
  core = setXmlTag(core, "cp:lastModifiedBy", profile.fullName);
  core = setXmlTag(core, "dcterms:created", isoUtcSeconds(created), ' xsi:type="dcterms:W3CDTF"');
  core = setXmlTag(core, "dcterms:modified", isoUtcSeconds(modified), ' xsi:type="dcterms:W3CDTF"');
  const rev = parseInt(xmlTag(core, "cp:revision") ?? "1");
  core = setXmlTag(core, "cp:revision", String(Math.max(2, rev + 1)));
  if (input.title) core = setXmlTag(core, "dc:title", input.title);
  zip.file("docProps/core.xml", core);
  if (!ct.includes("/docProps/core.xml"))
    ct = ct.replace(
      "</Types>",
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    );
  if (!rootRels.includes("docProps/core.xml"))
    rootRels = rootRels.replace(
      "</Relationships>",
      `<Relationship Id="rIdCore1" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    );
  changes.push(`Autor e última modificação → ${profile.fullName}.`);

  // app.xml
  const { app: appName, version } = officeApp(kind, profile.application);
  let app =
    (await zip.file("docProps/app.xml")?.async("string")) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>`;
  app = setXmlTag(app, "Application", appName);
  app = setXmlTag(app, "AppVersion", version);
  if (profile.company) app = setXmlTag(app, "Company", profile.company);
  if (kind === "docx" && !xmlTag(app, "Template")) app = setXmlTag(app, "Template", "Normal.dotm");
  zip.file("docProps/app.xml", app);
  if (!ct.includes("/docProps/app.xml"))
    ct = ct.replace(
      "</Types>",
      `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    );
  if (!rootRels.includes("docProps/app.xml"))
    rootRels = rootRels.replace(
      "</Relationships>",
      `<Relationship Id="rIdApp1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    );
  changes.push(
    `Aplicação → ${appName} ${version}${profile.company ? `; Empresa → ${profile.company}` : ""}.`,
  );

  let newExt: string | undefined;
  const files = Object.keys(zip.files);

  // Scrub execution-environment paths leaked into custom properties / customXml parts.
  let scrubbed = 0;
  for (const f of files.filter(
    (x) => x === "docProps/custom.xml" || /^customXml\/item\d+\.xml$/.test(x),
  )) {
    const x = await zip.file(f)!.async("string");
    const y = x.replace(SANDBOX_PATH_RE, () => (scrubbed++, ""));
    if (y !== x) zip.file(f, y);
  }
  if (scrubbed)
    changes.push(
      `Removidos ${scrubbed} caminhos de ambiente de execução em propriedades personalizadas.`,
    );

  if (options.removeActive) {
    const vba = files.filter((f) =>
      /vbaProject\.bin$|vbaData\.xml$|vbaProjectSignature\.bin$/i.test(f),
    );
    const activeX = files.filter((f) => /activeX\//i.test(f));
    for (const f of [...vba, ...activeX]) zip.remove(f);
    if (vba.length || activeX.length) {
      for (const rel of files.filter((f) => f.endsWith(".rels") && zip.file(f))) {
        const x = (await zip.file(rel)!.async("string")).replace(
          /<Relationship\s[^>]*(vbaProject|vbaData|activeX)[^>]*\/>/gi,
          "",
        );
        zip.file(rel, x);
      }
      ct = ct
        .replace(
          /<(Default|Override)\s[^>]*(vbaProject|vbaData|activeX|ms-office\.vbaProject)[^>]*\/>/gi,
          "",
        )
        .replace(
          /application\/vnd\.ms-word\.document\.macroEnabled\.main\+xml/g,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        )
        .replace(
          /application\/vnd\.ms-excel\.sheet\.macroEnabled\.main\+xml/g,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        )
        .replace(
          /application\/vnd\.ms-powerpoint\.presentation\.macroEnabled\.main\+xml/g,
          "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        );
      newExt = kind;
      changes.push(
        `Removidas macros/ActiveX (${vba.length + activeX.length} partes); ficheiro entregue como .${kind}.`,
      );
    }
    if (kind === "docx") {
      const docXml = await zip.file("word/document.xml")?.async("string");
      if (docXml && /DDE(AUTO)?\b/.test(docXml)) {
        zip.file(
          "word/document.xml",
          docXml.replace(
            /<w:instrText([^>]*)>\s*DDE(AUTO)?\b[^<]*<\/w:instrText>/gi,
            "<w:instrText$1></w:instrText>",
          ),
        );
        changes.push("Campos DDE neutralizados.");
      }
    }
  }

  if (options.removeExternal) {
    let removed = 0;
    for (const rel of Object.keys(zip.files).filter((f) => f.endsWith(".rels"))) {
      const x = await zip.file(rel)!.async("string");
      const y = x.replace(/<Relationship\s[^>]*TargetMode="External"[^>]*\/>/g, (tag) => {
        if (/relationships\/hyperlink"/.test(tag)) return tag; // clickable links are kept; they never fire on open
        removed++;
        return "";
      });
      if (y !== x) zip.file(rel, y);
    }
    const settings = await zip.file("word/settings.xml")?.async("string");
    if (settings?.includes("w:attachedTemplate"))
      zip.file("word/settings.xml", settings.replace(/<w:attachedTemplate[^>]*\/>/g, ""));
    if (removed)
      changes.push(
        `Removidas ${removed} relações externas (modelos remotos, imagens remotas, objetos ligados).`,
      );
  }

  zip.file("[Content_Types].xml", ct);
  if (rootRels) zip.file("_rels/.rels", rootRels);
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const mime = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  }[kind];
  return {
    bytes: out,
    fileName: outputName(input.fileName, options.suffix, newExt),
    mime,
    changes: changes.map((c) => c.replace(/\.\.$/, ".")),
  };
}

/* -------------------------------------------- ODT -------------------------------------------- */

async function rewriteOdt(input: RewriteInput): Promise<RewriteOutput> {
  const { profile, options } = input;
  const zip = await JSZip.loadAsync(input.bytes);
  const changes: string[] = [];
  const { created, modified } = datesFor(input);
  let meta = (await zip.file("meta.xml")?.async("string")) ?? "";
  if (meta) {
    const office = meta.match(/<office:meta>([\s\S]*?)<\/office:meta>/);
    if (office) {
      let inner = `<office:meta>${office[1]}</office:meta>`;
      inner = setXmlTag(inner, "meta:initial-creator", profile.fullName);
      inner = setXmlTag(inner, "dc:creator", profile.fullName);
      inner = setXmlTag(inner, "meta:generator", profile.application);
      inner = setXmlTag(
        inner,
        "meta:creation-date",
        isoWithOffset(created, profile.timezone).slice(0, 19),
      );
      inner = setXmlTag(inner, "dc:date", isoWithOffset(modified, profile.timezone).slice(0, 19));
      meta = meta.replace(office[0], inner);
      zip.file("meta.xml", meta);
      changes.push(`Autor → ${profile.fullName}; Gerador → ${profile.application}.`);
    }
  }
  if (options.removeActive) {
    const scripts = Object.keys(zip.files).filter((f) => /^Basic\/|^Scripts\//.test(f));
    scripts.forEach((f) => zip.remove(f));
    const content = await zip.file("content.xml")?.async("string");
    if (content?.includes("office:event-listeners"))
      zip.file(
        "content.xml",
        content.replace(/<office:event-listeners[\s\S]*?<\/office:event-listeners>/g, ""),
      );
    if (scripts.length) changes.push(`Removidas ${scripts.length} partes de macros/scripts.`);
  }
  // mimetype must stay first and uncompressed in ODF packages.
  const mimetype =
    (await zip.file("mimetype")?.async("string")) ?? "application/vnd.oasis.opendocument.text";
  zip.remove("mimetype");
  const out = new JSZip();
  out.file("mimetype", mimetype, { compression: "STORE" });
  for (const [name, f] of Object.entries(zip.files))
    if (!f.dir) out.file(name, await f.async("uint8array"));
  const bytes = await out.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return {
    bytes,
    fileName: outputName(input.fileName, options.suffix),
    mime: "application/vnd.oasis.opendocument.text",
    changes,
  };
}

/* ------------------------------------------- Images ------------------------------------------ */

/** Strips EXIF/XMP/IPTC/C2PA/comments; keeps the ICC colour profile so the image looks identical. */
export function stripJpeg(b: Uint8Array): { bytes: Uint8Array; removed: number } {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new AnalysisError("corrupt", "JPEG inválido.");
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let p = 2,
    removed = 0;
  while (p < b.length - 1) {
    if (b[p] !== 0xff) break;
    const marker = b[p + 1] ?? 0;
    if (marker === 0xda) {
      parts.push(b.subarray(p));
      p = b.length;
      break;
    } // start of scan: rest is image data
    const len = ((b[p + 2] ?? 0) << 8) | (b[p + 3] ?? 0);
    const seg = b.subarray(p, p + 2 + len);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep = !(
      marker === 0xfe ||
      (isApp && marker !== 0xe0 && marker !== 0xe2) ||
      (marker === 0xe2 && !isIcc(seg))
    );
    if (keep) parts.push(seg);
    else removed++;
    p += 2 + len;
  }
  if (p < b.length) parts.push(b.subarray(p));
  return { bytes: concat(parts), removed };
}
const isIcc = (seg: Uint8Array) => String.fromCharCode(...seg.subarray(4, 15)) === "ICC_PROFILE";

export function stripPng(b: Uint8Array): { bytes: Uint8Array; removed: number } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let p = 8,
    removed = 0;
  const drop = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "caBX", "tIME"]);
  while (p + 8 <= b.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...b.subarray(p + 4, p + 8));
    const chunk = b.subarray(p, p + 12 + len);
    if (drop.has(type)) removed++;
    else parts.push(chunk);
    p += 12 + len;
    if (type === "IEND") break;
  }
  return { bytes: concat(parts), removed };
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of parts) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

async function rewriteImage(input: RewriteInput): Promise<RewriteOutput> {
  const b = input.bytes;
  if (b[0] === 0xff) {
    const r = stripJpeg(b);
    return {
      bytes: r.bytes,
      fileName: outputName(input.fileName, input.options.suffix),
      mime: "image/jpeg",
      changes: [
        `Removidos ${r.removed} blocos de metadados (EXIF, XMP, IPTC, C2PA, GPS). Perfil de cor mantido.`,
      ],
    };
  }
  if (b[0] === 0x89) {
    const r = stripPng(b);
    return {
      bytes: r.bytes,
      fileName: outputName(input.fileName, input.options.suffix),
      mime: "image/png",
      changes: [
        `Removidos ${r.removed} blocos de texto/metadados PNG (incl. parâmetros de geração e C2PA).`,
      ],
    };
  }
  throw new AnalysisError(
    "unsupported",
    "A reescrita de HEIC ainda não é suportada no navegador. Converta para JPEG primeiro.",
  );
}
