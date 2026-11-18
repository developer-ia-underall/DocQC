// @ts-nocheck — portado do contratos-bi (JavaScript); a lógica está coberta pelos testes em src/test/contratos.test.ts.
// Leitura dos BI no próprio browser: pdf.js desenha as páginas, o Tesseract lê o texto.
// Nenhum ficheiro sai do computador.
//
// Cada página passa por:
//   1. leitura rápida   → orientação, inclinação, tamanho da letra e zona do cartão
//   2. três leituras     → imagem endireitada, recortada e com a letra no tamanho ideal,
//                          lida três vezes de formas diferentes; se as leituras não
//                          coincidirem num campo, esse campo fica «a rever»
//   3. n.º do BI         → lido mais duas vezes, isolado, e decidido por maioria.

import { setupPdfWorker } from "@/lib/pdf-worker";
import {
  interpretarBI,
  contarPalavrasChave,
  alturaMaiusculas,
  normalizarNumeroBI,
} from "./bi-parser";

// O Tesseract (worker, núcleo WASM) e o dicionário de português são servidos de public/contratos/.
const caminho = (rel) =>
  new URL(`/contratos/${rel}`, window.location.origin).href.replace(/\/$/, "");

// pdf.js vem do pdfjs-dist do DocQC, carregado só quando é preciso (não corre no servidor).
let pdfjsPromessa = null;
function carregarPdfjs() {
  pdfjsPromessa ??= import("pdfjs-dist").then(async (pdfjs) => {
    await setupPdfWorker(pdfjs);
    return pdfjs;
  });
  return pdfjsPromessa;
}

// tesseract.min.js expõe window.Tesseract; injeta-se o script na primeira leitura.
let tesseractPromessa = null;
function carregarTesseract() {
  tesseractPromessa ??= new Promise((ok, erro) => {
    if (window.Tesseract) return ok(window.Tesseract);
    const s = document.createElement("script");
    s.src = caminho("vendor/tesseract/tesseract.min.js");
    s.onload = () =>
      window.Tesseract ? ok(window.Tesseract) : erro(new Error("Tesseract não carregou"));
    s.onerror = () => erro(new Error("Não foi possível carregar o leitor de texto (Tesseract)."));
    document.head.append(s);
  });
  return tesseractPromessa;
}

const LADO_MAX_FONTE = 2600; // píxeis do lado maior da página desenhada
const LADO_MAX_PASSO1 = 1700;
const ALTURA_LETRA_IDEAL = 27; // altura das maiúsculas (px) com que o Tesseract lê melhor
const MAX_PAGINAS = 4;

// ---------- Canvas ----------

function novoCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function redimensionar(fonte, escala) {
  const c = novoCanvas(fonte.width * escala, fonte.height * escala);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fonte, 0, 0, c.width, c.height);
  return c;
}

function rodar90(fonte, graus) {
  if (!graus) return fonte;
  const troca = graus === 90 || graus === 270;
  const c = novoCanvas(troca ? fonte.height : fonte.width, troca ? fonte.width : fonte.height);
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((graus * Math.PI) / 180);
  ctx.drawImage(fonte, -fonte.width / 2, -fonte.height / 2);
  return c;
}

/**
 * Prepara a imagem para o OCR:
 *  - cinzento pelo canal mais claro (máx. de R, G, B): a faixa amarela e os fundos
 *    coloridos do BI ficam claros e o texto preto mantém-se escuro;
 *  - fundo nivelado: cada píxel é dividido pela claridade à sua volta, para que
 *    sombras, mesas escuras ou a folha branca à volta da foto não escondam o texto.
 */
