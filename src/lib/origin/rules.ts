import type { Evidence } from "@/types/domain";
import type { OriginInput } from "@/lib/analysis/common";

export interface OriginRule {
  id: string;
  category: Evidence["category"];
  weight: number;
  /** Returns an evidence string when the rule fires. */
  test: (i: OriginInput) => string | null;
}

type Field = "producer" | "creator" | "creatorTool" | "application" | "author" | "lastModifiedBy";
const fields = (i: OriginInput, fs: Field[]) =>
  fs.map((f) => [f, i[f]] as const).filter(([, v]) => !!v) as [Field, string][];
const label: Record<Field, string> = {
  producer: "Producer",
  creator: "Creator",
  creatorTool: "CreatorTool",
  application: "Application",
  author: "Autor",
  lastModifiedBy: "Última modificação por",
};

/** Pattern rules: data-only definitions over metadata fields. */
const PATTERNS: {
  id: string;
  category: Evidence["category"];
  weight: number;
  re: RegExp;
  fields: Field[];
  note: string;
}[] = [
  {
    id: "ai.vendor-string",
    category: "ai",
    weight: 60,
    re: /chatgpt|openai|claude|anthropic|gemini|bard|copilot|perplexity|mistral|llama/i,
    fields: ["producer", "creator", "creatorTool", "application", "author", "lastModifiedBy"],
    note: "menciona diretamente um assistente de IA",
  },
  {
    id: "tool.python-docx",
    category: "tool",
    weight: 40,
    re: /python-docx/i,
    fields: ["creator", "lastModifiedBy", "application", "author"],
    note: "biblioteca Python usada por assistentes de IA para gerar Word",
  },
  {
    id: "tool.python-pptx",
    category: "tool",
    weight: 40,
    re: /python-pptx|^Steve Canny$/i,
    fields: ["creator", "lastModifiedBy", "application", "author"],
    note: "valor por omissão do modelo da biblioteca python-pptx",
  },
  {
    id: "tool.openpyxl",
    category: "tool",
    weight: 40,
    re: /openpyxl/i,
    fields: ["creator", "lastModifiedBy", "application", "author"],
    note: "biblioteca Python para Excel",
  },
  {
    id: "tool.docx-js",
    category: "tool",
    weight: 35,
    re: /^Un-named$|docx\.js|\bdocx\b.*js|officegen/i,
    fields: ["creator", "lastModifiedBy", "application", "author"],
    note: "biblioteca JavaScript de geração de Word",
  },
  {
    id: "tool.reportlab",
    category: "tool",
    weight: 35,
    re: /reportlab/i,
    fields: ["producer", "creator", "creatorTool"],
    note: "gerador de PDF programático em Python",
  },
  {
    id: "tool.fpdf",
    category: "tool",
    weight: 35,
    re: /\bfpdf|pypdf|pdfkit|pdf-lib|jspdf|itext/i,
    fields: ["producer", "creator", "creatorTool"],
    note: "biblioteca de geração de PDF por código",
  },
  {
    id: "tool.html-to-pdf",
    category: "tool",
    weight: 30,
    re: /wkhtmltopdf|weasyprint|puppeteer|headlesschrome|playwright|skia\/pdf|prince/i,
    fields: ["producer", "creator", "creatorTool"],
    note: "conversão HTML→PDF típica de pipelines automáticos",
  },
  {
    id: "tool.pandoc",
    category: "tool",
    weight: 25,
    re: /pandoc|xelatex|latex/i,
    fields: ["producer", "creator", "creatorTool", "application"],
    note: "conversão automática a partir de Markdown/LaTeX",
  },
  {
    id: "tool.libreoffice-headless",
    category: "tool",
    weight: 15,
    re: /libreoffice|openoffice/i,
    fields: ["producer", "creator", "application"],
    note: "LibreOffice é usado em modo headless em sandboxes de IA para converter ficheiros (também é usado por pessoas)",
  },
  {
    id: "human.office-app",
    category: "human",
    weight: -20,
    re: /microsoft.*(word|excel|powerpoint|office)|pages|keynote|numbers|google docs/i,
    fields: ["application", "creator", "producer", "creatorTool"],
    note: "aplicação de escritório interativa",
  },
];

