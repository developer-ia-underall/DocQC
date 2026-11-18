// @ts-nocheck — lógica portada do contratos-bi (app.js) sem DOM; os tipos exportados abaixo são os que a UI usa.
//
// Estado do módulo «Contratos (BI)»: BI carregados, leitura (OCR no browser), validação, consulta do NIF,
// códigos de contrato e exportação. Fica ao nível do módulo, por isso continua a ler BI enquanto se navega
// noutras páginas do DocQC. A UI (src/routes/contratos.tsx) subscreve com useSyncExternalStore.

import { useSyncExternalStore } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import { saveFile, confirmAction } from "@/lib/platform";
import { decomporResidencia, comporMorada, textoCasa, FORMATO_BI } from "./bi-parser";
import {
  TIPOS,
  FUNCOES,
  FORMATO_PADRAO,
  PROVINCIAS,
  municipiosDe,
  acharMunicipio,
  procurarMunicipio,
  procurarNoCaminho,
  atribuirCodigos,
} from "./codigo";
import { preencherModelo, marcadoresDoModelo, escreverXlsx } from "./documentos";
import { norm, limpar, lerData } from "./texto";

export {
  TIPOS,
  FUNCOES,
  FORMATO_PADRAO,
  PROVINCIAS,
  municipiosDe,
  acharMunicipio,
  FORMATO_BI,
  comporMorada,
};

// ---------- Tipos usados pela UI ----------

export type EstadoPessoa = "ler" | "falta" | "rever" | "lido" | "confirmado";
export type CampoEditavel =
  | "nome"
  | "numero"
  | "emitido"
  | "valido"
  | "rua"
  | "casa"
  | "bairro"
  | "munRes"
  | "provincia"
  | "municipio"
  | "funcao";

export interface Cfg {
  tipo: string;
  ano: string;
  formato: string;
  funcao: string;
  limite: number;
  criterioOrdem: "alfabetica" | "carregamento";
  sugerir: boolean;
  inicio: string;
  fim: string;
  localData: string;
  consultarNif: boolean;
}

export interface DadosNif {
  nif: string;
  nome: string;
  tipo: string;
  estado: string;
  inadimplente: string;
  regimeIva: string;
  residente: string;
}
export interface ConsultaNif {
  estado: "aconsultar" | "ok" | "nao" | "erro";
  numero: string;
  dados?: DadosNif;
  msg?: string;
}

