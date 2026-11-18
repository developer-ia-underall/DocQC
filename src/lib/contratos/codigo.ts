// @ts-nocheck — portado do contratos-bi (JavaScript); a lógica está coberta pelos testes em src/test/contratos.test.ts.
// Código (referência) do contrato, segundo a «Guia Interna de Numeração de
// Contratos e Documentos»:  TIPO-PROV-MUN-FUNC-SEQ.SUBSEQ/ANO
// A guia não distingue duas pessoas com a mesma função no mesmo município,
// por isso acrescenta-se a ORDEM (01, 02…) no fim.

import { MUNICIPIOS } from "./dados/municipios";
import { norm, semAcentos, semelhanca } from "./texto";

export const TIPOS = [
  { sigla: "CPS", nome: "Contrato de Prestação de Serviço" },
  { sigla: "CCD", nome: "Contrato de Curta Duração" },
  { sigla: "TC", nome: "Termo de Compromisso" },
];

// Funções com modelo de contrato (o modelo é carregado por quem usa a ferramenta).
// «BG» não consta da guia (que lista PF, SL, INQ e FORM); vem do nome do ficheiro do modelo.
export const FUNCOES = [
  { sigla: "BG", nome: "Brigadista" },
  { sigla: "PF", nome: "Ponto Focal" },
];

export const FORMATO_PADRAO = "{TIPO}-{PROV}-{MUN}-{FUNC}-{SEQ}.{SUBSEQ}/{ANO}/{ORDEM}";

export const PROVINCIAS = [
  ...new Map(
    MUNICIPIOS.map((m) => [m.siglaProv, { sigla: m.siglaProv, nome: m.provincia, seq: m.seq }]),
  ).values(),
];

export function municipiosDe(siglaProv) {
  return MUNICIPIOS.filter((m) => m.siglaProv === siglaProv);
}

export function acharMunicipio(siglaProv, siglaMun) {
  return MUNICIPIOS.find((m) => m.siglaProv === siglaProv && m.siglaMun === siglaMun) || null;
}

export function formatarCodigo(formato, partes) {
  return formato.replace(/\{(\w+)\}/g, (tudo, chave) => (chave in partes ? partes[chave] : tudo));
}

// ---------- Correspondência de nomes de municípios ----------

/** Chave fonética simples: «KILAMBA KIAXI» e «Quilamba Quiaxi» dão a mesma chave. */
export function chaveLocal(s) {
  let c = semAcentos(String(s ?? "").replace(/[çÇ]/g, "S")).toUpperCase();
  c = c.replace(/[^A-Z]/g, "");
  c = c
    .replace(/QU/g, "K")
    .replace(/C(?=[AOU])/g, "K")
    .replace(/C(?=[EI])/g, "S")
    .replace(/CK/g, "K");
  c = c.replace(/W/g, "U").replace(/Y/g, "I").replace(/NH/g, "N").replace(/Z/g, "S");
  c = c.replace(/(.)\1+/g, "$1");
  return c;
}

// Distritos urbanos que aparecem nos BI como residência e pertencem ao município de Luanda.
const DISTRITOS = {
  INGOMBOTA: ["LUA", "LUA"],
  MAIANGA: ["LUA", "LUA"],
  RANGEL: ["LUA", "LUA"],
  SAMBIZANGA: ["LUA", "LUA"],
  SAMBA: ["LUA", "LUA"],
  "NGOLA KILUANJE": ["LUA", "LUA"],
};

const INDICE = MUNICIPIOS.map((m) => ({ m, chave: chaveLocal(m.municipio) }));

/**
 * Procura na lista oficial o município escrito num BI ou no nome de uma pasta.
 * Devolve { municipio, exacto } ou null. Os nomes dos 165 municípios são únicos
 * no país, por isso o município também determina a província.
 */