export const RULES: OriginRule[] = [
  ...PATTERNS.map<OriginRule>((p) => ({
    id: p.id,
    category: p.category,
    weight: p.weight,
    test: (i) => {
      const hit = fields(i, p.fields).find(([, v]) => p.re.test(v));
      return hit ? `${label[hit[0]]} = "${hit[1]}" — ${p.note}.` : null;
    },
  })),
  {
    id: "tool.python-docx-template",
    category: "tool",
    weight: 20,
    test: (i) =>
      i.created?.startsWith("2013-12-23T23:15")
        ? `Data de criação ${i.created} — data fixa do modelo por omissão do python-docx.`
        : null,
  },
  {
    id: "ai.c2pa-assertion",
    category: "ai",
    weight: 70,
    test: (i) =>
      i.c2pa?.ai ? "Manifesto C2PA (Content Credentials) declara geração por IA." : null,
  },
  {
    id: "ai.iptc-source",
    category: "ai",
    weight: 65,
    test: (i) =>
      i.digitalSourceType && /trainedAlgorithmicMedia/i.test(i.digitalSourceType)
        ? `IPTC DigitalSourceType = ${i.digitalSourceType} — marcado como media gerado por algoritmo treinado.`
        : null,
  },
  {
    id: "ai.image-generator",
    category: "ai",
    weight: 45,
    test: (i) =>
      /DALL|Midjourney|Stable Diffusion|Firefly|ComfyUI|parameters:|Steps: \d+/i.test(i.allText)
        ? "Metadados da imagem referem um gerador de imagens ou parâmetros de geração."
        : null,
  },
  {
    id: "sandbox.author-generic",
    category: "sandbox",
    weight: 15,
    test: (i) => {
      if (i.kind === "image" || i.kind === "text") return null;
      const a = (i.author ?? "").trim();
      return !a
        ? "Autor vazio."
        : /^(root|user|sandbox|admin|ubuntu|runner|jovyan|python|unknown|anonymous)$/i.test(a)
          ? `Autor = "${a}" — nome de conta genérica de servidor/contentor.`
          : null;
    },
  },
  {
    id: "sandbox.path",
    category: "sandbox",
    weight: 25,
    test: (i) => {
      const m = i.allText.match(
        /\/mnt\/data|\/home\/oai|\/home\/user|\/tmp\/[\w.-]+|\/home\/sandbox|\/workspace\/|\/content\/drive/,
      );
      return m ? `Caminho "${m[0]}" típico de ambientes de execução de IA.` : null;
    },
  },
  {
    id: "sandbox.utc-zero-edit",
    category: "sandbox",
    weight: 10,
    test: (i) =>
      i.utcDates && (!i.modified || i.created === i.modified)
        ? "Datas em UTC (+00:00) sem tempo de edição — servidores costumam correr em UTC."
        : null,
  },
  {
    id: "sandbox.totaltime-zero",
    category: "sandbox",
    weight: 10,
    test: (i) => (i.totalTime === 0 ? "Tempo total de edição = 0 minutos." : null),
  },
  {
    id: "sandbox.revision-1",
    category: "sandbox",
    weight: 8,
    test: (i) =>
      i.revision === 1 ? "Revisão = 1: o documento nunca foi guardado novamente." : null,
  },
  {
    id: "sandbox.created-eq-modified",
    category: "sandbox",
    weight: 8,
    test: (i) =>
      i.created && i.modified && i.created.slice(0, 19) === i.modified.slice(0, 19)
        ? "Data de criação igual à de modificação ao segundo."
        : null,
  },
  {
    id: "sandbox.no-company",
    category: "sandbox",
    weight: 6,
    test: (i) =>
      ["docx", "xlsx", "pptx"].includes(i.kind) && !i.company
        ? "Campo Empresa em falta (Office instalado em empresas preenche-o normalmente)."
        : null,
  },
  {
    id: "image.no-metadata",
    category: "ai",
    weight: 10,
    test: (i) =>
      i.kind === "image" && i.metadataCount === 0
        ? "Imagem sem quaisquer metadados (foram removidos ou nunca existiram)."
        : null,
  },
  {
    id: "human.camera",
    category: "human",
    weight: -25,
    test: (i) =>
      i.allText.includes("__camera__") && !i.c2pa?.ai
        ? "Marca/modelo de câmara presentes nos EXIF."
        : null,
  },
  {
    id: "human.edit-time",
    category: "human",
    weight: -15,
    test: (i) =>
      (i.totalTime ?? 0) >= 10 ? `Tempo total de edição de ${i.totalTime} minutos.` : null,
  },
  {
    id: "human.revisions",
    category: "human",
    weight: -10,
    test: (i) => ((i.revision ?? 0) >= 3 ? `${i.revision} revisões guardadas.` : null),
  },
  {
    id: "human.company",
    category: "human",
    weight: -10,
    test: (i) => (i.company ? `Empresa registada: "${i.company}".` : null),
  },
  {
    id: "human.distinct-editor",
    category: "human",
    weight: -8,
    test: (i) =>
      i.lastModifiedBy &&
      i.creator &&
      i.lastModifiedBy !== i.creator &&
      !/python|openpyxl|canny/i.test(i.lastModifiedBy)
        ? `Editado por uma pessoa diferente do autor ("${i.lastModifiedBy}").`
        : null,
  },
];