export interface Caixa {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ImagemBI {
  url: string;
  ficheiro: string;
  caixas: Record<string, Caixa | undefined>;
}

export interface Pessoa {
  id: number;
  posicao: number;
  ficheiros: string[];
  pendentes: number;
  lido: boolean;
  imagens: ImagemBI[];
  problemas: string[];
  confirmado: boolean;
  nome: string;
  numero: string;
  emitido: string;
  valido: string;
  rua: string;
  casa: string;
  bairro: string;
  munRes: string;
  provincia: string;
  municipio: string;
  funcao: string;
  origemColocacao: string;
  nif: ConsultaNif | null;
}

export interface Avaliacao {
  estado: EstadoPessoa;
  erros: string[];
  avisos: string[];
  campos: Partial<Record<CampoEditavel, { tipo: "erro" | "duvida"; msg: string }>>;
}

export interface CodigoPessoa {
  codigo: string;
  ordem: number;
  grupo: string;
  totalNoGrupo: number;
}

export const ESTADOS: Record<EstadoPessoa, string> = {
  ler: "A ler…",
  falta: "Em falta",
  rever: "A rever",
  lido: "Lido",
  confirmado: "Confirmado",
};

// ---------- Estado ----------

const CHAVE_CFG = "docqc:contratos:definicoes";
const CHAVE_MODELO = "docqc:contratos:modelo:";

export const CFG_PADRAO: Cfg = {
  tipo: "CPS",
  ano: String(new Date().getFullYear()).slice(-2),
  formato: FORMATO_PADRAO,
  funcao: "BG",
  limite: 2,
  criterioOrdem: "alfabetica",
  sugerir: true,
  inicio: "16/11/2026",
  fim: "14/05/2027",
  localData: "",
  consultarNif: true,
};

const noBrowser = typeof window !== "undefined";

const estado = {
  cfg: carregarCfg(),
  modelos: {} as Record<string, { nome: string; dados: Uint8Array }>,
  pessoas: [] as Pessoa[],
  leitura: { total: 0, feitos: 0 },
  codigos: new Map<number, CodigoPessoa>(),
  avaliacoes: new Map<number, Avaliacao>(),
  proximoId: 1,
  modelosCarregados: false,
};
let leitor = null;
let versao = 0;
const ouvintes = new Set<() => void>();

function emitir() {
  recalcular();
  versao++;
  ouvintes.forEach((l) => l());
}

function avisar(msg: string, tipo: "info" | "erro" | "ok" = "info") {
  if (tipo === "erro") toast.error(msg);
  else if (tipo === "ok") toast.success(msg);
  else toast(msg);
}

// ---------- Definições e modelos (guardados só neste browser) ----------

function carregarCfg(): Cfg {
  if (!noBrowser) return { ...CFG_PADRAO };
  try {
    return { ...CFG_PADRAO, ...JSON.parse(localStorage.getItem(CHAVE_CFG) || "{}") };
  } catch {
    return { ...CFG_PADRAO };
  }
}

function paraBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function deBase64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function carregarModelos() {
  if (estado.modelosCarregados || !noBrowser) return;
  estado.modelosCarregados = true;
  for (const f of FUNCOES) {
    try {
      const guardado = JSON.parse(localStorage.getItem(CHAVE_MODELO + f.sigla) || "null");
      if (guardado)
        estado.modelos[f.sigla] = { nome: guardado.nome, dados: deBase64(guardado.dados) };
    } catch {
      /* ignora modelo corrompido */
    }
  }
}

// ---------- Entrada de ficheiros ----------

export function tipoDeFicheiro(ficheiro: File): "pdf" | "imagem" | null {
  const nome = ficheiro.name.toLowerCase();
  if (ficheiro.type === "application/pdf" || nome.endsWith(".pdf")) return "pdf";
  if (/^image\/(jpeg|png|webp)$/.test(ficheiro.type) || /\.(jpe?g|png|webp)$/.test(nome))
    return "imagem";
  return null;
}

function chaveDoNome(nome) {
  let n = norm(nome.replace(/\.[^.]+$/, ""));
  n = n
    .replace(/\b(FRENTE|VERSO|FRONT|BACK|TRAS|COSTAS|ANVERSO|REVERSO)\b/g, " ")
    .replace(/\s+(F|V)$/, "");
  return n.replace(/\s+/g, " ").trim() || "BI";
}

async function ficheirosDeEntrada(entrada, prefixo = "") {
  if (entrada.isFile) {
    const f = await new Promise((ok, erro) => entrada.file(ok, erro));
    return [{ ficheiro: f, caminho: prefixo + f.name }];
  }
  const leitorPasta = entrada.createReader();
  const filhos = [];
  for (;;) {
    const lote = await new Promise((ok, erro) => leitorPasta.readEntries(ok, erro));
    if (!lote.length) break;
    filhos.push(...lote);
  }
  const saida = [];
  for (const filho of filhos)
    saida.push(...(await ficheirosDeEntrada(filho, `${prefixo}${entrada.name}/`)));
  return saida;
}

/** Ficheiros e pastas largados na página (mantém o caminho das pastas, que dá a colocação). */
export async function receberLargados(
  dt: DataTransfer,
): Promise<{ ficheiro: File; caminho: string }[]> {
  const entradas = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entradas.length) return [...dt.files].map((f) => ({ ficheiro: f, caminho: f.name }));
  const saida = [];
  for (const e of entradas) saida.push(...(await ficheirosDeEntrada(e)));
  return saida;
}

function avisoAoSair(e) {
  if (estado.pessoas.length) {
    e.preventDefault();
    e.returnValue = "";
  }
}

function adicionarFicheiros(itens: { ficheiro: File; caminho: string }[]) {
  const aceites = itens.filter(
    (i) => tipoDeFicheiro(i.ficheiro) && !i.ficheiro.name.startsWith("."),
  );
  const recusados = itens.length - aceites.length;
  if (!aceites.length) return avisar("Nenhum ficheiro PDF, JPG ou PNG encontrado.", "erro");
  aceites.sort((a, b) => a.caminho.localeCompare(b.caminho, "pt", { numeric: true }));
  const tarefas = [];
  for (const { ficheiro, caminho } of aceites) {
    const pasta = caminho.includes("/") ? caminho.slice(0, caminho.lastIndexOf("/")) : "";
    const chave = `${pasta}|${chaveDoNome(ficheiro.name)}`;
    let p = estado.pessoas.find((x) => x.chave === chave);
    if (p && p.ficheiros.includes(caminho)) continue; // já carregado
    if (!p) {
      p = novaPessoa(chave, caminho);
      estado.pessoas.push(p);
    }
    p.ficheiros.push(caminho);
    p.pendentes++;
    p.lido = false;
    tarefas.push({ p, ficheiro, caminho });
  }
  if (!tarefas.length) return avisar("Esses ficheiros já estavam carregados.");
  if (recusados) avisar(`${recusados} ficheiro(s) ignorado(s) por não serem PDF nem imagem.`);
  window.addEventListener("beforeunload", avisoAoSair);
  estado.leitura.total += tarefas.length;
  emitir();
  void lerTarefas(tarefas);
}

