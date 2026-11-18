// @ts-nocheck — portado do contratos-bi.
// Consulta do NIF no Portal do Contribuinte (MINFIN).
// O browser não pode chamar o portal diretamente (CORS e sessão JSF), por isso esta função faz de intermediária:
//   GET /api/nif?bi=000000000LA000  →  { encontrado, nif, nome, tipo, estado, inadimplente, regimeIva, ... }
// Só corre no servidor (rota src/routes/api.nif.ts); usa node:https, por isso precisa do runtime Node (Vercel ou node-server).

import { request, Agent } from "node:https";
import { rootCertificates } from "node:tls";

const PORTAL = "https://portaldocontribuinte.minfin.gov.ao/consultar-headNifId-do-contribuinte";
const FORMATO = /^\d{9}[A-Z]{2}\d{3}$/;
const AGENTE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TEMPO_MAX = 15000;

// O servidor do portal envia o certificado intermédio errado, e o Node (ao contrário dos browsers) não o vai buscar.
// Junta-se aqui o intermédio certo, publicado pela DigiCert e assinado pela «DigiCert Global Root G2"
// (que já está nas raízes do Node). A verificação TLS continua completa.
// Origem: http://cacerts.digicert.com/DigiCertGlobalG2TLSRSASHA2562020CA1-1.crt (válido até 29/03/2031)
const DIGICERT_G2_TLS_CA1 = `-----BEGIN CERTIFICATE-----
MIIEyDCCA7CgAwIBAgIQDPW9BitWAvR6uFAsI8zwZjANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0yMTAzMzAwMDAwMDBaFw0zMTAzMjkyMzU5NTlaMFkxCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxMzAxBgNVBAMTKkRpZ2lDZXJ0IEdsb2Jh
bCBHMiBUTFMgUlNBIFNIQTI1NiAyMDIwIENBMTCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBAMz3EGJPprtjb+2QUlbFbSd7ehJWivH0+dbn4Y+9lavyYEEV
cNsSAPonCrVXOFt9slGTcZUOakGUWzUb+nv6u8W+JDD+Vu/E832X4xT1FE3LpxDy
FuqrIvAxIhFhaZAmunjZlx/jfWardUSVc8is/+9dCopZQ+GssjoP80j812s3wWPc
3kbW20X+fSP9kOhRBx5Ro1/tSUZUfyyIxfQTnJcVPAPooTncaQwywa8WV0yUR0J8
osicfebUTVSvQpmowQTCd5zWSOTOEeAqgJnwQ3DPP3Zr0UxJqyRewg2C/Uaoq2yT
zGJSQnWS+Jr6Xl6ysGHlHx+5fwmY6D36g39HaaECAwEAAaOCAYIwggF+MBIGA1Ud
EwEB/wQIMAYBAf8CAQAwHQYDVR0OBBYEFHSFgMBmx9833s+9KTeqAx2+7c0XMB8G
A1UdIwQYMBaAFE4iVCAYlebjbuYP+vq5Eu0GF485MA4GA1UdDwEB/wQEAwIBhjAd
BgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwdgYIKwYBBQUHAQEEajBoMCQG
CCsGAQUFBzABhhhodHRwOi8vb2NzcC5kaWdpY2VydC5jb20wQAYIKwYBBQUHMAKG
NGh0dHA6Ly9jYWNlcnRzLmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEdsb2JhbFJvb3RH
Mi5jcnQwQgYDVR0fBDswOTA3oDWgM4YxaHR0cDovL2NybDMuZGlnaWNlcnQuY29t
L0RpZ2lDZXJ0R2xvYmFsUm9vdEcyLmNybDA9BgNVHSAENjA0MAsGCWCGSAGG/WwC
ATAHBgVngQwBATAIBgZngQwBAgEwCAYGZ4EMAQICMAgGBmeBDAECAzANBgkqhkiG
9w0BAQsFAAOCAQEAkPFwyyiXaZd8dP3A+iZ7U6utzWX9upwGnIrXWkOH7U1MVl+t
wcW1BSAuWdH/SvWgKtiwla3JLko716f2b4gp/DA/JIS7w7d7kwcsr4drdjPtAFVS
slme5LnQ89/nD/7d+MS5EHKBCQRfz5eeLjJ1js+aWNJXMX43AYGyZm0pGrFmCW3R
bpD0ufovARTFXFZkAdl9h6g4U5+LXUZtXMYnhIHUfoyMo5tS58aI7Dd8KvvwVVo4
chDYABPPTHPbqjc1qCmBaZx2vN4Ye5DUys/vZwP9BFohFrH/6j/f3IL16/RZkiMN
JCqVJUzKoZHm1Lesh3Sz8W2jmdv51b2EQJ8HmA==
-----END CERTIFICATE-----`;
const agente = new Agent({ ca: [...rootCertificates, DIGICERT_G2_TLS_CA1], keepAlive: false });

