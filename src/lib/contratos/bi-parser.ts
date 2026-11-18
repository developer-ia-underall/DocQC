// @ts-nocheck — portado do contratos-bi (JavaScript); a lógica está coberta pelos testes em src/test/contratos.test.ts.
// Interpreta o resultado do OCR de um Bilhete de Identidade angolano.
//
// Entrada: linhas do OCR, cada uma com as suas palavras e caixas (x0,y0,x1,y1).
// Saída: os campos de que o contrato precisa, cada um com a confiança da leitura.
//
// O BI tem sempre os rótulos em minúsculas («Nome Completo:», «Residência:»…)
// e os valores em MAIÚSCULAS, alinhados à mesma margem esquerda. O leitor
// localiza os rótulos e vai buscar os valores pela posição (à direita / abaixo),
// por isso funciona com a frente e o verso na mesma página ou em páginas separadas.

import { norm, semAcentos, semelhanca, limpar } from "./texto";

const ROTULOS = {
  republica: "REPUBLICADEANGOLA",
  cabecalho: "DECIDADAONACIONAL",
  nome: "NOMECOMPLETO",
  filiacao: "FILIACAO",
  assinatura: "ASSINATURADOTITULAR",
  residencia: "RESIDENCIA",
  natural: "NATURALDE",
  provincia: "PROVINCIADE",
  nascimento: "DATADENASCIMENTO",
  sexo: "SEXO",
  altura: "ALTURAM",
  estado: "ESTADOCIVIL",
  emitido: "EMITIDOEM",
  valido: "VALIDOATE",
  director: "DIRECTORNACIONALDEIDENTIFICACAO",
};
const ROTULOS_FRENTE = ["nome", "filiacao", "bilhete"];
const ROTULOS_VERSO = [
  "residencia",
  "natural",
  "provincia",
  "nascimento",
  "estado",
  "emitido",
  "valido",
];

// ---------- Número do BI: 9 algarismos + 2 letras + 3 algarismos ----------

const PARA_ALGARISMO = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6" };
const PARA_LETRA = { 0: "O", 1: "L", 5: "S", 8: "B", 2: "Z", 6: "G" };
export const FORMATO_BI = /^\d{9}[A-Z]{2}\d{3}$/;

/**
 * Procura um número de BI dentro de um texto lido por OCR, corrigindo as
 * confusões típicas (O↔0, I/L↔1, S↔5, B↔8) conforme a posição.
 * Devolve { valor, corrigido } ou null.
 */
export function normalizarNumeroBI(bruto) {
  const s = semAcentos(bruto)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const tentar = (janela) => {
    let saida = "";
    let corrigido = false;
    for (let k = 0; k < 14; k++) {
      const c = janela[k];
      if (k === 9 || k === 10) {
        if (/[A-Z]/.test(c)) saida += c;
        else if (PARA_LETRA[c]) {
          saida += PARA_LETRA[c];
          corrigido = true;
        } else return null;
      } else if (/\d/.test(c)) saida += c;
      else if (PARA_ALGARISMO[c]) {
        saida += PARA_ALGARISMO[c];
        corrigido = true;
      } else return null;
    }
    return FORMATO_BI.test(saida) ? { valor: saida, corrigido } : null;
  };
  if (s.length === 14) {
    const r = tentar(s);
    return r ? { ...r, aproximado: false } : null;
  }
  // Com caracteres a mais não se sabe qual está a sobrar: o resultado é só uma pista.
  for (let i = 0; i + 14 <= s.length; i++) {
    const r = tentar(s.slice(i, i + 14));
    if (r) return { ...r, aproximado: true };
  }
  return null;
}

// ---------- Datas ----------

function dataPlausivel(d, m, a) {
  return d >= 1 && d <= 31 && m >= 1 && m <= 12 && a >= 1900 && a <= 2100;
}

