import type { DocumentRecord, DocKind } from "@/types/domain";
import { docKey } from "@/services/store";

export interface AuthorStyle {
  docCount: number;
  versionCount: number;
  kinds: { kind: DocKind; count: number }[];
  avgPages: number | null;
  avgWords: number | null;
  sections: { name: string; count: number }[];
  fonts: { name: string; count: number }[];
  humanShare: number;
}

const tally = (xs: string[]) => {
  const m = new Map<string, { name: string; count: number }>();
  for (const x of xs) {
    const k = docKey(x);
    if (!k) continue;
    const e = m.get(k) ?? { name: x, count: 0 };
    e.count++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
};

/** Aggregates the structure of an author's latest versions. This is the corpus the RAG/fine-tuning stage will index. */
export function authorStyle(docs: DocumentRecord[]): AuthorStyle {
  const latest = docs.map((d) => d.versions[d.versions.length - 1]!).filter(Boolean);
  const kinds = new Map<DocKind, number>();
  for (const d of docs) kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);
  const pages = latest.map((v) => v.analysis.structure.pages).filter((x): x is number => !!x);
  const words = latest.map((v) => v.analysis.structure.words).filter((x): x is number => !!x);
  const avg = (a: number[]) =>
    a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null;
  return {
    docCount: docs.length,
    versionCount: docs.reduce((a, d) => a + d.versions.length, 0),
    kinds: [...kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
    avgPages: avg(pages),
    avgWords: avg(words),
    sections: tally(latest.flatMap((v) => v.analysis.structure.sections)).slice(0, 10),
    fonts: tally(latest.flatMap((v) => v.analysis.structure.fonts)).slice(0, 6),
    humanShare: latest.length
      ? Math.round(
          (latest.filter((v) => v.analysis.origin.verdict === "Provável origem humana").length /
            latest.length) *
            100,
        )
      : 0,
  };
}

export interface Suggestion {
  id: string;
  title: string;
  body: string;
}

/**
 * Heuristic suggestions derived from the author's corpus. Placeholder for the model-backed engine:
 * the interface (corpus in, suggestions out) stays the same when RAG/fine-tuning is plugged in.
 */
export function suggestFor(style: AuthorStyle, target?: DocumentRecord): Suggestion[] {
  const out: Suggestion[] = [];
  const common = style.sections.filter((s) => s.count >= 2);
  if (common.length)
    out.push({
      id: "sections",
      title: "Estrutura habitual",
      body: `Os documentos deste autor costumam incluir: ${common
        .slice(0, 5)
        .map((s) => s.name)
        .join(", ")}.`,
    });
  if (target) {
    const last = target.versions[target.versions.length - 1];
    const have = new Set((last?.analysis.structure.sections ?? []).map(docKey));
    const missing = common.filter((s) => !have.has(docKey(s.name)));
    if (missing.length)
      out.push({
        id: "missing",
        title: "Secções em falta",
        body: `Este documento não tem ${missing
          .slice(0, 3)
          .map((s) => `"${s.name}"`)
          .join(", ")}, presentes noutros documentos do autor.`,
      });
  }
  if (style.fonts[0])
    out.push({
      id: "fonts",
      title: "Tipografia",
      body: `Tipo de letra predominante: ${style.fonts[0].name}${style.fonts[1] ? `, com ${style.fonts[1].name} como secundário` : ""}.`,
    });
  if (style.avgPages)
    out.push({
      id: "length",
      title: "Extensão típica",
      body: `Em média ${style.avgPages} página(s)${style.avgWords ? ` e cerca de ${style.avgWords.toLocaleString("pt-PT")} palavras` : ""}.`,
    });
  return out;
}
