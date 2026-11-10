/** Normalises a file name / title so "Relatório_v2.docx", "relatorio (2).docx" and "relatorio.docx" match. */
export function docKey(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .replace(/[_\-\s]*(v|ver|versao|version|rev)\s*\d+$/g, "")
    .replace(/\(\d+\)|\bfinal\b|\bcopia\b|\bcopy\b|_docqc$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const GENERIC =
  /^(root|user|sandbox|admin|ubuntu|runner|jovyan|python|unknown|anonymous|python-docx|un-named|author)$/i;

/** Nome de autor útil (não genérico nem de biblioteca)? */
export function usableAuthorName(name?: string): string | null {
  const n = name?.trim();
  if (!n || GENERIC.test(n) || /python|openpyxl|canny/i.test(n)) return null;
  return n;
}

/** Chave estável de um autor a partir do nome (usada com o Supabase, onde não há tabela de autores). */
export const authorKey = (name: string) => `a-${docKey(name).replace(/ /g, "-")}`;

/** Mesma regra de correspondência de versões do modo local (nome do ficheiro ou título). */
export function matchesDocument(
  d: { name: string; kind: string; versions: { fileName: string; title?: string | undefined }[] },
  input: { kind: string; fileName: string; title?: string | undefined },
): "name" | "title" | null {
  if (d.kind !== input.kind) return null;
  const key = docKey(input.fileName);
  const titleKey = input.title ? docKey(input.title) : "";
  if (docKey(d.name) === key || d.versions.some((v) => docKey(v.fileName) === key)) return "name";
  if (titleKey.length > 3 && d.versions.some((v) => !!v.title && docKey(v.title) === titleKey))
    return "title";
  return null;
}
