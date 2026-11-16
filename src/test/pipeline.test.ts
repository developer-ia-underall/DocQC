// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { analyzeBytes } from "@/lib/analysis";
import { evaluateOrigin } from "@/lib/origin/engine";
import { rewriteDocument, stripJpeg } from "@/lib/rewrite";
import { makeOoxml, SEED_PROFILE } from "@/services/seed";
import { docKey } from "@/services/store";

const opts = { maxSizeMb: 50, deepPdf: true, reportLinks: false };
const rw = { removeActive: true, removeExternal: true, normalizeDates: true, suffix: "" };

async function trackingPdf() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage();
  page.drawText("Fatura", { font: await doc.embedFont(StandardFonts.Helvetica) });
  doc.setProducer("Skia/PDF m118");
  doc.setCreator("HeadlessChrome");
  doc.catalog.set(
    PDFName.of("OpenAction"),
    doc.context.obj({ S: "URI", URI: PDFString.of("http://px.example.net/o.gif") }),
  );
  page.node.set(
    PDFName.of("AA"),
    doc.context.obj({ O: { S: "JavaScript", JS: PDFString.of("app.alert(1)") } }),
  );
  return doc.save({ useObjectStreams: false });
}

async function reportPdf(info: Record<string, string>) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage();
  page.drawText("Relatório de operações", { font: await doc.embedFont(StandardFonts.Helvetica) });
  doc.setTitle("Relatório de operações");
  const infoRef = doc.context.trailerInfo.Info;
  const dict = infoRef ? doc.context.lookup(infoRef) : undefined;
  if (dict && "set" in dict)
    for (const [k, v] of Object.entries(info))
      (dict as { set: (key: PDFName, value: unknown) => void }).set(PDFName.of(k), PDFString.of(v));
  return doc.save({ useObjectStreams: false });
}

describe("PDF", () => {
  it("flags auto-open tracking and JavaScript as dangerous", async () => {
    const { analysis } = await analyzeBytes(await trackingPdf(), "f.pdf", opts);
    expect(analysis.securityState).toBe("Perigoso");
    const ids = analysis.findings.map((f) => f.id);
    expect(ids).toContain("pdf.uri.auto");
    expect(ids).toContain("pdf.javascript");
    expect(analysis.origin.evidence.map((e) => e.ruleId)).toContain("tool.html-to-pdf");
  });

  it("rewrite neutralises active content and applies the identity", async () => {
    const out = await rewriteDocument({
      bytes: await trackingPdf(),
      fileName: "f.pdf",
      kind: "pdf",
      profile: SEED_PROFILE,
      options: { ...rw, suffix: "final" },
    });
    expect(out.fileName).toBe("f_final.pdf");
    const { analysis } = await analyzeBytes(out.bytes, out.fileName, opts);
    expect(analysis.securityState).toBe("Seguro");
    expect(analysis.metadata["Info.Author"]).toBe("Eliúde Francisco");
    expect(analysis.metadata["XMP.xmp:CreatorTool"]).toBe("Microsoft Word 16.0");
    expect(analysis.metadata["Info.CreationDate"]).toMatch(/\+01'00'$/);
    expect(analysis.origin.verdict).toBe("Provável origem humana");
  });
});

describe("OOXML", () => {
  const humanDocx = () =>
    makeOoxml("docx", {
      core: {
        "dc:creator": "Ana Martins",
        "cp:lastModifiedBy": "Rui Silva",
        "cp:revision": "4",
        "dcterms:created": "2026-11-01T09:00:00Z",
        "dcterms:modified": "2026-11-01T11:30:00Z",
      },
      app: { Application: "Microsoft Office Word", Company: "Acme, Lda." },
      headings: ["Resumo", "Conclusão"],
    });

  const sandboxDocx = () =>
    makeOoxml("docx", {
      core: {
        "dc:creator": "python-docx",
        "cp:lastModifiedBy": "python-docx",
        "cp:revision": "1",
        "dcterms:created": "2013-12-23T23:15:00Z",
        "dcterms:modified": "2013-12-23T23:15:00Z",
      },
      headings: ["Sumário", "Riscos"],
      externalImage: "https://px.example.com/t.png",
      extra: { "customXml/item1.xml": "<r>/mnt/data/x.docx</r>" },
    });

  it("detects python-docx sandbox output and remote image", async () => {
    const { analysis } = await analyzeBytes(await sandboxDocx(), "r.docx", opts);
    expect(analysis.origin.verdict).toBe("Gerado em sandbox de IA");
    expect(analysis.findings.some((f) => f.title.startsWith("Imagem remota"))).toBe(true);
    expect(analysis.structure.sections).toEqual(["Sumário", "Riscos"]);
  });

  it("rewrite produces an Office-looking document without the external relation", async () => {
    const out = await rewriteDocument({
      bytes: await sandboxDocx(),
      fileName: "r.docx",
      kind: "docx",
      profile: SEED_PROFILE,
      options: rw,
    });
    const { analysis } = await analyzeBytes(out.bytes, out.fileName, opts);
    expect(analysis.metadata["core.dc:creator"]).toBe("Eliúde Francisco");
    expect(analysis.metadata["app.Application"]).toBe("Microsoft Office Word");
    expect(analysis.metadata["app.Company"]).toBe("Call4All, Lda.");
    expect(analysis.findings.some((f) => f.title.startsWith("Imagem remota"))).toBe(false);
    expect(analysis.origin.evidence.map((e) => e.ruleId)).not.toContain("sandbox.path");
    expect(analysis.origin.verdict).toBe("Provável origem humana");
  });

  it("keeps a human Word report human when it was reviewed by another person", async () => {
    const { analysis } = await analyzeBytes(await humanDocx(), "relatorio-humano.docx", opts);
    expect(analysis.origin.verdict).toBe("Provável origem humana");
    expect(analysis.origin.verdict).not.toBe("Metadados contraditórios");
  });
});

