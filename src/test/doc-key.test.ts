import { describe, expect, it } from "vitest";
import { authorKey, docKey, matchesDocument, usableAuthorName } from "@/lib/doc-key";
import { deriveAuthors } from "@/services/documents-remote";
import type { DocumentRecord, IdentityProfile } from "@/types/domain";

describe("doc-key", () => {
  it("normaliza nomes de ficheiros", () => {
    expect(docKey("Relatório_v2.docx")).toBe(docKey("relatorio.docx"));
    expect(docKey("Proposta (2).pdf")).toBe(docKey("proposta.pdf"));
  });

  it("reconhece nova versão pelo nome ou pelo título, só do mesmo tipo", () => {
    const d = {
      name: "Contrato_Servicos.docx",
      kind: "docx",
      versions: [{ fileName: "Contrato_Servicos.docx", title: "Contrato de Prestação" }],
    };
    expect(matchesDocument(d, { kind: "docx", fileName: "contrato_servicos_v3.docx" })).toBe(
      "name",
    );
    expect(
      matchesDocument(d, { kind: "docx", fileName: "outro.docx", title: "Contrato de prestação" }),
    ).toBe("title");
    expect(matchesDocument(d, { kind: "pdf", fileName: "Contrato_Servicos.pdf" })).toBeNull();
  });

  it("ignora autores genéricos e gera chaves estáveis", () => {
    expect(usableAuthorName("python-docx")).toBeNull();
    expect(usableAuthorName("  root ")).toBeNull();
    expect(authorKey("Eliúde Francisco")).toBe(authorKey("eliude  francisco"));
  });

  it("autores derivados de documentos e identidades, sem repetir", () => {
    const docs = [
      { authorId: authorKey("Ana Domingos"), createdAt: "2026-11-02" },
      { authorId: authorKey("Ana Domingos"), createdAt: "2026-11-01" },
      { authorId: null, createdAt: "2026-11-03" },
    ] as unknown as DocumentRecord[];
    const ids = [
      { fullName: "Ana Domingos", createdAt: "2026-11-05" },
      { fullName: "Rui Neto", createdAt: "2026-11-04" },
    ] as unknown as IdentityProfile[];
    const a = deriveAuthors(docs, ids);
    expect(a.map((x) => x.id)).toEqual([authorKey("Ana Domingos"), authorKey("Rui Neto")]);
    expect(a[0]!.createdAt).toBe("2026-11-01");
  });
});