/** Devolve as datas encontradas num texto, da esquerda para a direita. */
export function extrairDatas(texto) {
  const t = String(texto ?? "");
  const achadas = [];
  const usar = (re, exata) => {
    for (const m of t.matchAll(re)) {
      const ini = m.index;
      const fim = ini + m[0].length;
      if (achadas.some((x) => ini < x.fim && fim > x.ini)) continue;
      const [d, mes, a] = [m[1], m[2], m[3]];
      achadas.push({
        valor: `${d}/${mes}/${a}`,
        exata,
        plausivel: dataPlausivel(Number(d), Number(mes), Number(a)),
        ini,
        fim,
      });
    }
  };
  usar(/(?<!\d)(\d{2})\s?\/\s?(\d{2})\s?\/\s?(\d{4})(?!\d)/g, true);
  // Separadores mal lidos (ex.: «14.05-2004», «14l05|2004»).
  usar(/(?<!\d)(\d{2})\s?[\\|.,\-:;lI!/]\s?(\d{2})\s?[\\|.,\-:;lI!/]\s?(\d{4})(?!\d)/g, false);
  usar(/(?<!\d)(\d{2})\s(\d{2})\s(\d{4})(?!\d)/g, false);
  return achadas.sort((x, y) => x.ini - y.ini);
}

// ---------- Geometria ----------

const altura = (c) => c.y1 - c.y0;
const centroY = (c) => (c.y0 + c.y1) / 2;

function uniao(caixas) {
  if (!caixas.length) return null;
  return {
    x0: Math.min(...caixas.map((c) => c.x0)),
    y0: Math.min(...caixas.map((c) => c.y0)),
    x1: Math.max(...caixas.map((c) => c.x1)),
    y1: Math.max(...caixas.map((c) => c.y1)),
  };
}

function mediana(v) {
  if (!v.length) return 0;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
}

const SO_MAIUSCULAS = /^[A-ZÀ-Ý][A-ZÀ-Ý'’.-]*$/;

/**
 * Altura típica das letras maiúsculas (serve de régua para todas as distâncias).
 * `angulo` (radianos) desconta a inclinação do texto, que aumenta as caixas das palavras.
 */
export function alturaMaiusculas(linhas, angulo = 0) {
  const t = Math.abs(Math.tan(angulo));
  const real = (p) => Math.max(1, altura(p) - (p.x1 - p.x0) * t);
  const percentil = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.35)];
  const hs = [];
  for (const l of linhas) {
    for (const p of l.palavras) {
      if (p.conf >= 70 && p.texto.length >= 4 && SO_MAIUSCULAS.test(p.texto)) hs.push(real(p));
    }
  }
  if (hs.length) return percentil(hs);
  const todas = linhas.flatMap((l) => l.palavras.filter((p) => p.texto.length >= 3).map(real));
  return todas.length ? percentil(todas) : 20;
}

/** Parte cada linha do OCR em segmentos quando há um espaço grande entre palavras. */
function segmentar(linhas, H) {
  const segs = [];
  for (const l of linhas) {
    const pal = l.palavras.filter((p) => p.texto.trim()).sort((a, b) => a.x0 - b.x0);
    let actual = [];
    for (const p of pal) {
      const ant = actual[actual.length - 1];
      if (ant && p.x0 - ant.x1 > 2.4 * H) {
        segs.push(actual);
        actual = [];
      }
      actual.push(p);
    }
    if (actual.length) segs.push(actual);
  }
  return segs.map((palavras, id) => ({ id, palavras, ...uniao(palavras), rotulos: [] }));
}

// ---------- Rótulos ----------

const ROTULOS_EM_MAIUSCULAS = new Set(["republica", "cabecalho", "assinatura", "director"]);
const TEM_MINUSCULAS = /[a-zà-ÿ]/;

function procurarRotulo(seg, alvo, exigeMinusculas) {
  const n = seg.palavras.length;
  const L = alvo.length;
  const limiar = L <= 5 ? 0.74 : 0.7;
  let melhor = null;
  for (let i = 0; i < n; i++) {
    let acc = "";
    for (let j = i; j < n && j < i + 7; j++) {
      acc += norm(seg.palavras[j].texto).replace(/ /g, "");
      if (acc.length > L + 3) break;
      if (acc.length < L - 3) continue;
      const sim = semelhanca(acc, alvo);
      if (sim < limiar || (melhor && sim <= melhor.sim)) continue;
      // Os valores do BI estão em maiúsculas; um rótulo tem sempre minúsculas.
      if (
        exigeMinusculas &&
        !seg.palavras.slice(i, j + 1).some((p) => TEM_MINUSCULAS.test(p.texto))
      )
        continue;
      melhor = { ini: i, fim: j + 1, sim };
    }
  }
  return melhor;
}