function cinzento(fonte) {
  const w = fonte.width;
  const h = fonte.height;
  const c = novoCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(fonte, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = Math.max(d[i], d[i + 1], d[i + 2]);

  // Claridade local: máximo em blocos de B×B píxeis, suavizado.
  const B = 16;
  const bw = Math.ceil(w / B);
  const bh = Math.ceil(h / B);
  const blocos = new Float32Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const by = (y / B) | 0;
    for (let x = 0; x < w; x++) {
      const k = by * bw + ((x / B) | 0);
      const v = g[y * w + x];
      if (v > blocos[k]) blocos[k] = v;
    }
  }
  const suave = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let soma = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = Math.min(bh - 1, Math.max(0, y + dy));
          const xx = Math.min(bw - 1, Math.max(0, x + dx));
          soma += blocos[yy * bw + xx];
          n++;
        }
      }
      suave[y * bw + x] = soma / n;
    }
  }
  // Interpolação bilinear da claridade local e divisão.
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / B - 0.5));
    const y0 = fy | 0;
    const y1 = Math.min(bh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / B - 0.5));
      const x0 = fx | 0;
      const x1 = Math.min(bw - 1, x0 + 1);
      const tx = fx - x0;
      const cima = suave[y0 * bw + x0] * (1 - tx) + suave[y0 * bw + x1] * tx;
      const baixo = suave[y1 * bw + x0] * (1 - tx) + suave[y1 * bw + x1] * tx;
      const fundo = Math.max(48, cima * (1 - ty) + baixo * ty);
      const v = Math.min(255, (g[y * w + x] * 235) / fundo);
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function recortar(fonte, caixa, escala = 1, margem = 0) {
  const x0 = Math.max(0, Math.floor(caixa.x0 - margem));
  const y0 = Math.max(0, Math.floor(caixa.y0 - margem));
  const x1 = Math.min(fonte.width, Math.ceil(caixa.x1 + margem));
  const y1 = Math.min(fonte.height, Math.ceil(caixa.y1 + margem));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const borda = 16;
  const c = novoCanvas(w * escala + 2 * borda, h * escala + 2 * borda);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fonte, x0, y0, w, h, borda, borda, w * escala, h * escala);
  return c;
}

function paraBlob(canvas, tipo = "image/jpeg", qualidade = 0.86) {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, qualidade));
}

// ---------- Páginas de um ficheiro ----------

