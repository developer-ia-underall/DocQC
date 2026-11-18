// @ts-nocheck — portado do contratos-bi (JavaScript); a lógica está coberta pelos testes em src/test/contratos.test.ts.
// Preenche o modelo de contrato (.docx) e escreve o resumo (.xlsx).

import JSZip from "jszip";
import { escaparXml } from "./texto";

export const MARCADORES = [
  "CODIGO",
  "NOME",
  "MORADA",
  "RESIDENCIA",
  "CASA",
  "BAIRRO",
  "MUNICIPIO",
  "BI",
  "EMITIDO",
  "VALIDO",
  "LOCAL_DATA",
];

const RE_MARCADOR = /\{\{\s*([A-Z_]+)\s*\}\}/g;

/**
 * Substitui {{MARCADOR}} no XML de um documento Word. O Word parte muitas vezes
 * o texto em vários pedaços (<w:t>), por isso a procura é feita no texto de cada
 * parágrafo inteiro e o valor é escrito no pedaço onde o marcador começa.
 */
export function substituirMarcadores(xml, valores, desconhecidos = new Set()) {
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (paragrafo) => {
    if (!paragrafo.includes("{")) return paragrafo;
    const nos = [...paragrafo.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
    if (!nos.length) return paragrafo;
    const junto = nos.map((n) => n[1]).join("");
    const marcadores = [...junto.matchAll(RE_MARCADOR)].filter((m) => {
      if (m[1] in valores) return true;
      desconhecidos.add(m[1]);
      return false;
    });
    if (!marcadores.length) return paragrafo;

    let pos = 0;
    const novos = nos.map((n) => {
      const ini = pos;
      const fim = pos + n[1].length;
      pos = fim;
      let texto = "";
      let cursor = ini;
      for (const m of marcadores) {
        const mIni = m.index;
        const mFim = m.index + m[0].length;
        if (mFim <= ini || mIni >= fim) continue;
        if (mIni > cursor) texto += junto.slice(cursor, mIni);
        if (mIni >= ini) texto += escaparXml(valores[m[1]]);
        cursor = Math.min(fim, mFim);
      }
      if (cursor < fim) texto += junto.slice(cursor, fim);
      return texto;
    });

    let i = 0;
    return paragrafo.replace(
      /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g,
      () => `<w:t xml:space="preserve">${novos[i++]}</w:t>`,
    );
  });
}

/** Lê um modelo e devolve os marcadores que ele contém (para validar modelos carregados à mão). */
export async function marcadoresDoModelo(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("O ficheiro não é um documento Word (.docx) válido.");
  const xml = await doc.async("string");
  const texto = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
  return [...new Set([...texto.matchAll(RE_MARCADOR)].map((m) => m[1]))];
}

/** Devolve o .docx preenchido (Uint8Array) e a lista de marcadores que não foram reconhecidos. */
export async function preencherModelo(buffer, valores) {
  const zip = await JSZip.loadAsync(buffer);
  const desconhecidos = new Set();
  const partes = Object.keys(zip.files).filter((n) =>
    /^word\/(document|header\d*|footer\d*)\.xml$/.test(n),
  );
  for (const nome of partes) {
    const xml = await zip.file(nome).async("string");
    zip.file(nome, substituirMarcadores(xml, valores, desconhecidos));
  }
  const dados = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { dados, desconhecidos: [...desconhecidos] };
}

// ---------- Resumo em Excel ----------

function letraColuna(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Escreve um .xlsx simples com uma folha.
 * @param colunas [{ titulo, largura }]
 * @param linhas  [[{ v, estilo? }]]  estilo: 'ok' | 'rever' | 'falta' | 'mono'
 */
export async function escreverXlsx(nomeFolha, colunas, linhas) {
  const ESTILOS = { normal: 0, cabecalho: 1, ok: 2, rever: 3, falta: 4, mono: 5 };
  const celula = (ref, valor, estilo) => {
    const s = ESTILOS[estilo] ?? 0;
    if (valor === "" || valor === null || valor === undefined) return `<c r="${ref}" s="${s}"/>`;
    if (typeof valor === "number") return `<c r="${ref}" s="${s}"><v>${valor}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
  };

  const cols = colunas
    .map(
      (c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura || 16}" customWidth="1"/>`,
    )
    .join("");
  let dados = `<row r="1" ht="22" customHeight="1">${colunas.map((c, i) => celula(`${letraColuna(i)}1`, c.titulo, "cabecalho")).join("")}</row>`;
  linhas.forEach((linha, r) => {
    dados += `<row r="${r + 2}">${linha.map((c, i) => celula(`${letraColuna(i)}${r + 2}`, c.v, c.estilo)).join("")}</row>`;
  });
  const ultima = `${letraColuna(colunas.length - 1)}${linhas.length + 1}`;

  const folha = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="16"/><cols>${cols}</cols><sheetData>${dados}</sheetData><autoFilter ref="A1:${ultima}"/></worksheet>`;

  const fonte = (extra = "") =>
    `<font>${extra}<sz val="11"/><name val="Calibri"/><family val="2"/></font>`;
  const cheio = (rgb) =>
    `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4">${fonte()}${fonte('<b/><color rgb="FFFFFFFF"/>')}${fonte("<b/>")}<font><sz val="11"/><name val="Consolas"/><family val="3"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${cheio("FF1F3A34")}${cheio("FFD9EDDF")}${cheio("FFFBE9A7")}${cheio("FFF6D3CF")}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="2" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="2" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escaparXml(nomeFolha)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file("xl/worksheets/sheet1.xml", folha);
  zip.file("xl/styles.xml", estilos);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