function novaPessoa(chave, caminho) {
  const p = {
    id: estado.proximoId++,
    posicao: estado.pessoas.length,
    chave,
    ficheiros: [],
    pendentes: 0,
    lido: false,
    bruto: {},
    imagens: [],
    problemas: [],
    temFrente: false,
    temVerso: false,
    editados: new Set(),
    duvidas: {},
    confirmado: false,
    nome: "",
    numero: "",
    emitido: "",
    valido: "",
    rua: "",
    casa: "",
    bairro: "",
    munRes: "",
    provincia: "",
    municipio: "",
    funcao: estado.cfg.funcao,
    origemColocacao: "",
    nif: null,
  };
  const daPasta = procurarNoCaminho(caminho);
  if (daPasta) {
    p.provincia = daPasta.provincia;
    if (daPasta.municipio) {
      p.municipio = daPasta.municipio.siglaMun;
      p.origemColocacao = "pasta";
    }
  }
  return p;
}

async function lerTarefas(tarefas) {
  try {
    const { LeitorBI } = await import("./ocr");
    leitor ??= new LeitorBI();
    await leitor.iniciar();
  } catch (e) {
    console.error(e);
    for (const { p } of tarefas) {
      p.pendentes = 0;
      p.problemas.push("O leitor de texto não arrancou.");
      concluir(p);
    }
    estado.leitura = { total: 0, feitos: 0 };
    avisar(
      "Não foi possível iniciar o leitor de texto (Tesseract). Recarrega a página e tenta de novo.",
      "erro",
    );
    emitir();
    return;
  }
  await Promise.all(
    tarefas.map(async ({ p, ficheiro, caminho }) => {
      try {
        const { paginas, paginasIgnoradas } = await leitor.lerFicheiro(ficheiro);
        if (!estado.pessoas.includes(p)) return; // removida entretanto
        integrar(p, paginas, ficheiro.name);
        if (paginasIgnoradas)
          p.problemas.push(`${ficheiro.name}: só foram lidas as primeiras páginas.`);
      } catch (e) {
        console.error(caminho, e);
        p.problemas.push(`${ficheiro.name}: não foi possível abrir o ficheiro.`);
      } finally {
        p.pendentes--;
        estado.leitura.feitos++;
        if (p.pendentes === 0) concluir(p);
        emitir();
      }
    }),
  );
  if (estado.leitura.feitos >= estado.leitura.total) estado.leitura = { total: 0, feitos: 0 };
  emitir();
}

function integrar(p, paginas, nomeFicheiro) {
  let algumaLida = false;
  for (const pag of paginas) {
    if (!pag.lido) continue;
    algumaLida = true;
    p.temFrente ||= pag.temFrente;
    p.temVerso ||= pag.temVerso;
    for (const [k, c] of Object.entries(pag.campos)) {
      if (!c) continue;
      const actual = p.bruto[k];
      const melhor =
        !actual ||
        (c.valido !== false && actual.valido === false) ||
        (c.conf > actual.conf && !(c.valido === false && actual.valido !== false));
      if (melhor) p.bruto[k] = c;
    }
    p.imagens.push({
      url: URL.createObjectURL(pag.imagem),
      caixas: pag.caixas,
      ficheiro: nomeFicheiro,
    });
  }
  if (!algumaLida) p.problemas.push(`${nomeFicheiro}: não foi encontrado texto de um BI.`);
}

/** Campo do formulário → campo lido no cartão (para assinalar a zona na imagem). */
export const CAMPO_BRUTO: Partial<Record<CampoEditavel, string>> = {
  nome: "nome",
  numero: "numero",
  emitido: "emitido",
  valido: "valido",
  rua: "residencia",
  casa: "residencia",
  bairro: "residencia",
  munRes: "residencia",
};