export function procurarMunicipio(texto) {
  const chave = chaveLocal(texto);
  if (chave.length < 3) return null;
  const exacto = INDICE.find((x) => x.chave === chave);
  if (exacto) return { municipio: exacto.m, exacto: true };

  const d = Object.entries(DISTRITOS).find(([nome]) => chaveLocal(nome) === chave);
  if (d) return { municipio: acharMunicipio(d[1][0], d[1][1]), exacto: false };

  let melhor = null;
  let segundo = 0;
  for (const x of INDICE) {
    const s = semelhanca(chave, x.chave);
    if (!melhor || s > melhor.s) {
      segundo = melhor ? melhor.s : 0;
      melhor = { s, m: x.m };
    } else if (s > segundo) segundo = s;
  }
  if (melhor && melhor.s >= 0.8 && melhor.s - segundo >= 0.08)
    return { municipio: melhor.m, exacto: false };
  return null;
}

/** Procura um município (ou só a província) nas pastas do caminho de um ficheiro. */
export function procurarNoCaminho(caminho) {
  const pastas = String(caminho ?? "")
    .split(/[\\/]/)
    .slice(0, -1)
    .reverse();
  let provincia = null;
  for (const pasta of pastas) {
    const pedacos = [pasta, ...pasta.split(/\s+[-–—]\s+|_/)].map((p) => p.trim()).filter(Boolean);
    for (const p of pedacos) {
      const chave = chaveLocal(p);
      const exacto = INDICE.filter((x) => x.chave === chave);
      if (exacto.length) {
        // O nome de uma pasta pode ser ao mesmo tempo província e município (ex.: «Luanda»):
        // só se assume o município se não houver ambiguidade com a província.
        const m = exacto[0].m;
        const tambemProvincia = PROVINCIAS.some((pr) => chaveLocal(pr.nome) === chave);
        if (!tambemProvincia) return { municipio: m, provincia: m.siglaProv };
        provincia ??= PROVINCIAS.find((pr) => chaveLocal(pr.nome) === chave).sigla;
        continue;
      }
      const prov = PROVINCIAS.find((pr) => chaveLocal(pr.nome) === chave || pr.sigla === norm(p));
      if (prov) provincia ??= prov.sigla;
    }
  }
  return provincia ? { municipio: null, provincia } : null;
}

// ---------- Atribuição da ordem ----------

/**
 * Calcula o código de cada pessoa. As pessoas com o mesmo tipo, município e função
 * recebem a ordem 01, 02… pelo critério escolhido (alfabético por omissão, para o
 * resultado ser sempre o mesmo com os mesmos dados).
 *
 * @param pessoas [{ id, nome, provincia, municipio, funcao, posicao }]
 * @returns Map id → { codigo, ordem, grupo, totalNoGrupo } (codigo = '' se faltar colocação)
 */
export function atribuirCodigos(pessoas, cfg) {
  const grupos = new Map();
  const saida = new Map();
  for (const p of pessoas) {
    const mun = acharMunicipio(p.provincia, p.municipio);
    if (!mun || !p.funcao) {
      saida.set(p.id, { codigo: "", ordem: 0, grupo: "", totalNoGrupo: 0 });
      continue;
    }
    const chave = `${cfg.tipo}|${mun.siglaProv}|${mun.siglaMun}|${p.funcao}`;
    if (!grupos.has(chave)) grupos.set(chave, { mun, itens: [] });
    grupos.get(chave).itens.push(p);
  }
  const ordenar =
    cfg.criterioOrdem === "carregamento"
      ? (a, b) => a.posicao - b.posicao
      : (a, b) => norm(a.nome).localeCompare(norm(b.nome)) || a.posicao - b.posicao;
  for (const [chave, { mun, itens }] of grupos) {
    itens.sort(ordenar);
    itens.forEach((p, i) => {
      const ordem = i + 1;
      const codigo = formatarCodigo(cfg.formato, {
        TIPO: cfg.tipo,
        PROV: mun.siglaProv,
        MUN: mun.siglaMun,
        FUNC: p.funcao,
        SEQ: mun.seq,
        SUBSEQ: mun.subseq,
        ANO: String(cfg.ano).padStart(2, "0").slice(-2),
        ORDEM: String(ordem).padStart(2, "0"),
      });
      saida.set(p.id, { codigo, ordem, grupo: chave, totalNoGrupo: itens.length });
    });
  }
  return saida;
}
