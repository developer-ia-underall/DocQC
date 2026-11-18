// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FORMATO_BI, comporMorada } from "@/lib/contratos/bi-parser";
import {
  atribuirCodigos,
  procurarMunicipio,
  procurarNoCaminho,
  FORMATO_PADRAO,
} from "@/lib/contratos/codigo";
import { substituirMarcadores } from "@/lib/contratos/documentos";
import { consultarNif } from "@/lib/contratos/nif.server";

const cfg = { tipo: "CPS", ano: "26", formato: FORMATO_PADRAO, criterioOrdem: "alfabetica" };

describe("contratos: código do contrato", () => {
  it("atribui a ordem 01, 02… por ordem alfabética dentro do município e função", () => {
    const pessoas = [
      {
        id: 1,
        nome: "Zacarias Manuel",
        provincia: "HUI",
        municipio: "LUB",
        funcao: "BG",
        posicao: 0,
      },
      { id: 2, nome: "Ana Paula", provincia: "HUI", municipio: "LUB", funcao: "BG", posicao: 1 },
      { id: 3, nome: "Sem Colocação", provincia: "", municipio: "", funcao: "BG", posicao: 2 },
    ];
    const r = atribuirCodigos(pessoas, cfg);
    expect(r.get(2).codigo).toBe("CPS-HUI-LUB-BG-010.11/26/01");
    expect(r.get(1).codigo).toBe("CPS-HUI-LUB-BG-010.11/26/02");
    expect(r.get(1).totalNoGrupo).toBe(2);
    expect(r.get(3).codigo).toBe("");
  });

  it("encontra o município escrito no BI e no nome das pastas", () => {
    expect(procurarMunicipio("LUBANGO")?.municipio?.siglaMun).toBe("LUB");
    expect(procurarNoCaminho("Huíla/Lubango/joao frente.jpg")?.municipio?.siglaMun).toBe("LUB");
    expect(procurarMunicipio("xx") ?? null).toBeNull();
  });
});

describe("contratos: dados do BI", () => {
  it("valida o formato do n.º do BI", () => {
    expect(FORMATO_BI.test("008888859LA049")).toBe(true);
    expect(FORMATO_BI.test("08888859LA049")).toBe(false);
  });

  it("compõe a morada do contrato", () => {
    expect(comporMorada({ rua: "Rua 5", casa: "", bairro: "Mapunda", municipio: "Lubango" })).toBe(
      "Rua 5, CASA S/Nº, Bairro Mapunda, município do Lubango",
    );
  });
});

describe("contratos: modelo Word", () => {
  it("substitui marcadores partidos em vários pedaços de texto", () => {
    const xml = "<w:p><w:r><w:t>Nome: {{NO</w:t></w:r><w:r><w:t>ME}}</w:t></w:r></w:p>";
    const desconhecidos = new Set<string>();
    const r = substituirMarcadores(xml, { NOME: "Ana & Filhos" }, desconhecidos);
    expect(r).toContain("Nome: Ana &amp; Filhos");
    expect(r).not.toContain("{{");
    expect(desconhecidos.size).toBe(0);
  });
});

describe("contratos: NIF", () => {
  it("recusa n.º fora do formato sem chamar o portal", async () => {
    const r = await consultarNif("abc");
    expect(r.estado).toBe(400);
  });
});