async function paginasDoPdf(ficheiro) {
  const dados = new Uint8Array(await ficheiro.arrayBuffer());
  const pdfjsLib = await carregarPdfjs();
  const pdf = await pdfjsLib.getDocument({
    data: dados,
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: false,
  }).promise;
  const paginas = [];
  try {
    const total = Math.min(pdf.numPages, MAX_PAGINAS);
    for (let n = 1; n <= total; n++) {
      const pagina = await pdf.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const escala = LADO_MAX_FONTE / Math.max(base.width, base.height);
      const vista = pagina.getViewport({ scale: escala });
      const canvas = novoCanvas(vista.width, vista.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pagina.render({ canvas, canvasContext: ctx, viewport: vista }).promise;
      paginas.push(canvas);
      pagina.cleanup();
    }
    return { paginas, paginasIgnoradas: Math.max(0, pdf.numPages - MAX_PAGINAS) };
  } finally {
    await pdf.destroy();
  }
}

async function paginaDaImagem(ficheiro) {
  const bitmap = await createImageBitmap(ficheiro, { imageOrientation: "from-image" });
  const escala = Math.min(1, LADO_MAX_FONTE / Math.max(bitmap.width, bitmap.height));
  const canvas = novoCanvas(bitmap.width * escala, bitmap.height * escala);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return { paginas: [canvas], paginasIgnoradas: 0 };
}

export function tipoDeFicheiro(ficheiro) {
  const nome = ficheiro.name.toLowerCase();
  if (ficheiro.type === "application/pdf" || nome.endsWith(".pdf")) return "pdf";
  if (/^image\/(jpeg|png|webp)$/.test(ficheiro.type) || /\.(jpe?g|png|webp)$/.test(nome))
    return "imagem";
  return null;
}

// ---------- Tesseract ----------

function linhasDe(dados) {
  let linhas = dados.lines;
  if (!linhas?.length && dados.blocks) {
    linhas = dados.blocks.flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
  }
  return (linhas || [])
    .map((l) => ({
      texto: (l.text || "").trim(),
      conf: l.confidence,
      x0: l.bbox.x0,
      y0: l.bbox.y0,
      x1: l.bbox.x1,
      y1: l.bbox.y1,
      base: l.baseline,
      palavras: (l.words || [])
        .filter((w) => (w.text || "").trim())
        .map((w) => ({
          texto: w.text.trim(),
          conf: w.confidence,
          x0: w.bbox.x0,
          y0: w.bbox.y0,
          x1: w.bbox.x1,
          y1: w.bbox.y1,
        })),
    }))
    .filter((l) => l.palavras.length);
}

async function ler(worker, canvas, { modo = "3", letras = "", nota = "" } = {}) {
  await worker.setParameters({ tessedit_pageseg_mode: modo, tessedit_char_whitelist: letras });
  const { data } = await worker.recognize(
    canvas,
    {},
    { text: true, blocks: true, hocr: false, tsv: false },
  );
  // Para afinar o leitor: window.__depurarOCR = [] na consola regista cada leitura.
  if (nota && Array.isArray(globalThis.__depurarOCR))
    globalThis.__depurarOCR.push({ nota, texto: data.text, imagem: canvas.toDataURL("image/png") });
  return { texto: data.text || "", linhas: linhasDe(data) };
}

function mediana(v) {
  if (!v.length) return 0;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
}

/** Inclinação do texto em radianos (positiva = desce para a direita). */
function inclinacao(linhas, H) {
  const angulos = [];
  for (const l of linhas) {
    if (l.palavras.length < 2 || l.x1 - l.x0 < 6 * H || l.conf < 55) continue;
    let dx;
    let dy;
    if (l.base && l.base.x1 - l.base.x0 > 4 * H) {
      dx = l.base.x1 - l.base.x0;
      dy = l.base.y1 - l.base.y0;
    } else {
      const a = l.palavras[0];
      const b = l.palavras[l.palavras.length - 1];
      dx = (b.x0 + b.x1) / 2 - (a.x0 + a.x1) / 2;
      dy = b.y1 - a.y1;
    }
    if (dx > 0) angulos.push(Math.atan2(dy, dx));
  }
  return angulos.length >= 2 ? mediana(angulos) : 0;
}

function caixaDoTexto(linhas, H, largura, alturaPagina) {
  const boas = linhas.flatMap((l) => l.palavras).filter((p) => p.conf >= 55 && p.texto.length >= 3);
  if (!boas.length) return { x0: 0, y0: 0, x1: largura, y1: alturaPagina };
  const x0 = Math.min(...boas.map((p) => p.x0));
  const y0 = Math.min(...boas.map((p) => p.y0));
  const x1 = Math.max(...boas.map((p) => p.x1));
  const y1 = Math.max(...boas.map((p) => p.y1));
  return {
    x0: Math.max(0, x0 - 4 * H),
    y0: Math.max(0, y0 - 6 * H),
    x1: Math.min(largura, Math.max(x1 + 4 * H, x0 + 46 * H)),
    y1: Math.min(alturaPagina, y1 + 8 * H),
  };
}

/** Desenha a zona `caixa` da fonte, rodada de -angulo e ampliada por `f`. */
function endireitarERecortar(fonte, caixa, angulo, f) {
  const cx = fonte.width / 2;
  const cy = fonte.height / 2;
  const cos = Math.cos(-angulo);
  const sin = Math.sin(-angulo);
  const cantos = [
    [caixa.x0, caixa.y0],
    [caixa.x1, caixa.y0],
    [caixa.x1, caixa.y1],
    [caixa.x0, caixa.y1],
  ].map(([x, y]) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  }));
  const bx = Math.min(...cantos.map((p) => p.x));
  const by = Math.min(...cantos.map((p) => p.y));
  const bw = Math.max(...cantos.map((p) => p.x)) - bx;
  const bh = Math.max(...cantos.map((p) => p.y)) - by;
  const c = novoCanvas(bw * f, bh * f);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.scale(f, f);
  ctx.translate(-bx, -by);
  ctx.translate(cx, cy);
  ctx.rotate(-angulo);
  ctx.translate(-cx, -cy);
  ctx.drawImage(fonte, 0, 0);
  return c;
}

