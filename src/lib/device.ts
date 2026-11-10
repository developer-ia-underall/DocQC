/**
 * Lê do navegador os dados do computador em uso, para pré-preencher uma identidade.
 *
 * O que o navegador permite saber: sistema operativo (versão exata em Chrome/Edge via
 * User-Agent Client Hints; aproximada nos outros), arquitetura, navegador, fuso horário,
 * idioma, ecrã, núcleos e memória aproximada. O que NÃO permite: o nome do computador
 * (hostname), a edição do Windows (Home/Pro) e as aplicações instaladas. Esses ficam como
 * sugestão para a pessoa confirmar.
 */
import type { DeviceInfo } from "@/types/domain";

interface HighEntropy {
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  bitness?: string;
  fullVersionList?: { brand: string; version: string }[];
}

export interface DeviceSignals {
  userAgent: string;
  hints?: HighEntropy | null | undefined;
  timezone?: string | undefined;
  language?: string | undefined;
  screen?: { width: number; height: number; dpr: number } | undefined;
  cpuCores?: number | undefined;
  memoryGb?: number | undefined;
}

function osFromHints(h: HighEntropy): { os: string; platform: string } | null {
  const p = h.platform ?? "";
  const v = h.platformVersion ?? "";
  const major = Number.parseInt(v.split(".")[0] ?? "", 10);
  if (p === "Windows") {
    // Client Hints: platformVersion ≥ 13 é Windows 11; 1–10 é Windows 10; 0 é 7/8/8.1.
    if (Number.isNaN(major)) return { os: "Windows", platform: p };
    return {
      os: major >= 13 ? "Windows 11" : major >= 1 ? "Windows 10" : "Windows 8.1",
      platform: p,
    };
  }
  if (p === "macOS") {
    const [a, b] = v.split(".");
    return { os: a ? `macOS ${a}${b && b !== "0" ? `.${b}` : ""}` : "macOS", platform: p };
  }
  if (p === "Chrome OS" || p === "ChromeOS") return { os: "ChromeOS", platform: "ChromeOS" };
  if (p === "Linux") return { os: "Linux", platform: p };
  if (p === "Android") return { os: v ? `Android ${major || v}` : "Android", platform: p };
  if (p) return { os: p, platform: p };
  return null;
}

function osFromUserAgent(ua: string): { os: string; platform: string } {
  if (/Windows NT 10\.0/.test(ua)) return { os: "Windows 10 ou 11", platform: "Windows" };
  if (/Windows NT 6\.3/.test(ua)) return { os: "Windows 8.1", platform: "Windows" };
  if (/Windows NT 6\.1/.test(ua)) return { os: "Windows 7", platform: "Windows" };
  if (/Windows/.test(ua)) return { os: "Windows", platform: "Windows" };
  if (/iPhone|iPad|iPod/.test(ua)) {
    const m = ua.match(/OS (\d+)[._](\d+)/);
    return { os: m ? `iOS ${m[1]}.${m[2]}` : "iOS", platform: "iOS" };
  }
  if (/Mac OS X/.test(ua)) {
    // O Safari/Firefox congelam a versão em 10_15; não dá para saber a real.
    const m = ua.match(/Mac OS X (\d+)[._](\d+)/);
    const frozen = m && m[1] === "10" && m[2] === "15";
    return { os: m && !frozen ? `macOS ${m[1]}.${m[2]}` : "macOS", platform: "macOS" };
  }
  if (/CrOS/.test(ua)) return { os: "ChromeOS", platform: "ChromeOS" };
  if (/Android/.test(ua)) {
    const m = ua.match(/Android (\d+)/);
    return { os: m ? `Android ${m[1]}` : "Android", platform: "Android" };
  }
  if (/Linux/.test(ua)) return { os: "Linux", platform: "Linux" };
  return { os: "", platform: "" };
}

function browserName(ua: string, hints?: HighEntropy | null): string {
  const brands = hints?.fullVersionList ?? [];
  const pick = (re: RegExp) => brands.find((b) => re.test(b.brand));
  const b = pick(/Edge/) ?? pick(/Opera|OPR/) ?? pick(/Chrome/) ?? pick(/Chromium/);
  if (b)
    return `${b.brand.replace("Microsoft ", "").replace("Google ", "")} ${b.version.split(".")[0]}`;
  const m = ua.match(/Edg\/(\d+)/)
    ? ["Edge", ua.match(/Edg\/(\d+)/)![1]]
    : ua.match(/OPR\/(\d+)/)
      ? ["Opera", ua.match(/OPR\/(\d+)/)![1]]
      : ua.match(/Firefox\/(\d+)/)
        ? ["Firefox", ua.match(/Firefox\/(\d+)/)![1]]
        : ua.match(/Chrome\/(\d+)/)
          ? ["Chrome", ua.match(/Chrome\/(\d+)/)![1]]
          : ua.match(/Version\/(\d+).*Safari/)
            ? ["Safari", ua.match(/Version\/(\d+)/)![1]]
            : null;
  return m ? `${m[0]} ${m[1]}` : "";
}

