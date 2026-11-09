// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { analyzeBytes } from "@/lib/analysis";
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