/** Leitura completa de uma página. Devolve os campos encontrados e a imagem do cartão. */
async function lerPagina(worker, fonteOriginal) {
  // ----- 1. Leitura rápida: orientação, inclinação, tamanho da letra -----
  let fonte = fonteOriginal;
  let rotacao = 0;
  let passo1 = null;
  let melhor = null;
  for (const graus of [0, 90, 270, 180]) {
    const rodada = rodar90(fonteOriginal, graus);
    const s1 = Math.min(1, LADO_MAX_PASSO1 / Math.max(rodada.width, rodada.height));
    const r = await ler(worker, cinzento(redimensionar(rodada, s1)));
    const chaves = contarPalavrasChave(r.linhas);
    if (!melhor || chaves > melhor.chaves) melhor = { chaves, graus, rodada, s1, linhas: r.linhas };
    if (chaves >= 4) break;
  }
  if (!melhor || melhor.chaves < 2)
    return { lido: false, motivo: "Não foi encontrado texto de um BI nesta página." };
  ({ rodada: fonte, graus: rotacao } = melhor);
  passo1 = melhor;

  const angulo = inclinacao(passo1.linhas, alturaMaiusculas(passo1.linhas));
  const H1 = alturaMaiusculas(passo1.linhas, angulo);
  const paraFonte = (v) => v / passo1.s1;
  const HF = paraFonte(H1);
  const c1 = caixaDoTexto(passo1.linhas, H1, fonte.width * passo1.s1, fonte.height * passo1.s1);
  const caixa = {
    x0: paraFonte(c1.x0),
    y0: paraFonte(c1.y0),
    x1: paraFonte(c1.x1),
    y1: paraFonte(c1.y1),
  };

  // ----- 2. Leitura principal -----
  let f = Math.min(3.2, Math.max(0.3, ALTURA_LETRA_IDEAL / HF));
  const ladoMaior = Math.max(caixa.x1 - caixa.x0, caixa.y1 - caixa.y0) * f;
  if (ladoMaior > 3400) f *= 3400 / ladoMaior;
  const cartao = endireitarERecortar(fonte, caixa, Math.abs(angulo) > 0.006 ? angulo : 0, f);
  const cinza = cinzento(cartao);

  // Três leituras independentes (escala e divisão em linhas diferentes). Um campo só fica
  // com confiança alta quando as leituras coincidem; se divergirem, fica «a rever».
  const VARIANTES = [
    { esc: 1, modo: "3" },
    { esc: 1.15, modo: "6" },
    { esc: 0.9, modo: "4" },
  ];
  const leituras = [];
  for (const v of VARIANTES) {
    const img = v.esc === 1 ? cinza : redimensionar(cinza, v.esc);
    const r = interpretarBI(
      (await ler(worker, img, { modo: v.modo, nota: `leitura ${v.esc}/${v.modo}` })).linhas,
    );
    const paraBase = (c) =>
      c && { x0: c.x0 / v.esc, y0: c.y0 / v.esc, x1: c.x1 / v.esc, y1: c.y1 / v.esc };
    for (const c of Object.values(r.campos)) if (c?.caixa) c.caixa = paraBase(c.caixa);
    r.zonaNumero = paraBase(r.zonaNumero);
    r.alturaLetra /= v.esc;
    leituras.push(r);
  }
  const bi = {
    temFrente:
      leituras.filter((r) => r.temFrente).length >= 2 ||
      (leituras[0].temFrente && Boolean(leituras[0].campos.numero?.valido)),
    temVerso: leituras.filter((r) => r.temVerso).length >= 2,
  };
  const H = leituras[0].alturaLetra;
  const campos = {};
  const texto = (k, c) => (k === "residencia" ? c.linhas.join(" / ") : c.valor);

  for (const k of ["nome", "residencia", "emitido", "valido"]) {
    const lidos = leituras.map((r) => r.campos[k]).filter(Boolean);
    if (!lidos.length) continue;
    const grupos = new Map();
    for (const c of lidos) {
      const t = texto(k, c);
      if (!grupos.has(t)) grupos.set(t, []);
      grupos.get(t).push(c);
    }
    const ordem = [...grupos.entries()].sort(
      (x, y) =>
        y[1].length - x[1].length ||
        Math.max(...y[1].map((c) => c.conf)) - Math.max(...x[1].map((c) => c.conf)),
    );
    const [, iguais] = ordem[0];
    const escolhido = { ...iguais.reduce((m, c) => (c.conf > m.conf ? c : m)) };
    if (ordem.length > 1) {
      escolhido.conf = Math.min(escolhido.conf, iguais.length >= 2 ? 60 : 35);
      escolhido.duvida = `as leituras não coincidiram: ${ordem.map((o) => `«${o[0]}»`).join(" ou ")}`;
    } else if (iguais.length === 1) {
      escolhido.conf = Math.min(escolhido.conf, 55);
      escolhido.duvida = "só uma das três leituras apanhou este campo";
    } else if (iguais.length === VARIANTES.length) {
      escolhido.conf = Math.max(escolhido.conf, 85); // três leituras iguais
    }
    campos[k] = escolhido;
  }

  // N.º do BI: além das três leituras, lê-se a linha isolada e reduzida (a letra é maior
  // que a do resto do cartão), só com letras e algarismos.
  const numeros = leituras.map((r) => r.campos.numero).filter(Boolean);
  const zona =
    numeros.find((n) => n.valido)?.caixa ||
    numeros[0]?.caixa ||
    leituras.map((r) => r.zonaNumero).find(Boolean);
  if (zona) {
    const votos = new Map();
    const votar = (valor) => votos.set(valor, (votos.get(valor) || 0) + 1);
    for (const n of numeros) if (n.valido) votar(n.valor);
    for (const escala of [0.5, 0.62]) {
      const r = await ler(worker, recortar(cinza, zona, escala, 0.45 * H), {
        modo: "7",
        letras: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        nota: `numero x${escala}`,
      });
      const n = normalizarNumeroBI(r.texto);
      if (n && !n.aproximado) votar(n.valor);
    }
    const ordem = [...votos.entries()].sort((x, y) => y[1] - x[1]);
    if (ordem.length) {
      const [valor, n] = ordem[0];
      const unanime = ordem.length === 1;
      const empate = !unanime && ordem[1][1] === n;
      campos.numero = {
        valor,
        valido: true,
        caixa: zona,
        conf: unanime && n >= 3 ? 96 : unanime && n === 2 ? 75 : empate ? 20 : 55,
        duvida: unanime
          ? n >= 2
            ? ""
            : "só uma das leituras apanhou o número completo"
          : `as leituras não coincidiram: ${ordem.map((o) => `${o[0]} (${o[1]}×)`).join(" ou ")}`,
      };
    } else {
      const bruto = numeros.find((x) => x.valor)?.valor || "";
      campos.numero = {
        valor: bruto,
        valido: false,
        caixa: zona,
        conf: 0,
        duvida: "o número não foi lido por completo",
      };
    }
  }

  const imagem = await paraBlob(cartao);
  const caixas = {};
  for (const [k, c] of Object.entries(campos)) {
    if (c?.caixa)
      caixas[k] = {
        x: c.caixa.x0 / cartao.width,
        y: c.caixa.y0 / cartao.height,
        w: (c.caixa.x1 - c.caixa.x0) / cartao.width,
        h: (c.caixa.y1 - c.caixa.y0) / cartao.height,
      };
  }
  return {
    lido: true,
    temFrente: bi.temFrente || Boolean(campos.nome || campos.numero?.valido),
    temVerso: bi.temVerso || Boolean(campos.residencia || campos.emitido || campos.valido),
    campos,
    caixas,
    imagem,
    largura: cartao.width,
    altura: cartao.height,
    rotacao,
    inclinacaoGraus: Math.round(((angulo * 180) / Math.PI) * 10) / 10,
  };
}