function concluir(p) {
  const b = p.bruto;
  const por = (campo, valor) => {
    if (!p.editados.has(campo)) p[campo] = valor ?? "";
  };
  por("nome", b.nome?.valor);
  por("numero", b.numero?.valor);
  por("emitido", b.emitido?.valor);
  por("valido", b.valido?.valor);
  if (b.residencia) {
    const r = decomporResidencia(b.residencia.linhas);
    por("rua", r.rua);
    por("casa", r.casa);
    por("bairro", r.bairro);
    por("munRes", r.municipio);
  }
  p.duvidas = {};
  for (const k of ["nome", "numero", "residencia", "emitido", "valido"]) {
    const c = b[k];
    if (!c) continue;
    if (c.duvida) p.duvidas[k] = c.duvida;
    else if (c.conf < 60) p.duvidas[k] = "leitura com pouca confiança";
  }
  if (!p.municipio && estado.cfg.sugerir && p.munRes) {
    const achado = procurarMunicipio(p.munRes);
    if (achado && (!p.provincia || p.provincia === achado.municipio.siglaProv)) {
      p.provincia = achado.municipio.siglaProv;
      p.municipio = achado.municipio.siglaMun;
      p.origemColocacao = achado.exacto ? "bi" : "bi-aprox";
    }
  }
  p.lido = true;
  p.confirmado = false;
  pedirNif(p);
}

// ---------- NIF (Portal do Contribuinte do MINFIN) ----------
// Só o n.º do BI sai do browser: vai para /api/nif (rota do DocQC), que consulta o portal.

const NIF_EM_PARALELO = 2; // para não sobrecarregar o portal
const filaNif = [];
let nifActivos = 0;

function pedirNif(p, forcar = false) {
  if (!estado.cfg.consultarNif && !forcar) return;
  const numero = p.numero;
  if (!FORMATO_BI.test(numero)) {
    p.nif = null;
    return;
  }
  if (!forcar && p.nif?.numero === numero && p.nif.estado !== "erro") return; // já consultado
  p.nif = { estado: "aconsultar", numero };
  filaNif.push(p);
  correrFilaNif();
}

function correrFilaNif() {
  while (nifActivos < NIF_EM_PARALELO && filaNif.length) {
    const p = filaNif.shift();
    if (!estado.pessoas.includes(p) || p.nif?.estado !== "aconsultar") continue;
    nifActivos++;
    consultarNif(p).finally(() => {
      nifActivos--;
      correrFilaNif();
    });
  }
}

async function consultarNif(p) {
  const numero = p.nif.numero;
  let r;
  try {
    const resp = await fetch(`/api/nif?bi=${encodeURIComponent(numero)}`, { cache: "no-store" });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok)
      r = { estado: "erro", msg: j.erro || `O serviço de consulta respondeu ${resp.status}.` };
    else
      r = j.encontrado
        ? { estado: "ok", dados: j }
        : { estado: "nao", msg: j.mensagem || "NIF não encontrado" };
  } catch {
    r = { estado: "erro", msg: "Sem ligação ao serviço de consulta do NIF." };
  }
  if (p.numero !== numero || p.nif?.numero !== numero) return; // o número foi corrigido entretanto
  p.nif = { ...r, numero };
  emitir();
}

const PARTICULAS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);
const palavras = (s) =>
  norm(s)
    .split(" ")
    .filter((x) => x && !PARTICULAS.has(x));

// O portal pode ter os nomes noutra ordem ou abreviados: basta que um conjunto de nomes contenha o outro.
function nomesCoincidem(a, b) {
  const pa = palavras(a);
  const pb = palavras(b);
  if (!pa.length || !pb.length) return true;
  return pa.every((x) => pb.includes(x)) || pb.every((x) => pa.includes(x));
}

export const nifActivo = (d: DadosNif) => !d.estado || /^(activ|ativ)/i.test(d.estado);
export const nifInadimplente = (d: DadosNif) => /^sim/i.test(d.inadimplente || "");

/** Consulta do NIF válida para o n.º actual (ignora resultados de um n.º entretanto corrigido). */
export const nifActual = (p: Pessoa): ConsultaNif | null =>
  p.nif?.numero === p.numero ? p.nif : null;

// ---------- Validação ----------

const ROTULO_DUVIDA = {
  nome: "Nome",
  numero: "N.º do BI",
  residencia: "Morada",
  emitido: "Data de emissão",
  valido: "Data de validade",
};