function marcarRotulos(segs) {
  for (const seg of segs) {
    for (const [nomeRot, alvo] of Object.entries(ROTULOS)) {
      const m = procurarRotulo(seg, alvo, !ROTULOS_EM_MAIUSCULAS.has(nomeRot));
      if (m)
        seg.rotulos.push({ nome: nomeRot, ...m, caixa: uniao(seg.palavras.slice(m.ini, m.fim)) });
    }
    // «Bilhete de Identidade Nº:» (rótulo, com minúsculas) ≠ «BILHETE DE IDENTIDADE» (cabeçalho).
    const p0 = seg.palavras[0];
    if (p0 && semelhanca(norm(p0.texto), "BILHETE") >= 0.7) {
      const texto = seg.palavras.map((p) => p.texto).join(" ");
      const minusculas = (texto.match(/[a-zà-ÿ]/g) || []).length;
      if (minusculas >= 4) {
        let fim = 1;
        for (let j = 1; j < seg.palavras.length && j < 5; j++) {
          if (/[a-zà-ÿ]/.test(seg.palavras[j].texto) || /^N.?.?$/.test(seg.palavras[j].texto))
            fim = j + 1;
          else break;
        }
        seg.rotulos.push({
          nome: "bilhete",
          ini: 0,
          fim,
          sim: 1,
          caixa: uniao(seg.palavras.slice(0, fim)),
        });
      } else {
        seg.rotulos.push({
          nome: "cabecalhoBilhete",
          ini: 0,
          fim: seg.palavras.length,
          sim: 1,
          caixa: uniao(seg.palavras),
        });
      }
    }
    seg.rotulos.sort((a, b) => a.ini - b.ini);
  }
}

function primeiroRotulo(segs, nomeRot) {
  let melhor = null;
  for (const seg of segs) {
    for (const r of seg.rotulos) {
      if (r.nome === nomeRot && (!melhor || r.sim > melhor.rot.sim)) melhor = { seg, rot: r };
    }
  }
  return melhor;
}

// ---------- Valores ----------

