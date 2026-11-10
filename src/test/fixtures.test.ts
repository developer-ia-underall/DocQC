// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeBytes } from "@/lib/analysis";

const opts = { maxSizeMb: 50, deepPdf: true, reportLinks: false };
const load = (f: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", f)));

describe("ficheiros de teste de origem", () => {
  for (const f of ["relatorio-IA.docx", "relatorio-IA.pdf"])
    it(`${f} é marcado como gerado em sandbox de IA`, async () => {
      const { analysis } = await analyzeBytes(load(f), f, opts);
      expect(analysis.origin.verdict).toBe("Gerado em sandbox de IA");
    });
  for (const f of ["relatorio-humano.docx", "relatorio-humano.pdf"])
    it(`${f} é marcado como provável origem humana`, async () => {
      const { analysis } = await analyzeBytes(load(f), f, opts);
      expect(analysis.origin.verdict).toBe("Provável origem humana");
      expect(analysis.origin.score).toBe(0);
    });
});