describe("Images", () => {
  it("strips APP1/COM segments but keeps image data", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2, 0xff, 0xfe, 0, 3, 9, 0xff, 0xda, 0, 2, 7, 7, 0xff, 0xd9,
    ]);
    const { bytes, removed } = stripJpeg(jpeg);
    expect(removed).toBe(2);
    expect(Array.from(bytes)).toEqual([0xff, 0xd8, 0xff, 0xda, 0, 2, 7, 7, 0xff, 0xd9]);
  });
});

describe("origin regression fixtures", () => {
  it("classifies human and automated PDF reports without using generic test words", async () => {
    const human = await analyzeBytes(
      await reportPdf({
        Author: "Ana Martins",
        Creator: "Microsoft Word",
        Producer: "Microsoft Word",
      }),
      "relatorio-humano.pdf",
      opts,
    );
    const automated = await analyzeBytes(
      await reportPdf({
        Author: "root",
        Creator: "/mnt/data/relatorio-IA.pdf",
        Producer: "ReportLab",
      }),
      "relatorio-IA.pdf",
      opts,
    );
    expect(human.analysis.origin.verdict).toBe("Provável origem humana");
    expect(automated.analysis.origin.verdict).toBe("Gerado em sandbox de IA");
  });

  it("does not flag ordinary discussion of AI as an AI disclosure", () => {
    const result = evaluateOrigin({
      kind: "text",
      hasEmbeddedMetadata: false,
      metadataCount: 0,
      allText: "A política diz que o conteúdo gerado por IA deve ser revisto.",
    });
    expect(result.verdict).toBe("Inconclusivo");
    expect(result.evidence.map((e) => e.ruleId)).not.toContain("content.ai-disclaimer");
  });
});

describe("versioning keys", () => {
  it("matches renamed versions", () => {
    expect(docKey("Contrato_Prestacao_Servicos_v2.docx")).toBe(
      docKey("Contrato Prestação Serviços.docx"),
    );
    expect(docKey("Relatório (1).pdf")).toBe(docKey("relatorio.pdf"));
  });
});

describe("XMP encoding", () => {
  it("keeps non-ASCII characters in the regenerated XMP", async () => {
    const out = await rewriteDocument({
      bytes: await trackingPdf(),
      fileName: "f.pdf",
      kind: "pdf",
      title: "Fatura n.º 1 — teste",
      profile: SEED_PROFILE,
      options: rw,
    });
    const { analysis } = await analyzeBytes(out.bytes, out.fileName, opts);
    expect(analysis.metadata["XMP.dc:creator"]).toBe("Eliúde Francisco");
    expect(analysis.metadata["XMP.dc:title"]).toBe("Fatura n.º 1 — teste");
  });
});

describe("origin confidence boundaries", () => {
  it("does not treat a generator library alone as proof of AI", () => {
    const result = evaluateOrigin({
      kind: "pdf",
      producer: "ReportLab",
      metadata: { "Info.Producer": "ReportLab" },
      hasEmbeddedMetadata: true,
      metadataCount: 1,
      allText: "ReportLab",
    });
    expect(result.verdict).toBe("Processado por ferramenta automática");
    expect(result.signalScores.ai).toBe(0);
    expect(result.signalScores.tool).toBeGreaterThan(0);
  });

  it("surfaces metadata contradictions as tampering instead of human origin", () => {
    const result = evaluateOrigin({
      kind: "pdf",
      metadata: {
        "Info.Author": "Ana",
        "XMP.dc:creator": "Outro autor",
      },
      author: "Ana",
      hasEmbeddedMetadata: true,
      metadataCount: 2,
      allText: "Ana Outro autor",
    });
    expect(result.verdict).toBe("Metadados contraditórios");
    expect(result.signalScores.tampered).toBeGreaterThanOrEqual(35);
  });

  it("detects explicit AI disclosure in text without treating missing metadata as human", async () => {
    const { analysis } = await analyzeBytes(
      new TextEncoder().encode("Como modelo de linguagem, não posso confirmar esta afirmação."),
      "nota.txt",
      opts,
    );
    expect(analysis.origin.verdict).toBe("Indícios de IA");
    expect(analysis.origin.confidence).toBe("baixa");
  });
});
