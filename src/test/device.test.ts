import { describe, expect, it } from "vitest";
import { parseDevice, suggestApplication, suggestComputerName } from "@/lib/device";

const WIN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

describe("parseDevice", () => {
  it("distingue Windows 11 pelos Client Hints", () => {
    const d = parseDevice({
      userAgent: WIN_UA,
      hints: {
        platform: "Windows",
        platformVersion: "15.0.0",
        architecture: "x86",
        bitness: "64",
        fullVersionList: [
          { brand: "Not_A Brand", version: "99" },
          { brand: "Chromium", version: "142.0.1" },
          { brand: "Microsoft Edge", version: "142.0.3" },
        ],
      },
      timezone: "Africa/Luanda",
    });
    expect(d.os).toBe("Windows 11");
    expect(d.architecture).toBe("x86-64");
    expect(d.browser).toBe("Edge 142");
    expect(d.source).toBe("client-hints");
    expect(d.timezone).toBe("Africa/Luanda");
  });

  it("Windows 10 pelos Client Hints", () => {
    expect(
      parseDevice({ userAgent: WIN_UA, hints: { platform: "Windows", platformVersion: "10.0.0" } })
        .os,
    ).toBe("Windows 10");
  });

  it("sem Client Hints não finge saber a versão do Windows", () => {
    const d = parseDevice({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
    });
    expect(d.os).toBe("Windows 10 ou 11");
    expect(d.browser).toBe("Firefox 140");
    expect(d.source).toBe("user-agent");
  });

  it("macOS com a versão congelada do Safari", () => {
    const d = parseDevice({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    });
    expect(d.os).toBe("macOS");
    expect(d.platform).toBe("macOS");
    expect(d.browser).toBe("Safari 18");
  });
});

describe("sugestões", () => {
  it("nome do computador no padrão da empresa", () => {
    expect(suggestComputerName("Eliúde Francisco", "Call4All, Lda.")).toBe("C4A-EF01");
    expect(suggestComputerName("Ana Maria Domingos", "Underall")).toBe("UND-AD01");
    expect(suggestComputerName("", "")).toBe("PC-XX01");
  });
  it("aplicação conforme o sistema", () => {
    expect(suggestApplication("Windows")).toBe("Microsoft Word 16.0");
    expect(suggestApplication("Linux")).toBe("LibreOffice 24.8");
  });
});
