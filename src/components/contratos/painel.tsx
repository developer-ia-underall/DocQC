import { useEffect, useRef, useState } from "react";
import { Check, Loader2, RotateCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CAMPO_BRUTO,
  FUNCOES,
  FORMATO_BI,
  PROVINCIAS,
  comporMorada,
  municipiosDe,
  nifActual,
  type CampoEditavel,
  type Pessoa,
  useContratos,
} from "@/lib/contratos/engine";
import { EstadoBadge } from "./comum";

export const classeSelect =
  "flex h-8 w-full rounded-md border border-input bg-card px-2 text-[13px] transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** Painel de revisão de uma pessoa: imagens do BI ao lado dos dados lidos. */
export function PainelPessoa({
  pessoa: p,
  aoFechar,
  aoSeleccionar,
  aoAmpliar,
}: {
  pessoa: Pessoa;
  aoFechar: () => void;
  aoSeleccionar: (id: number | null) => void;
  aoAmpliar: (url: string) => void;
}) {
  const c = useContratos();
  const a = c.avaliacao(p.id);
  const cod = c.codigo(p.id);
  const [foco, setFoco] = useState<CampoEditavel | null>(null);

  const campo = (
    id: CampoEditavel,
    rotulo: string,
    opts: { larga?: boolean; mono?: boolean } = {},
  ) => {
    const info = a.campos[id];
    return (
      <label className={cn("flex flex-col gap-1", opts.larga && "col-span-2")}>
        <span className="text-[12px] font-medium text-foreground/80">{rotulo}</span>
        <Input
          value={p[id]}
          onChange={(e) => c.editar(p.id, id, e.target.value)}
          onFocus={() => setFoco(id)}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            opts.mono && "font-mono",
            info?.tipo === "erro" && "border-danger bg-danger-soft",
            info?.tipo === "duvida" && "border-warning bg-warning-soft",
          )}
        />
        {info && (
          <small
            className={cn("text-[11.5px]", info.tipo === "erro" ? "text-danger" : "text-warning")}
          >
            {info.msg}
          </small>
        )}
      </label>
    );
  };

  const avisos = [
    ...a.erros.map((m) => ["erro", m] as const),
    ...a.avisos.map((m) => ["aviso", m] as const),
  ];
  const municipioInfo = a.campos.municipio;

  return (
    <aside className="panel flex flex-col gap-4 p-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold">{p.nome || "Sem nome"}</h2>
            <EstadoBadge estado={a.estado} />
          </div>
          <p className="mt-0.5 break-all text-[12px] text-muted-foreground">
            {p.ficheiros.join(" · ")}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={aoFechar} aria-label="Fechar">
          <X />
        </Button>
      </div>

      {!p.lido && (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Ainda a ler este BI…
        </p>
      )}

      {p.imagens.length > 0 && (
        <div className="grid gap-2">
          {p.imagens.map((im, i) => (
            <ImagemComMarca
              key={im.url}
              url={im.url}
              alt={`BI (${im.ficheiro})`}
              caixa={foco && CAMPO_BRUTO[foco] ? im.caixas[CAMPO_BRUTO[foco]!] : undefined}
              aoAmpliar={() => aoAmpliar(im.url)}
              indice={i}
            />
          ))}
        </div>
      )}

      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Dados do BI</h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          {campo("nome", "Nome completo", { larga: true })}
          {campo("numero", "N.º do BI", { larga: true, mono: true })}
          {campo("emitido", "Emitido em", { mono: true })}
          {campo("valido", "Válido até", { mono: true })}
          {campo("rua", "Residência (rua, zona)", { larga: true })}
          {campo("casa", "Casa n.º (vazio = S/Nº)")}
          {campo("bairro", "Bairro")}
          {campo("munRes", "Município de residência", { larga: true })}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold">NIF no Portal do Contribuinte</h3>
        <BlocoNif pessoa={p} />
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Colocação e código</h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-foreground/80">Província</span>
            <select
              className={classeSelect}
              value={p.provincia}
              onChange={(e) => c.editar(p.id, "provincia", e.target.value)}
            >
              <option value="">Escolher…</option>
              {PROVINCIAS.map((x) => (
                <option key={x.sigla} value={x.sigla}>
                  {x.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-foreground/80">Município</span>
            <select
              className={cn(
                classeSelect,
                municipioInfo?.tipo === "erro" && "border-danger",
                municipioInfo?.tipo === "duvida" && "border-warning",
              )}
              value={p.municipio}
              disabled={!p.provincia}
              onChange={(e) => c.editar(p.id, "municipio", e.target.value)}
            >
              <option value="">{p.provincia ? "Escolher…" : "Escolhe primeiro a província"}</option>
              {municipiosDe(p.provincia).map((m: { siglaMun: string; municipio: string }) => (
                <option key={m.siglaMun} value={m.siglaMun}>
                  {m.municipio}
                </option>
              ))}
            </select>
            {municipioInfo && (
              <small
                className={cn(
                  "text-[11.5px]",
                  municipioInfo.tipo === "erro" ? "text-danger" : "text-warning",
                )}
              >
                {municipioInfo.msg}
              </small>
            )}
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[12px] font-medium text-foreground/80">Função</span>
            <select
              className={classeSelect}
              value={p.funcao}
              onChange={(e) => c.editar(p.id, "funcao", e.target.value)}
            >
              {FUNCOES.map((f) => (
                <option key={f.sigla} value={f.sigla}>
                  {f.nome} ({f.sigla})
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 rounded-md bg-subtle px-3 py-2.5">
          <div className="font-mono text-[14px] font-semibold">
            {cod?.codigo || "Código por atribuir"}
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {cod?.codigo
              ? `Ordem ${String(cod.ordem).padStart(2, "0")} de ${cod.totalNoGrupo} com esta função neste município. Morada no contrato: ${comporMorada({ rua: p.rua, casa: p.casa, bairro: p.bairro, municipio: p.munRes })}`
              : "Escolhe a província, o município e a função."}
          </div>
        </div>
      </section>

      {avisos.length > 0 && (
        <section>
          <h3 className="mb-2 text-[13px] font-semibold">A verificar</h3>
          <ul className="grid gap-1.5">
            {avisos.map(([t, m], i) => (
              <li
                key={i}
                className={cn(
                  "border-l-[3px] px-2.5 py-1.5 text-[12.5px]",
                  t === "erro" ? "border-danger bg-danger-soft" : "border-warning bg-warning-soft",
                )}
              >
                {m}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          disabled={!p.lido || a.erros.length > 0}
          onClick={() => aoSeleccionar(c.confirmar(p.id))}
        >
          <Check />{" "}
          {a.estado === "confirmado" ? "Confirmado — ver a seguinte" : "Confirmar e ver a seguinte"}
        </Button>
        <Button
          variant="outline"
          className="text-danger"
          onClick={() => c.remover(p.id, () => aoSeleccionar(null))}
        >
          <Trash2 /> Remover pessoa
        </Button>
      </div>
    </aside>
  );
}

function ImagemComMarca({
  url,
  alt,
  caixa,
  aoAmpliar,
  indice,
}: {
  url: string;
  alt: string;
  caixa: { x: number; y: number; w: number; h: number } | undefined;
  aoAmpliar: () => void;
  indice: number;
}) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (caixa && caixaRef.current && imgRef.current)
      caixaRef.current.scrollTop = Math.max(0, caixa.y * imgRef.current.clientHeight - 60);
  }, [caixa]);
  const m = 0.012;
  return (
    <div
      ref={caixaRef}
      className="relative max-h-[380px] cursor-zoom-in overflow-y-auto rounded-md border border-border bg-muted"
      title="Clica para ampliar"
      onClick={aoAmpliar}
      data-imagem={indice}
    >
      <div className="relative">
        <img ref={imgRef} src={url} alt={alt} className="block w-full" />
        {caixa && (
          <div
            className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/15"
            style={{
              left: `${(caixa.x - m) * 100}%`,
              top: `${(caixa.y - m / 2) * 100}%`,
              width: `${(caixa.w + 2 * m) * 100}%`,
              height: `${(caixa.h + m) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}

function BlocoNif({ pessoa: p }: { pessoa: Pessoa }) {
  const c = useContratos();
  const n = nifActual(p);
  const botao = (t: string) => (
    <Button size="sm" variant="outline" onClick={() => c.consultarNif(p.id)}>
      <RotateCw /> {t}
    </Button>
  );
  if (!FORMATO_BI.test(p.numero))
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Corrige o n.º do BI para consultar o NIF.
      </p>
    );
  if (!n)
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-[12.5px] text-muted-foreground">
          {c.cfg.consultarNif
            ? "Ainda não consultado."
            : "A consulta automática está desligada nas definições."}
        </p>
        {botao("Consultar NIF")}
      </div>
    );
  if (n.estado === "aconsultar")
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> A consultar o Portal do Contribuinte…
      </p>
    );
  if (n.estado === "erro" || n.estado === "nao")
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-[12.5px] text-danger">
          {n.estado === "nao" ? `NIF ${n.numero} não encontrado no Portal do Contribuinte.` : n.msg}
        </p>
        {botao(n.estado === "nao" ? "Consultar de novo" : "Tentar de novo")}
      </div>
    );
  const d = n.dados!;
  const linhas: [string, string][] = [
    ["NIF", d.nif],
    ["Nome", d.nome],
    ["Tipo", d.tipo],
    ["Estado", d.estado],
    ["Inadimplente", d.inadimplente],
    ["Regime de IVA", d.regimeIva],
    ["Residência fiscal", d.residente],
  ];
  return (
    <div className="flex flex-col items-start gap-2">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12.5px]">
        {linhas
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
      </dl>
      {botao("Consultar de novo")}
    </div>
  );
}
