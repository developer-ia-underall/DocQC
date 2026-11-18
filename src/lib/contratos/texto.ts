// @ts-nocheck — portado do contratos-bi (JavaScript); a lógica está coberta pelos testes em src/test/contratos.test.ts.
// Utilitários de texto usados pelo leitor de BI e pela correspondência de municípios.

export function semAcentos(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Maiúsculas, sem acentos, só letras e números separados por um espaço. */
export function norm(s) {
  return semAcentos(s)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let ant = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const act = [i];
    for (let j = 1; j <= b.length; j++) {
      act[j] = Math.min(ant[j] + 1, act[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    ant = act;
  }
  return ant[b.length];
}

/** 1 = iguais, 0 = totalmente diferentes. */
export function semelhanca(a, b) {
  const m = Math.max(a.length, b.length);
  return m ? 1 - levenshtein(a, b) / m : 1;
}

export function escaparXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escaparHtml(s) {
  return escaparXml(s).replace(/'/g, "&#39;");
}

/** Junta espaços repetidos e apara. */
export function limpar(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Datas no formato DD/MM/AAAA ----

export function lerData(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, mes - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d)
    return null;
  return dt;
}

export function dataValida(s) {
  return lerData(s) !== null;
}