/** Função pura (testável): converte os sinais do navegador em DeviceInfo. */
export function parseDevice(s: DeviceSignals): DeviceInfo {
  const fromHints = s.hints ? osFromHints(s.hints) : null;
  const { os, platform } = fromHints ?? osFromUserAgent(s.userAgent);
  const arch = s.hints?.architecture
    ? `${s.hints.architecture === "x86" ? "x86" : s.hints.architecture}${s.hints.bitness ? `-${s.hints.bitness}` : ""}`
    : /x86_64|Win64|x64|amd64/i.test(s.userAgent)
      ? "x86-64"
      : /arm64|aarch64/i.test(s.userAgent)
        ? "arm-64"
        : "";
  return {
    os,
    platform,
    architecture: arch,
    browser: browserName(s.userAgent, s.hints),
    timezone: s.timezone ?? "",
    language: s.language ?? "",
    screen: s.screen
      ? `${s.screen.width}×${s.screen.height}${s.screen.dpr > 1 ? ` @${s.screen.dpr}x` : ""}`
      : "",
    cpuCores: s.cpuCores ?? null,
    memoryGb: s.memoryGb ?? null,
    source: fromHints ? "client-hints" : "user-agent",
  };
}

/** Lê os sinais do navegador atual. Nunca falha: sem acesso, devolve o que conseguir. */
export async function detectDevice(): Promise<DeviceInfo> {
  if (typeof navigator === "undefined") return parseDevice({ userAgent: "" });
  const nav = navigator as Navigator & {
    userAgentData?: { getHighEntropyValues?: (k: string[]) => Promise<HighEntropy> };
    deviceMemory?: number;
  };
  let hints: HighEntropy | null = null;
  try {
    hints =
      (await nav.userAgentData?.getHighEntropyValues?.([
        "platform",
        "platformVersion",
        "architecture",
        "bitness",
        "fullVersionList",
      ])) ?? null;
  } catch {
    hints = null;
  }
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timezone = undefined;
  }
  return parseDevice({
    userAgent: nav.userAgent ?? "",
    hints,
    timezone,
    language: nav.language,
    screen:
      typeof window !== "undefined" && window.screen
        ? {
            width: window.screen.width,
            height: window.screen.height,
            dpr: window.devicePixelRatio || 1,
          }
        : undefined,
    cpuCores: nav.hardwareConcurrency || undefined,
    memoryGb: nav.deviceMemory,
  });
}

/** Aplicação que o Office/LibreOffice grava nos metadados, conforme o sistema. */
export function suggestApplication(platform: string): string {
  if (platform === "Windows" || platform === "macOS") return "Microsoft Word 16.0";
  if (platform === "Linux" || platform === "ChromeOS") return "LibreOffice 24.8";
  return "Microsoft Word 16.0";
}

/**
 * Sugestão de nome de computador no padrão da casa (ex.: C4A-EF01). O navegador não deixa ler
 * o nome real: a pessoa deve confirmá-lo (ver COMPUTER_NAME_HELP).
 */
export function suggestComputerName(fullName: string, company: string): string {
  const firstWord = company.trim().split(/[\s,]+/)[0] ?? "";
  const caps = firstWord.replace(/[^A-Z0-9]/g, "");
  const prefix = (caps.length >= 2 ? caps : firstWord.slice(0, 3).toUpperCase()) || "PC";
  const initials = fullName.normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean);
  const ini = ((initials[0]?.[0] ?? "") + (initials.at(-1)?.[0] ?? "")).toUpperCase() || "XX";
  return `${prefix}-${ini}01`;
}

export const COMPUTER_NAME_HELP: Record<string, string> = {
  Windows:
    "Definições → Sistema → Acerca de → Nome do dispositivo (ou escreva hostname na Linha de comandos).",
  macOS: "Definições do Sistema → Geral → Partilha → Nome do computador.",
  Linux: "Escreva hostname num terminal.",
  ChromeOS: "Definições → Acerca do ChromeOS → Detalhes adicionais → Nome do dispositivo.",
};

/** Resumo legível do que foi detetado (para mostrar e guardar). */
export function describeDevice(d: DeviceInfo): string[] {
  return [
    d.os && `${d.os}${d.architecture ? ` (${d.architecture})` : ""}`,
    d.browser,
    d.timezone,
    d.screen && `Ecrã ${d.screen}`,
    d.cpuCores ? `${d.cpuCores} núcleos` : "",
    d.memoryGb ? `≥ ${d.memoryGb} GB RAM` : "",
  ].filter(Boolean) as string[];
}