function avaliar(p, contexto): Avaliacao {
  if (!p.lido) return { estado: "ler", erros: [], avisos: [], campos: {} };
  const erros = [];
  const avisos = [];
  const campos = {};
  const erro = (campo, msg) => {
    erros.push(msg);
    if (campo) campos[campo] ??= { tipo: "erro", msg };
  };
  const aviso = (campo, msg) => {
    avisos.push(msg);
    if (campo) campos[campo] ??= { tipo: "duvida", msg };
  };

  if (!limpar(p.nome)) erro("nome", "Falta o nome.");
  if (!limpar(p.numero)) erro("numero", "Falta o n.º do BI.");
  else if (!FORMATO_BI.test(p.numero))
    erro("numero", "N.º do BI fora do formato (9 algarismos, 2 letras, 3 algarismos).");
  else if (contexto.numeros.get(p.numero) > 1)
    erro("numero", "N.º do BI repetido noutra pessoa da lista.");

  const emitido = lerData(p.emitido);
  const valido = lerData(p.valido);
  if (!limpar(p.emitido)) erro("emitido", "Falta a data de emissão.");
  else if (!emitido) erro("emitido", "Data de emissão inválida (DD/MM/AAAA).");
  if (!limpar(p.valido)) erro("valido", "Falta a data de validade.");
  else if (!valido) erro("valido", "Data de validade inválida (DD/MM/AAAA).");
  if (emitido && valido) {
    if (emitido >= valido) erro("valido", "A validade é anterior à emissão.");
    else if (contexto.inicio && valido < contexto.inicio)
      aviso("valido", `BI caducado antes do início do contrato (${estado.cfg.inicio}).`);
    else if (contexto.fim && valido < contexto.fim)
      aviso("valido", `O BI caduca durante o contrato (termina a ${estado.cfg.fim}).`);
    if (emitido > new Date()) aviso("emitido", "A data de emissão está no futuro.");
  }

  if (!limpar(p.rua) && !limpar(p.bairro) && !limpar(p.munRes)) erro("rua", "Falta a morada.");
  else if (!limpar(p.munRes)) aviso("munRes", "Falta o município de residência.");

  const mun = acharMunicipio(p.provincia, p.municipio);
  if (!mun) erro("municipio", "Falta o município de colocação (define o código do contrato).");
  if (!FUNCOES.some((f) => f.sigla === p.funcao)) erro("funcao", "Falta a função.");

  const cod = contexto.codigos.get(p.id);
  if (cod?.totalNoGrupo > estado.cfg.limite)
    aviso(
      "municipio",
      `Há ${cod.totalNoGrupo} pessoas com esta função neste município (o previsto são ${estado.cfg.limite}).`,
    );

  if (!p.confirmado) {
    for (const [k, msg] of Object.entries(p.duvidas)) {
      aviso(null, `${ROTULO_DUVIDA[k]}: ${msg}.`);
      for (const [campo, bruto] of Object.entries(CAMPO_BRUTO))
        if (bruto === k) campos[campo] ??= { tipo: "duvida", msg };
    }
    if (!p.temFrente) aviso(null, "Não foi lida a frente do BI (nome e número).");
    if (!p.temVerso) aviso(null, "Não foi lido o verso do BI (morada e datas).");
    if (p.origemColocacao === "bi-aprox")
      aviso("municipio", `Município de colocação sugerido por aproximação a «${p.munRes}».`);
    const n = nifActual(p);
    if (n?.estado === "nao") aviso(null, "NIF não encontrado no Portal do Contribuinte.");
    if (n?.estado === "ok") {
      const d = n.dados;
      if (d.nome && !nomesCoincidem(d.nome, p.nome))
        aviso("nome", `No Portal do Contribuinte o nome é «${d.nome}».`);
      if (!nifActivo(d)) aviso(null, `O NIF está «${d.estado}» no Portal do Contribuinte.`);
      if (nifInadimplente(d)) aviso(null, "Contribuinte inadimplente no Portal do Contribuinte.");
    }
    for (const msg of p.problemas) aviso(null, msg);
  }

  const est = erros.length
    ? "falta"
    : p.confirmado
      ? "confirmado"
      : avisos.length
        ? "rever"
        : "lido";
  return { estado: est, erros, avisos, campos };
}

function recalcular() {
  estado.codigos = atribuirCodigos(
    estado.pessoas.filter((p) => p.lido),
    estado.cfg,
  );
  const numeros = new Map();
  for (const p of estado.pessoas)
    if (p.lido && p.numero) numeros.set(p.numero, (numeros.get(p.numero) || 0) + 1);
  const contexto = {
    codigos: estado.codigos,
    numeros,
    inicio: lerData(estado.cfg.inicio),
    fim: lerData(estado.cfg.fim),
  };
  estado.avaliacoes = new Map(estado.pessoas.map((p) => [p.id, avaliar(p, contexto)]));
}

// ---------- Consultas para a UI ----------

export function nomeColocacao(p: Pessoa): string {
  const mun = acharMunicipio(p.provincia, p.municipio);
  if (mun) return `${mun.municipio}, ${mun.provincia}`;
  const prov = PROVINCIAS.find((x) => x.sigla === p.provincia);
  return prov ? `${prov.nome} (falta o município)` : "";
}