// Pedido HTTPS simples → { status, headers, corpo: Buffer }
function pedir(url, { method = "GET", headers = {}, corpo, sinal } = {}) {
  return new Promise((ok, erro) => {
    const req = request(url, { method, headers, agent: agente, signal: sinal }, (res) => {
      const partes = [];
      res.on("data", (d) => partes.push(d));
      res.on("end", () =>
        ok({ status: res.statusCode, headers: res.headers, corpo: Buffer.concat(partes) }),
      );
      res.on("error", erro);
    });
    req.on("error", erro);
    req.end(corpo);
  });
}

// O portal anuncia UTF-8 mas responde em Latin-1; aceita os dois.
function descodificar(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function cookiesDe(resposta) {
  const lista = resposta.headers["set-cookie"] || [];
  return lista
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

const entidades = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const desentidade = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#")
      return String.fromCodePoint(
        e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
      );
    return entidades[e.toLowerCase()] ?? m;
  });

// Transforma o painel de resultado em pares «Rótulo: valor».
function lerResultado(xml) {
  const painel =
    xml.match(/<update id="showpanelNIF"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/)?.[1] ?? "";
  const linhas = painel
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((l) => desentidade(l).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const campos = {};
  for (let i = 0; i < linhas.length - 1; i++) {
    if (linhas[i].endsWith(":") && !linhas[i + 1].endsWith(":"))
      campos[linhas[i].slice(0, -1).trim()] = linhas[++i];
  }
  const residente = linhas.find((l) => /residente/i.test(l) && !l.endsWith(":"));
  return { campos, residente };
}

export async function consultarNif(bi) {
  const numero = String(bi || "")
    .toUpperCase()
    .replace(/\s/g, "");
  if (!FORMATO.test(numero))
    return {
      estado: 400,
      corpo: { erro: "N.º do BI fora do formato (9 algarismos, 2 letras, 3 algarismos)." },
    };
  const sinal = AbortSignal.timeout(TEMPO_MAX);

  const pagina = await pedir(PORTAL, {
    headers: { "User-Agent": AGENTE, Accept: "text/html" },
    sinal,
  });
  if (pagina.status !== 200) throw new Error(`Portal respondeu ${pagina.status} ao abrir a página`);
  const html = descodificar(pagina.corpo);
  const cookies = cookiesDe(pagina);
  const viewState = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/)?.[1];
  const form = html.match(/name="([^"]+):txtNIFNumber"/)?.[1];
  if (!viewState || !form)
    throw new Error("A página do portal mudou (não encontrei o formulário de consulta)");
  const botao =
    html.match(new RegExp(`<button id="(${form}:[^"]+)"[^>]*type="submit"`))?.[1] ??
    `${form}:j_id_34`;

  const dados = new URLSearchParams({
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": botao,
    "javax.faces.partial.execute": form,
    "javax.faces.partial.render": "showpanelNIF",
    [botao]: botao,
    [`${form}:txtNIFNumber`]: numero,
    [`${form}_SUBMIT`]: "1",
    "javax.faces.ViewState": viewState,
  });
  const corpo = dados.toString();
  const resposta = await pedir(PORTAL, {
    method: "POST",
    headers: {
      "User-Agent": AGENTE,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Faces-Request": "partial/ajax",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/xml, text/xml, */*; q=0.01",
      Referer: PORTAL,
      "Content-Length": Buffer.byteLength(corpo),
      Cookie: cookies,
    },
    corpo,
    sinal,
  });
  if (resposta.status !== 200) throw new Error(`Portal respondeu ${resposta.status} à consulta`);
  const xml = descodificar(resposta.corpo);
  if (!xml.includes("<partial-response")) throw new Error("Resposta inesperada do portal");

  const { campos, residente } = lerResultado(xml);
  const mensagem = desentidade(xml.match(/detail:"([^"]*)"/)?.[1] ?? "");
  if (!campos.NIF && !campos.Nome) {
    return {
      estado: 200,
      corpo: { encontrado: false, numero, mensagem: mensagem || "NIF não encontrado" },
    };
  }
  return {
    estado: 200,
    corpo: {
      encontrado: true,
      numero,
      nif: campos.NIF || "",
      nome: campos.Nome || "",
      tipo: campos.Tipo || "",
      estado: campos.Estado || "",
      inadimplente: campos.Inadimplente || "",
      regimeIva: campos["Regime de IVA"] || "",
      residente: residente || "",
    },
  };
}