/** Palavras de um valor: tira lixo do OCR e restos de rótulos (que têm minúsculas). */
function palavrasDeValor(palavras, { soLetras = false } = {}) {
  const boas = [];
  for (const p of palavras) {
    let t = p.texto.replace(/[|_~^`"“”‘«»*=<>{}[\]]/g, "").trim();
    t = t.replace(/^[.,;:!?'’-]+(?=.)/, "").replace(/(?<=.)[,;:!?]+$/, "");
    if (!t) continue;
    if (p.conf < 20) continue;
    const eNumeroDeCasa = /^N[oº°.]{1,2}\d*[A-Z]?$/.test(t);
    if (/[a-zà-ÿ]/.test(t) && !eNumeroDeCasa) continue;
    if (soLetras && !SO_MAIUSCULAS.test(t)) continue;
    if (!soLetras && !/[A-ZÀ-Ý0-9]/.test(t) && t !== "-") continue;
    boas.push({ ...p, texto: t });
  }
  return boas;
}

function campoDe(palavras) {
  if (!palavras.length) return null;
  return {
    valor: limpar(palavras.map((p) => p.texto).join(" ")),
    conf: Math.round(Math.min(...palavras.map((p) => p.conf))),
    caixa: uniao(palavras),
  };
}

/** O que está escrito à direita de um rótulo, na mesma linha. */
function aDireita(segs, alvo, H) {
  const { seg, rot } = alvo;
  const proximo = seg.rotulos.find((r) => r.ini >= rot.fim);
  let palavras = seg.palavras.slice(rot.fim, proximo ? proximo.ini : undefined);
  if (!proximo) {
    const yc = centroY(rot.caixa);
    const outros = segs
      .filter((s) => s !== seg && s.x0 > rot.caixa.x1 && s.x0 - rot.caixa.x1 < 16 * H)
      .filter((s) => Math.abs(centroY(s) - yc) < 0.6 * H)
      .sort((a, b) => a.x0 - b.x0);
    for (const s of outros) {
      if (s.rotulos.length && s.rotulos[0].ini === 0) break;
      const corte = s.rotulos.length ? s.rotulos[0].ini : undefined;
      palavras = palavras.concat(s.palavras.slice(0, corte));
      if (corte !== undefined) break;
    }
  }
  return palavras;
}

/** Segmentos alinhados com o rótulo, por baixo dele, até ao rótulo seguinte. */
function abaixo(segs, alvo, H, max) {
  const { rot } = alvo;
  const x = rot.caixa.x0;
  const saida = [];
  const candidatos = segs
    .filter((s) => s !== alvo.seg && s.y0 > rot.caixa.y0 + 0.5 * H && Math.abs(s.x0 - x) < 2.5 * H)
    .sort((a, b) => a.y0 - b.y0);
  let ultimoY = rot.caixa.y1;
  for (const s of candidatos) {
    if (s.rotulos.some((r) => r.ini === 0)) break;
    if (s.y0 - ultimoY > 2.2 * H) break;
    saida.push(s);
    ultimoY = s.y1;
    if (saida.length >= max) break;
  }
  return saida;
}

/** Segmentos alinhados com o rótulo, por cima dele (usado quando falta o rótulo de cima). */
function acima(segs, alvo, H, max) {
  const { rot } = alvo;
  const x = rot.caixa.x0;
  const saida = [];
  const candidatos = segs
    .filter((s) => s !== alvo.seg && s.y1 < rot.caixa.y0 + 0.5 * H && Math.abs(s.x0 - x) < 3.5 * H)
    .sort((a, b) => b.y0 - a.y0);
  let ultimoY = rot.caixa.y0;
  for (const s of candidatos) {
    if (ultimoY - s.y1 > 2.2 * H) break;
    saida.unshift(s);
    ultimoY = s.y0;
    if (s.rotulos.some((r) => r.ini === 0)) break; // linha do rótulo em falta/mal lido
    if (saida.length >= max) break;
  }
  return saida;
}

// ---------- Interpretação ----------

/**
 * @param linhas [{ texto, conf, x0,y0,x1,y1, palavras:[{texto,conf,x0,y0,x1,y1}] }]
 */
export function interpretarBI(linhas) {
  const H = alturaMaiusculas(linhas);
  const segs = segmentar(linhas, H);
  marcarRotulos(segs);

  const rot = {};
  for (const nomeRot of [...Object.keys(ROTULOS), "bilhete"])
    rot[nomeRot] = primeiroRotulo(segs, nomeRot);

  const campos = {};

  // ----- Nome -----
  if (rot.nome) {
    const todas = palavrasDeValor(aDireita(segs, rot.nome, H), { soLetras: true });
    for (const s of abaixo(segs, rot.nome, H, 3)) {
      const p = palavrasDeValor(s.palavras, { soLetras: true });
      if (!p.length) break; // chegou à «Filiação:» (mesmo que mal lida)
      todas.push(...p);
    }
    if (todas.length) {
      campos.nome = campoDe(todas);
      if (!rot.filiacao) campos.nome.conf = Math.min(campos.nome.conf, 55); // sem o fim do nome bem marcado
    }
  }
  if (!campos.nome && rot.filiacao) {
    // Rótulo «Nome Completo:» ilegível: o nome são as linhas em maiúsculas logo acima de «Filiação:».
    const cima = [];
    for (const s of acima(segs, rot.filiacao, H, 3).reverse()) {
      if (s.rotulos.length || s.palavras.some((p) => TEM_MINUSCULAS.test(p.texto))) break;
      cima.unshift(s);
    }
    const todas = cima.flatMap((s) => palavrasDeValor(s.palavras, { soLetras: true }));
    if (todas.length) campos.nome = { ...campoDe(todas), conf: Math.min(campoDe(todas).conf, 55) };
  }

  // ----- Número do BI -----
  const candidatosNumero = [];
  for (const s of segs) {
    // Tenta todos os grupos de palavras seguidas (o número pode vir partido ou colado a lixo).
    let achado = null;
    const n = s.palavras.length;
    for (let i = 0; i < n && !achado?.exacto; i++) {
      for (let j = i; j < n && j < i + 4; j++) {
        const grupo = s.palavras.slice(i, j + 1);
        const lido = normalizarNumeroBI(grupo.map((p) => p.texto).join(""));
        if (!lido) continue;
        const exacto = !lido.aproximado;
        if (!achado || (exacto && !achado.exacto)) achado = { lido, grupo, exacto };
        if (exacto) break;
      }
    }
    if (achado) {
      const conf = Math.round(Math.min(...achado.grupo.map((p) => p.conf)));
      const seguro = achado.exacto && !achado.lido.corrigido;
      candidatosNumero.push({
        valor: achado.lido.valor,
        conf: seguro ? conf : Math.min(conf, achado.exacto ? 60 : 0),
        caixa: uniao(achado.grupo),
        valido: achado.exacto,
      });
    }
  }
  if (candidatosNumero.length) {
    const ref = rot.bilhete?.rot.caixa;
    candidatosNumero.sort(
      (a, b) =>
        b.valido - a.valido ||
        (ref ? Math.abs(a.caixa.y0 - ref.y1) - Math.abs(b.caixa.y0 - ref.y1) : b.conf - a.conf),
    );
    campos.numero = candidatosNumero[0];
  } else if (rot.bilhete) {
    // Não se reconheceu o formato: guarda-se o texto em bruto para a pessoa corrigir.
    const baixo = abaixo(segs, rot.bilhete, H * 1.6, 1)[0];
    const direita = aDireita(segs, rot.bilhete, H);
    const palavras = baixo ? baixo.palavras : direita;
    if (palavras.length) {
      campos.numero = {
        valor: palavras
          .map((p) => p.texto)
          .join("")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, ""),
        conf: 0,
        caixa: uniao(palavras),
        valido: false,
      };
    }
  }

  // ----- Residência -----
  const linhasRes = [];
  if (rot.residencia) {
    const primeira = palavrasDeValor(aDireita(segs, rot.residencia, H));
    if (primeira.length) linhasRes.push(primeira);
    for (const s of abaixo(segs, rot.residencia, H, 4)) {
      const p = palavrasDeValor(s.palavras);
      if (p.length) linhasRes.push(p);
    }
  } else if (rot.natural) {
    for (const s of acima(segs, rot.natural, H, 3)) {
      const p = palavrasDeValor(s.palavras);
      if (p.length) linhasRes.push(p);
    }
  }
  if (linhasRes.length) {
    const todas = linhasRes.flat();
    campos.residencia = {
      linhas: linhasRes.map((l) => limpar(l.map((p) => p.texto).join(" "))),
      conf: Math.round(Math.min(...todas.map((p) => p.conf), rot.residencia ? 100 : 60)),
      caixa: uniao(todas),
    };
  }

  // ----- Datas de emissão e validade -----
  const lerDataDe = (alvo) => {
    if (!alvo) return null;
    const palavras = aDireita(segs, alvo, H);
    const texto = palavras.map((p) => p.texto).join(" ");
    const datas = extrairDatas(texto);
    if (!datas.length) return null;
    const d = datas[0];
    const conf = Math.round(Math.min(...palavras.map((p) => p.conf)));
    return {
      valor: d.valor,
      conf: d.exata && d.plausivel ? conf : Math.min(conf, 50),
      caixa: uniao(palavras),
      plausivel: d.plausivel,
    };
  };
  campos.emitido = lerDataDe(rot.emitido);
  campos.valido = lerDataDe(rot.valido);
  const nascimento = lerDataDe(rot.nascimento);

  // Recurso: se um rótulo falhou, usam-se as datas do verso por ordem cronológica
  // (nascimento < emissão < validade).
  if (
    (!campos.emitido || !campos.valido) &&
    (rot.emitido || rot.valido || rot.nascimento || rot.residencia)
  ) {
    const todas = [];
    for (const s of segs) {
      const texto = s.palavras.map((p) => p.texto).join(" ");
      for (const d of extrairDatas(texto)) {
        if (d.plausivel)
          todas.push({ valor: d.valor, conf: 45, caixa: uniao(s.palavras), plausivel: true });
      }
    }
    const chave = (v) => v.slice(6) + v.slice(3, 5) + v.slice(0, 2);
    const unicas = [...new Map(todas.map((d) => [d.valor, d])).values()].sort((a, b) =>
      chave(a.valor).localeCompare(chave(b.valor)),
    );
    const semNasc = unicas.filter((d) => d.valor !== nascimento?.valor);
    if (unicas.length >= 3 || (nascimento && semNasc.length >= 2)) {
      const fonte = unicas.length >= 3 ? unicas.slice(-2) : semNasc.slice(-2);
      campos.emitido ??= fonte[0];
      campos.valido ??= fonte[1];
    }
  }
  if (!campos.emitido) delete campos.emitido;
  if (!campos.valido) delete campos.valido;

  const achados = Object.keys(rot).filter((k) => rot[k]);
  const temFrente =
    Boolean(campos.nome || campos.numero) || ROTULOS_FRENTE.filter((k) => rot[k]).length >= 2;
  const temVerso =
    Boolean(campos.residencia || campos.emitido || campos.valido) ||
    ROTULOS_VERSO.filter((k) => rot[k]).length >= 2;

  // Zona onde deve estar o número (por baixo do rótulo), para o reler quando não foi apanhado.
  let zonaNumero = null;
  if (rot.bilhete) {
    const c = rot.bilhete.rot.caixa;
    zonaNumero = { x0: c.x0 - H, y0: c.y1 + 0.1 * H, x1: c.x0 + 20 * H, y1: c.y1 + 3.2 * H };
  }

  return { temFrente, temVerso, campos, rotulos: achados, alturaLetra: H, zonaNumero };
}

/** Quantas palavras-chave do BI aparecem (para saber se a página está na orientação certa). */
export function contarPalavrasChave(linhas) {
  const chaves = [
    "REPUBLICA",
    "ANGOLA",
    "BILHETE",
    "IDENTIDADE",
    "CIDADAO",
    "NACIONAL",
    "COMPLETO",
    "FILIACAO",
    "RESIDENCIA",
    "NATURAL",
    "PROVINCIA",
    "NASCIMENTO",
    "EMITIDO",
    "VALIDO",
    "ESTADO",
    "CIVIL",
    "DIRECTOR",
    "IDENTIFICACAO",
    "ASSINATURA",
    "TITULAR",
  ];
  const vistas = new Set();
  for (const l of linhas) {
    for (const p of l.palavras) {
      const n = norm(p.texto).replace(/ /g, "");
      if (n.length < 4) continue;
      // Só contam palavras deitadas: o Tesseract também lê texto na vertical, e isso
      // significa que a página está rodada.
      if (p.x1 - p.x0 < 1.3 * (p.y1 - p.y0)) continue;
      for (const c of chaves) {
        if (!vistas.has(c) && semelhanca(n, c) >= 0.8) vistas.add(c);
      }
    }
  }
  return vistas.size;
}

// ---------- Residência → partes da morada ----------

/**
 * Parte as linhas de residência do BI nas peças que o contrato pede.
 * Ex.: ["RUA 4 CASA Nº40", "BAIRRO MABOR", "CAZENGA"]
 *   → { rua: "RUA 4", casa: "40", bairro: "MABOR", municipio: "CAZENGA" }
 */
export function decomporResidencia(linhas) {
  const ls = (linhas || []).map(limpar).filter(Boolean);
  const saida = { rua: "", casa: "", bairro: "", municipio: "" };
  if (!ls.length) return saida;

  const eBairro = (l) => /^B[A-Z]{0,3}RRO\b/.test(semAcentos(l).toUpperCase());
  const iBairro = ls.findIndex(eBairro);
  let iMun = -1;
  if (ls.length >= 2 && !eBairro(ls[ls.length - 1])) iMun = ls.length - 1;

  let iBairroUsado = iBairro;
  if (iBairro >= 0) saida.bairro = limpar(ls[iBairro].replace(/^\S+\s*[-–—:.]*\s*/, ""));
  else if (ls.length === 3) {
    // No BI a 2.ª linha é o bairro, mesmo quando não começa por «BAIRRO».
    iBairroUsado = 1;
    saida.bairro = ls[1];
  }
  if (iMun >= 0) saida.municipio = ls[iMun];

  let resto = ls.filter((_, i) => i !== iBairroUsado && i !== iMun).join(", ");
  const casa =
    /\bCASA\s*(?:(?:N\s?[º°oO.]{0,2}|Nº|N°)\s*([0-9]+\s?[A-Z]?\b)|(S\s?\/\s?N[º°]?|SN[º°]?)|([0-9]+[A-Z]?\b))?/i.exec(
      resto,
    );
  if (casa) {
    const numero = casa[1] || casa[3];
    saida.casa = numero ? numero.replace(/\s/g, "") : "S/N";
    resto = resto.slice(0, casa.index) + " " + resto.slice(casa.index + casa[0].length);
  }
  saida.rua = limpar(resto.replace(/\s+,/g, ",").replace(/^[\s,\-–]+|[\s,\-–]+$/g, ""));
  return saida;
}

/** Texto da morada como entra no contrato, saltando as partes vazias. */
export function comporMorada({ rua, casa, bairro, municipio }) {
  const partes = [];
  if (limpar(rua)) partes.push(limpar(rua));
  partes.push(textoCasa(casa));
  if (limpar(bairro)) partes.push(`Bairro ${limpar(bairro)}`);
  if (limpar(municipio)) partes.push(`município do ${limpar(municipio)}`);
  return partes.join(", ");
}

export function textoCasa(casa) {
  const c = limpar(casa).toUpperCase();
  if (!c || /^S\s?\/?\s?N/.test(c)) return "CASA S/Nº";
  return `CASA Nº ${c}`;
}