function pessoasOrdenadas(): Pessoa[] {
  return [...estado.pessoas].sort((a, b) => {
    const ca = estado.codigos.get(a.id)?.codigo || "";
    const cb = estado.codigos.get(b.id)?.codigo || "";
    if (!ca !== !cb) return ca ? 1 : -1;
    return ca.localeCompare(cb) || a.posicao - b.posicao;
  });
}

function seguinteAPrecisarDeAtencao(depoisDe: number): number | null {
  const ordem = pessoasOrdenadas().filter((p) => p.lido);
  const i = ordem.findIndex((p) => p.id === depoisDe);
  const candidatas = [...ordem.slice(i + 1), ...ordem.slice(0, Math.max(0, i))];
  return candidatas.find((p) => estado.avaliacoes.get(p.id).estado !== "confirmado")?.id ?? null;
}

// ---------- Exportação ----------

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const nomeSeguro = (s) => limpar(String(s).replace(/[\\/:*?"<>|]/g, "_"));

function valoresDoContrato(p) {
  return {
    CODIGO: estado.codigos.get(p.id).codigo,
    NOME: limpar(p.nome),
    MORADA: comporMorada({ rua: p.rua, casa: p.casa, bairro: p.bairro, municipio: p.munRes }),
    RESIDENCIA: limpar(p.rua),
    CASA: textoCasa(p.casa),
    BAIRRO: limpar(p.bairro),
    MUNICIPIO: limpar(p.munRes),
    BI: p.numero,
    EMITIDO: p.emitido,
    VALIDO: p.valido,
    LOCAL_DATA: limpar(estado.cfg.localData),
  };
}

function colunasNif(p) {
  const n = nifActual(p);
  const vazias = [{ v: "" }, { v: "" }, { v: "" }, { v: "" }];
  if (!n) return [{ v: "" }, ...vazias];
  if (n.estado === "aconsultar") return [{ v: "A consultar" }, ...vazias];
  if (n.estado !== "ok")
    return [
      { v: n.estado === "nao" ? "Não encontrado" : "Consulta falhou", estilo: "falta" },
      ...vazias,
    ];
  const d = n.dados;
  return [
    { v: d.nif, estilo: "mono" },
    { v: d.nome },
    { v: d.estado },
    { v: d.inadimplente, estilo: nifInadimplente(d) ? "falta" : undefined },
    { v: d.regimeIva },
  ];
}

async function construirResumo(gerados = null) {
  const colunas = [
    { titulo: "Estado", largura: 13 },
    { titulo: "Código do contrato", largura: 31 },
    { titulo: "Nome", largura: 36 },
    { titulo: "N.º do BI", largura: 18 },
    { titulo: "Emitido em", largura: 12 },
    { titulo: "Válido até", largura: 12 },
    { titulo: "NIF (Portal)", largura: 18 },
    { titulo: "Nome no Portal", largura: 36 },
    { titulo: "Estado do NIF", largura: 14 },
    { titulo: "Inadimplente", largura: 13 },
    { titulo: "Regime de IVA", largura: 34 },
    { titulo: "Morada no contrato", largura: 52 },
    { titulo: "Província", largura: 16 },
    { titulo: "Município", largura: 20 },
    { titulo: "Função", largura: 13 },
    { titulo: "Ordem", largura: 8 },
    { titulo: "A verificar", largura: 60 },
    { titulo: "Ficheiros do BI", largura: 40 },
    ...(gerados ? [{ titulo: "Contrato gerado", largura: 16 }] : []),
  ];
  const estilo = { confirmado: "ok", lido: "ok", rever: "rever", falta: "falta" };
  const linhas = pessoasOrdenadas()
    .filter((p) => p.lido)
    .map((p) => {
      const a = estado.avaliacoes.get(p.id);
      const cod = estado.codigos.get(p.id);
      const mun = acharMunicipio(p.provincia, p.municipio);
      const linha = [
        { v: ESTADOS[a.estado], estilo: estilo[a.estado] },
        { v: cod?.codigo || "", estilo: "mono" },
        { v: p.nome },
        { v: p.numero, estilo: "mono" },
        { v: p.emitido },
        { v: p.valido },
        ...colunasNif(p),
        { v: comporMorada({ rua: p.rua, casa: p.casa, bairro: p.bairro, municipio: p.munRes }) },
        { v: mun?.provincia || "" },
        { v: mun?.municipio || "" },
        { v: FUNCOES.find((f) => f.sigla === p.funcao)?.nome || "" },
        { v: cod?.ordem ? String(cod.ordem).padStart(2, "0") : "" },
        { v: [...a.erros, ...a.avisos].join(" ") },
        { v: p.ficheiros.join("; ") },
      ];
      if (gerados)
        linha.push({
          v: gerados.has(p.id) ? "Sim" : "Não",
          estilo: gerados.has(p.id) ? undefined : "falta",
        });
      return linha;
    });
  return escreverXlsx("Resumo", colunas, linhas);
}

async function gerarContratos(prontas, aoProgredir) {
  const zip = new JSZip();
  const gerados = new Set();
  const desconhecidos = new Set();
  let n = 0;
  for (const p of prontas) {
    aoProgredir?.(++n, prontas.length);
    const valores = valoresDoContrato(p);
    const r = await preencherModelo(estado.modelos[p.funcao].dados, valores);
    r.desconhecidos.forEach((d) => desconhecidos.add(d));
    const mun = acharMunicipio(p.provincia, p.municipio);
    zip.file(
      `Contratos/${nomeSeguro(mun.provincia)}/${nomeSeguro(valores.CODIGO)} - ${nomeSeguro(valores.NOME)}.docx`,
      r.dados,
    );
    gerados.add(p.id);
  }
  zip.file("Resumo dos contratos.xlsx", await construirResumo(gerados));
  const dados = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const hoje = new Date().toISOString().slice(0, 10);
  await saveFile(dados, `Contratos ${hoje}.zip`, "application/zip");
  avisar(
    `${gerados.size} contrato(s) gerado(s).${desconhecidos.size ? ` O modelo tem marcadores desconhecidos: ${[...desconhecidos].join(", ")}.` : ""}`,
    "ok",
  );
}

// ---------- API do módulo ----------

export const contratos = {
  subscribe(l: () => void) {
    carregarModelos();
    ouvintes.add(l);
    return () => void ouvintes.delete(l);
  },
  versao: () => versao,

  get cfg(): Cfg {
    return estado.cfg;
  },
  get modelos(): Record<string, { nome: string } | undefined> {
    carregarModelos();
    return estado.modelos;
  },
  get leitura(): { total: number; feitos: number } {
    return estado.leitura;
  },
  pessoas: (): Pessoa[] => pessoasOrdenadas(),
  temPessoas: (): boolean => estado.pessoas.length > 0,
  pessoa: (id: number | null): Pessoa | null => estado.pessoas.find((p) => p.id === id) ?? null,
  avaliacao: (id: number): Avaliacao =>
    estado.avaliacoes.get(id) ?? { estado: "ler", erros: [], avisos: [], campos: {} },
  codigo: (id: number): CodigoPessoa | undefined => estado.codigos.get(id),
  seguinte: (id: number): number | null => seguinteAPrecisarDeAtencao(id),

  adicionar(itens: { ficheiro: File; caminho: string }[]) {
    adicionarFicheiros(itens);
  },

  editar(id: number, campo: CampoEditavel, valor: string) {
    const p = estado.pessoas.find((x) => x.id === id);
    if (!p) return;
    if (campo === "numero") valor = valor.toUpperCase().replace(/\s/g, "");
    if (p[campo] === valor) return;
    p[campo] = valor;
    p.editados.add(campo);
    p.confirmado = false;
    if (CAMPO_BRUTO[campo]) delete p.duvidas[CAMPO_BRUTO[campo]];
    if (campo === "provincia") {
      p.municipio = "";
      p.origemColocacao = "";
    }
    if (campo === "municipio") p.origemColocacao = "manual";
    if (campo === "numero") {
      clearTimeout(p.temporizadorNif);
      p.temporizadorNif = setTimeout(() => {
        pedirNif(p);
        emitir();
      }, 700);
    }
    emitir();
  },

  confirmar(id: number): number {
    const p = estado.pessoas.find((x) => x.id === id);
    if (!p) return id;
    p.confirmado = true;
    emitir();
    return seguinteAPrecisarDeAtencao(id) ?? id;
  },

  remover(id: number, depois?: () => void) {
    const p = estado.pessoas.find((x) => x.id === id);
    if (!p) return;
    confirmAction(`Remover ${p.nome || "esta pessoa"} da lista?`, "Remover", () => {
      p.imagens.forEach((im) => URL.revokeObjectURL(im.url));
      estado.pessoas = estado.pessoas.filter((x) => x !== p);
      if (!estado.pessoas.length) window.removeEventListener("beforeunload", avisoAoSair);
      emitir();
      depois?.();
    });
  },

  consultarNif(id: number) {
    const p = estado.pessoas.find((x) => x.id === id);
    if (!p) return;
    pedirNif(p, true);
    emitir();
  },

  async definirModelo(sigla: string, ficheiro: File) {
    const dados = new Uint8Array(await ficheiro.arrayBuffer());
    let marcadores;
    try {
      marcadores = await marcadoresDoModelo(dados);
    } catch {
      return avisar("Este ficheiro não é um documento Word (.docx).", "erro");
    }
    if (!marcadores.length) {
      return avisar(
        "Este documento não tem marcadores como {{NOME}} e {{CODIGO}}. Usa os modelos preparados ou acrescenta os marcadores no Word.",
        "erro",
      );
    }
    estado.modelos[sigla] = { nome: ficheiro.name, dados };
    try {
      localStorage.setItem(
        CHAVE_MODELO + sigla,
        JSON.stringify({ nome: ficheiro.name, dados: paraBase64(dados) }),
      );
    } catch {
      /* fica só nesta sessão */
    }
    const emFalta = ["CODIGO", "NOME", "BI"].filter((m) => !marcadores.includes(m));
    avisar(
      emFalta.length
        ? `Modelo carregado, mas sem os marcadores ${emFalta.map((m) => `{{${m}}}`).join(", ")}.`
        : `Modelo de ${FUNCOES.find((f) => f.sigla === sigla).nome} carregado.`,
      emFalta.length ? "info" : "ok",
    );
    emitir();
  },

  guardarCfg(novo: Cfg) {
    const c = { ...estado.cfg, ...novo };
    c.ano = (String(c.ano).replace(/\D/g, "") || CFG_PADRAO.ano).padStart(2, "0").slice(-2);
    c.formato = limpar(c.formato) || FORMATO_PADRAO;
    c.limite = Math.max(1, Number(c.limite) || 2);
    c.inicio = lerData(c.inicio) ? c.inicio.trim() : "";
    c.fim = lerData(c.fim) ? c.fim.trim() : "";
    estado.cfg = c;
    try {
      localStorage.setItem(CHAVE_CFG, JSON.stringify(c));
    } catch {
      /* vale só para esta sessão */
    }
    if (c.consultarNif) estado.pessoas.filter((p) => p.lido).forEach((p) => pedirNif(p));
    emitir();
  },

  async descarregarResumo() {
    if (!estado.pessoas.some((p) => p.lido)) return avisar("Ainda não há BI lidos.");
    if (await saveFile(await construirResumo(), "Resumo dos contratos.xlsx", XLSX))
      avisar("Resumo descarregado.", "ok");
  },

  /**
   * Gera o .zip com os contratos. Devolve "modelos" se faltar carregar algum modelo (a UI abre as definições).
   * Se houver pessoas «a rever» ou «em falta», pede confirmação antes.
   */
  async descarregarContratos(
    aoProgredir?: (n: number, total: number) => void,
  ): Promise<"modelos" | void> {
    if (estado.leitura.total > estado.leitura.feitos)
      return avisar("Espera que a leitura dos BI termine.");
    const lidas = estado.pessoas.filter((p) => p.lido);
    const prontas = lidas.filter((p) => estado.avaliacoes.get(p.id).estado !== "falta");
    if (!prontas.length)
      return avisar("Não há nenhuma pessoa com todos os dados para gerar o contrato.", "erro");
    const semModelo = [...new Set(prontas.map((p) => p.funcao))].filter((f) => !estado.modelos[f]);
    if (semModelo.length) {
      avisar(
        `Falta carregar o modelo de contrato de ${semModelo.map((s) => FUNCOES.find((f) => f.sigla === s).nome).join(" e de ")}.`,
        "erro",
      );
      return "modelos";
    }
    const aRever = prontas.filter((p) => estado.avaliacoes.get(p.id).estado === "rever").length;
    const emFalta = lidas.length - prontas.length;
    const notas = [];
    if (aRever) notas.push(`${aRever} «a rever» (o contrato é gerado com os dados como estão)`);
    if (emFalta) notas.push(`${emFalta} «em falta» (ficam sem contrato)`);
    const correr = () =>
      gerarContratos(prontas, aoProgredir).catch((e) => {
        console.error(e);
        avisar(
          "Não foi possível gerar os contratos. Confirma que os modelos são .docx válidos.",
          "erro",
        );
      });
    if (notas.length) {
      await new Promise<void>((ok) => {
        confirmAction(
          `Atenção: ${notas.join("; ")}. Gerar os contratos mesmo assim?`,
          "Gerar",
          async () => {
            await correr();
            ok();
          },
        );
        setTimeout(ok, 8500); // o aviso fecha sozinho ao fim de 8 s
      });
      return;
    }
    await correr();
  },
};

/** Re-renderiza o componente sempre que o estado do módulo muda. */
export function useContratos() {
  useSyncExternalStore(contratos.subscribe, contratos.versao, () => 0);
  return contratos;
}
