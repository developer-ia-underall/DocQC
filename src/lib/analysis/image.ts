import type { Finding } from "@/types/domain";
import { type Analyzer, latin1, xmlTag } from "./common";

export interface ImageHandle {
  bytes: Uint8Array;
  raw: string;
  format: "jpeg" | "png" | "heic";
  exif: Record<string, unknown>;
}

export function pngTextChunks(b: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  if (b[0] !== 0x89) return out;
  let p = 8;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (p + 8 < b.length) {
    const len = dv.getUint32(p);
    const type = latin1(b.subarray(p + 4, p + 8));
    if (type === "tEXt" || type === "iTXt") {
      const data = b.subarray(p + 8, p + 8 + len);
      const z = data.indexOf(0);
      const key = latin1(data.subarray(0, z));
      let val = data.subarray(z + 1);
      if (type === "iTXt") {
        let q = 2;
        let zeros = 0;
        while (q < val.length && zeros < 2) {
          if (val[q] === 0) zeros++;
          q++;
        }
        val = val.subarray(q);
      }
      out[key] = new TextDecoder().decode(val).slice(0, 2000);
    }
    if (type === "IEND") break;
    p += 12 + len;
  }
  return out;
}

const AI_IMG =
  /DALL[·-]?E|OpenAI|Midjourney|Stable Diffusion|Firefly|Imagen|Gemini|Leonardo|ComfyUI|Automatic1111|NovelAI|Flux/i;

export const imageAnalyzer: Analyzer<ImageHandle> = {
  async load(bytes) {
    const raw = latin1(bytes.subarray(0, Math.min(bytes.length, 4_000_000)));
    const format = bytes[0] === 0xff ? "jpeg" : bytes[0] === 0x89 ? "png" : "heic";
    let exif: Record<string, unknown> = {};
    try {
      const exifr = (await import("exifr")).default;
      exif =
        (await exifr.parse(bytes, {
          tiff: true,
          exif: true,
          xmp: true,
          iptc: true,
          gps: true,
          mergeOutput: true,
          translateValues: true,
        })) ?? {};
    } catch {
      exif = {};
    }
    return { bytes, raw, format, exif };
  },
  async extract(h) {
    const md: Record<string, string> = {};
    const pick = [
      "Make",
      "Model",
      "Software",
      "DateTimeOriginal",
      "CreateDate",
      "ModifyDate",
      "Artist",
      "Copyright",
      "ImageDescription",
      "LensModel",
      "ExifImageWidth",
      "ExifImageHeight",
      "latitude",
      "longitude",
      "CreatorTool",
      "creator",
      "DigitalSourceType",
      "Credit",
    ];
    for (const k of pick) {
      const v = h.exif[k];
      if (v === undefined || v === null || v === "") continue;
      md[`EXIF.${k}`] =
        v instanceof Date
          ? v.toISOString()
          : Array.isArray(v)
            ? v.join(", ")
            : typeof v === "object"
              ? JSON.stringify(v).slice(0, 200)
              : String(v);
    }
    const xmpRaw = h.raw.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/)?.[0];
    const dst =
      (xmpRaw &&
        (xmlTag(xmpRaw, "Iptc4xmpExt:DigitalSourceType") ??
          xmpRaw.match(/digitalsourcetype\/(\w+)/i)?.[1])) ||
      (md["EXIF.DigitalSourceType"] ?? undefined);
    if (dst) md["IPTC.DigitalSourceType"] = dst.split("/").pop() ?? dst;
    if (xmpRaw) {
      const ct = xmlTag(xmpRaw, "xmp:CreatorTool");
      if (ct) md["XMP.xmp:CreatorTool"] = ct;
    }
    if (h.format === "png")
      for (const [k, v] of Object.entries(pngTextChunks(h.bytes))) md[`PNG.${k}`] = v.slice(0, 300);
    const c2paPresent =
      /jumb[\s\S]{0,40}c2pa|c2pa\.(?:claim|assertions|manifest)/.test(h.raw) ||
      h.raw.includes("caBX");
    const claim = h.raw.match(/c2pa\.(?:actions|created|claim)[\s\S]{0,300}/)?.[0];
    const c2paAi =
      c2paPresent &&
      (/trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia/.test(h.raw) ||
        AI_IMG.test(claim ?? ""));
    if (c2paPresent)
      md["C2PA.Manifesto"] = c2paAi ? "Presente — declara geração por IA" : "Presente";
    md["Estrutura.Formato"] = h.format.toUpperCase();
    const n = Object.keys(md).length - 1;
    return {
      metadata: md,
      xmpRaw,
      structure: { sections: [], fonts: [] },
      author: md["EXIF.Artist"] ?? md["EXIF.creator"],
      created: md["EXIF.DateTimeOriginal"] ?? md["EXIF.CreateDate"],
      modified: md["EXIF.ModifyDate"],
      origin: {
        kind: "image",
        author: md["EXIF.Artist"],
        creatorTool: md["XMP.xmp:CreatorTool"],
        application: md["EXIF.Software"] ?? md["PNG.Software"],
        created: md["EXIF.DateTimeOriginal"],
        hasEmbeddedMetadata: n > 0,
        metadataCount: n,
        c2pa: { present: c2paPresent, ai: c2paAi, claim },
        digitalSourceType: md["IPTC.DigitalSourceType"],
        allText: Object.values(md).join("\n") + (md["EXIF.Make"] ? "\n__camera__" : ""),
      },
    };
  },
  async scan(h) {
    const f: Finding[] = [];
    if (h.exif["latitude"] !== undefined)
      f.push({
        id: "img.gps",
        severity: "médio",
        title: "Localização GPS",
        explanation:
          "A imagem contém coordenadas GPS que revelam onde foi captada. Não é um risco ativo, mas é uma fuga de privacidade.",
        detail: `${h.exif["latitude"]}, ${h.exif["longitude"]}`,
      });
    if (/<\?php|<script/i.test(h.raw.slice(-20000)))
      f.push({
        id: "img.polyglot",
        severity: "alto",
        title: "Código embutido",
        explanation:
          "Foram encontrados fragmentos de código no ficheiro de imagem (possível ficheiro poliglota).",
      });
    return f;
  },
};

export const textAnalyzer: Analyzer<{ text: string }> = {
  async load(bytes) {
    return { text: new TextDecoder().decode(bytes) };
  },
  async extract({ text }) {
    const lines = text.split(/\r?\n/);
    const sections = lines
      .filter((l) => /^#{1,3}\s+\S/.test(l))
      .map((l) => l.replace(/^#+\s*/, "").trim());
    const words = text.split(/\s+/).filter(Boolean).length;
    return {
      metadata: {
        "Estrutura.Linhas": String(lines.length),
        "Estrutura.Palavras": String(words),
        "Estrutura.Codificação": "UTF-8",
      },
      structure: { sections: sections.slice(0, 40), fonts: [], words },
      origin: { kind: "text", hasEmbeddedMetadata: false, metadataCount: 0, allText: "" },
    };
  },
  async scan({ text }, opts) {
    const urls = Array.from(new Set(text.match(/https?:\/\/[^\s)>\]]+/g) ?? []));
    return opts.reportLinks
      ? urls.slice(0, 10).map((u) => ({
          id: "text.url",
          severity: "info" as const,
          title: "Endereço no texto",
          explanation: `O texto menciona ${u}. Ficheiros de texto não contactam servidores ao abrir.`,
          detail: u,
        }))
      : [];
  },
};