// ---------- Leitor com vários workers ----------

export class LeitorBI {
  constructor({ workers } = {}) {
    const nucleos = navigator.hardwareConcurrency || 4;
    this.total = workers || Math.max(1, Math.min(4, nucleos - 1));
    this.livres = [];
    this.espera = [];
    this.todos = [];
    this.pronto = null;
  }

  iniciar(aoProgredir) {
    this.pronto ??= (async () => {
      const opcoes = {
        workerPath: caminho("vendor/tesseract/worker.min.js"),
        corePath: caminho("vendor/tesseract"),
        langPath: caminho("tessdata"),
        gzip: true,
        workerBlobURL: false,
      };
      const Tesseract = await carregarTesseract();
      // O primeiro worker descarrega e guarda o dicionário; os outros reutilizam-no.
      const primeiro = await Tesseract.createWorker("por", 1, {
        ...opcoes,
        logger: (m) => aoProgredir?.(m),
      });
      this.todos.push(primeiro);
      const resto = await Promise.all(
        Array.from({ length: this.total - 1 }, () => Tesseract.createWorker("por", 1, opcoes)),
      );
      this.todos.push(...resto);
      this.livres.push(...this.todos);
    })();
    return this.pronto;
  }

  async #comWorker(tarefa) {
    await this.iniciar();
    const worker = this.livres.pop() ?? (await new Promise((resolve) => this.espera.push(resolve)));
    try {
      return await tarefa(worker);
    } finally {
      const seguinte = this.espera.shift();
      if (seguinte) seguinte(worker);
      else this.livres.push(worker);
    }
  }

  /** Lê um ficheiro (PDF ou imagem) e devolve o resultado de cada página. */
  async lerFicheiro(ficheiro) {
    const tipo = tipoDeFicheiro(ficheiro);
    if (!tipo) throw new Error("Tipo de ficheiro não suportado (use PDF, JPG ou PNG).");
    return this.#comWorker(async (worker) => {
      const { paginas, paginasIgnoradas } =
        tipo === "pdf" ? await paginasDoPdf(ficheiro) : await paginaDaImagem(ficheiro);
      const resultados = [];
      for (const canvas of paginas) {
        resultados.push(await lerPagina(worker, canvas));
        canvas.width = canvas.height = 0; // liberta memória
      }
      return { paginas: resultados, paginasIgnoradas };
    });
  }

  async terminar() {
    await Promise.all(this.todos.map((w) => w.terminate()));
    this.todos = [];
    this.livres = [];
    this.pronto = null;
  }
}
