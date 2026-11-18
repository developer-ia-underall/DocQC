import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileArchive,
  FileSpreadsheet,
  FolderUp,
  IdCard,
  Search,
  Settings2,
  UploadCloud,
} from "lucide-react";
import { Page } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { norm } from "@/lib/contratos/texto";
import {
  FUNCOES,
  nomeColocacao,
  receberLargados,
  useContratos,
  type EstadoPessoa,
} from "@/lib/contratos/engine";
import { EstadoBadge, NifCurto } from "@/components/contratos/comum";
import { PainelPessoa } from "@/components/contratos/painel";
import { DefinicoesContratos } from "@/components/contratos/definicoes";

export const Route = createFileRoute("/contratos")({
  head: () => ({ meta: [{ title: "Contratos (BI) · DocQC" }] }),
  component: ContratosPage,
});

type Filtro = "todos" | Exclude<EstadoPessoa, "ler">;
const FILTROS: [Filtro, string][] = [
  ["todos", "Todos"],
  ["falta", "Em falta"],
  ["rever", "A rever"],
  ["lido", "Lidos"],
  ["confirmado", "Confirmados"],
];

function ContratosPage() {
  const c = useContratos();
  const [seleccionada, setSeleccionada] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [procura, setProcura] = useState("");
  const [definicoes, setDefinicoes] = useState(false);
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const [aGerar, setAGerar] = useState<string | null>(null);
  const [aLargar, setALargar] = useState(false);
  const inputFicheiros = useRef<HTMLInputElement>(null);
  const inputPasta = useRef<HTMLInputElement>(null);

  // Largar ficheiros ou pastas em qualquer ponto da página.
  useEffect(() => {
    let profundidade = 0;
    const entra = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      profundidade++;
      setALargar(true);
    };
    const sai = () => {
      if (--profundidade <= 0) {
        profundidade = 0;
        setALargar(false);
      }
    };
    const sobre = (e: DragEvent) => e.preventDefault();
    const larga = async (e: DragEvent) => {
      e.preventDefault();
      profundidade = 0;
      setALargar(false);
      if (e.dataTransfer && !document.querySelector("[role=dialog]"))
        c.adicionar(await receberLargados(e.dataTransfer));
    };
    window.addEventListener("dragenter", entra);
    window.addEventListener("dragleave", sai);
    window.addEventListener("dragover", sobre);
    window.addEventListener("drop", larga);
    return () => {
      window.removeEventListener("dragenter", entra);
      window.removeEventListener("dragleave", sai);
      window.removeEventListener("dragover", sobre);
      window.removeEventListener("drop", larga);
    };
  }, [c]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAmpliada(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  // Garante o atributo webkitdirectory (não faz parte dos tipos do React).
  useEffect(() => {
    inputPasta.current?.setAttribute("webkitdirectory", "");
  }, []);

  const pessoas = c.pessoas();
  const conta: Record<Filtro, number> = {
    todos: pessoas.length,
    falta: 0,
    rever: 0,
    lido: 0,
    confirmado: 0,
  };
  for (const p of pessoas) {
    const e = c.avaliacao(p.id).estado;
    if (e !== "ler") conta[e]++;
  }
  const termo = norm(procura);
  const visiveis = pessoas.filter((p) => {
    const e = c.avaliacao(p.id).estado;
    if (filtro !== "todos" && e !== filtro) return false;
    if (!termo) return true;
    return norm(
      `${p.nome} ${p.numero} ${c.codigo(p.id)?.codigo || ""} ${p.ficheiros.join(" ")}`,
    ).includes(termo);
  });
  const pessoa = c.pessoa(seleccionada);
  const { total, feitos } = c.leitura;
  const aLer = total > 0 && feitos < total;
  const modelosEmFalta = FUNCOES.filter((f) => !c.modelos[f.sigla]);

  const escolhidos = (lista: FileList | null) => {
    if (!lista?.length) return;
    c.adicionar([...lista].map((f) => ({ ficheiro: f, caminho: f.webkitRelativePath || f.name })));
  };

  const descricao = useMemo(
    () =>
      aLer
        ? `A ler os BI: ${feitos} de ${total} ficheiros. Podes ir revendo os que já estão lidos.`
        : c.cfg.consultarNif
          ? "Os BI são lidos neste browser. Só o n.º do BI é enviado ao Portal do Contribuinte, para consultar o NIF."
          : "Os BI são lidos neste browser. Nada é enviado para a internet.",
    [aLer, feitos, total, c.cfg.consultarNif],
  );

  return (
    <Page
      wide
      crumbs={[{ label: "Contratos (BI)" }]}
      title="Contratos a partir do BI"
      description={descricao}
      actions={
        <>
          <Button variant="outline" onClick={() => setDefinicoes(true)}>
            <Settings2 /> <span className="hidden sm:inline">Definições e modelos</span>
          </Button>
          <Button variant="outline" onClick={() => inputPasta.current?.click()}>
            <FolderUp /> <span className="hidden sm:inline">Carregar pasta</span>
          </Button>
          <Button onClick={() => inputFicheiros.current?.click()}>
            <UploadCloud /> Carregar BI
          </Button>
          <input
            ref={inputFicheiros}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
            multiple
            hidden
            onChange={(e) => {
              escolhidos(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={inputPasta}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              escolhidos(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      }
    >
      {aLer && (
        <div className="mb-4 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-300"
            style={{ width: `${Math.round((feitos / total) * 100)}%` }}
          />
        </div>
      )}

      {!c.temPessoas() ? (
        <div
          className={cn(
            "flex flex-col items-center rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors",
            aLargar ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <div className="grid size-11 place-items-center rounded-lg border border-border bg-card">
            <IdCard className="size-5 text-muted-foreground" strokeWidth={1.6} />
          </div>
          <h2 className="mt-3 text-[15px] font-semibold">Arrasta para aqui os BI</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            PDF, JPG ou PNG. Ficheiros soltos ou uma pasta inteira.
          </p>
          <ul className="mt-4 max-w-xl list-disc space-y-1 pl-5 text-left text-[12.5px] text-muted-foreground">
            <li>
              Um ficheiro com a frente e o verso, ou dois ficheiros com o mesmo nome terminados em{" "}
              <b>frente</b> e <b>verso</b>.
            </li>
            <li>
              Se os BI estiverem em pastas com o nome do município (por exemplo <b>Huíla/Lubango</b>
              ), a colocação é preenchida a partir da pasta.
            </li>
          </ul>
          {modelosEmFalta.length > 0 && (
            <p className="mt-5 rounded-md bg-warning-soft px-3 py-2 text-[12.5px] text-warning">
              Antes de gerar contratos, carrega o modelo de{" "}
              {modelosEmFalta.map((f) => f.nome).join(" e de ")} em{" "}
              <button type="button" className="underline" onClick={() => setDefinicoes(true)}>
                Definições e modelos
              </button>
              .
            </p>
          )}
        </div>
      ) : (
        <div
          className={cn("grid items-start gap-4", pessoa && "lg:grid-cols-[minmax(0,1fr)_440px]")}
        >
          <div className={cn("min-w-0", pessoa && "hidden lg:block")}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtrar por estado">
                {FILTROS.map(([k, t]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={filtro === k}
                    onClick={() => setFiltro(k)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] transition-colors",
                      filtro === k
                        ? "border-foreground/20 bg-accent font-medium"
                        : "border-transparent text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {t}
                    <span className="font-mono text-[11px] text-muted-foreground">{conta[k]}</span>
                  </button>
                ))}
              </div>
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  className="pl-8"
                  placeholder="Procurar por nome, BI ou código"
                  value={procura}
                  onChange={(e) => setProcura(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void c.descarregarResumo()}>
                  <FileSpreadsheet /> Resumo (.xlsx)
                </Button>
                <Button
                  disabled={!!aGerar}
                  onClick={async () => {
                    const r = await c.descarregarContratos((n, t) =>
                      setAGerar(`A gerar ${n} de ${t}…`),
                    );
                    setAGerar(null);
                    if (r === "modelos") setDefinicoes(true);
                  }}
                >
                  <FileArchive /> {aGerar ?? "Contratos (.zip)"}
                </Button>
              </div>
            </div>

            <div className="panel overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-subtle text-left text-[11.5px] font-medium text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Estado</th>
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium">N.º do BI</th>
                    <th className="px-3 py-2 font-medium">Válido até</th>
                    <th className="px-3 py-2 font-medium">Colocação</th>
                    <th className="px-3 py-2 font-medium">Função</th>
                    <th className="px-3 py-2 font-medium">Código do contrato</th>
                    <th className="px-3 py-2 font-medium">A verificar</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((p) => {
                    const a = c.avaliacao(p.id);
                    const ficheiros = p.ficheiros.map((f) => f.split("/").pop()).join(", ");
                    const sel = seleccionada === p.id;
                    const abrir = () => setSeleccionada(p.id);
                    if (!p.lido)
                      return (
                        <tr
                          key={p.id}
                          onClick={abrir}
                          className={cn(
                            "cursor-pointer border-b border-border last:border-0",
                            sel && "bg-accent",
                          )}
                        >
                          <td className="px-3 py-2.5">
                            <EstadoBadge estado="ler" />
                          </td>
                          <td colSpan={7} className="px-3 py-2.5 text-muted-foreground">
                            {ficheiros}
                          </td>
                        </tr>
                      );
                    const verificar = [...a.erros, ...a.avisos];
                    const codigo = c.codigo(p.id)?.codigo;
                    const colocacao = nomeColocacao(p);
                    const funcao = FUNCOES.find((f) => f.sigla === p.funcao);
                    return (
                      <tr
                        key={p.id}
                        tabIndex={0}
                        onClick={abrir}
                        onKeyDown={(e) =>
                          (e.key === "Enter" || e.key === " ") && (e.preventDefault(), abrir())
                        }
                        className={cn(
                          "cursor-pointer border-b border-border align-top transition-colors last:border-0 hover:bg-subtle",
                          sel && "bg-accent hover:bg-accent",
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <EstadoBadge estado={a.estado} />
                        </td>
                        <td className="px-3 py-2.5">
                          {p.nome || <span className="text-danger">sem nome</span>}
                          <div className="text-[11.5px] text-muted-foreground">{ficheiros}</div>
                        </td>
                        <td className="px-3 py-2.5 font-mono">
                          {p.numero || <span className="text-danger">—</span>}
                          <NifCurto pessoa={p} />
                        </td>
                        <td className="px-3 py-2.5 font-mono">
                          {p.valido || <span className="text-danger">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {colocacao || <span className="text-danger">por definir</span>}
                        </td>
                        <td className="px-3 py-2.5">{funcao?.nome}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono">
                          {codigo || <span className="text-danger">—</span>}
                        </td>
                        <td className="max-w-[260px] px-3 py-2.5 text-[12px] text-muted-foreground">
                          {verificar[0]}
                          {verificar.length > 1 && (
                            <b className="ml-1 text-foreground">+{verificar.length - 1}</b>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!visiveis.length && (
                <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                  Nenhuma pessoa corresponde a este filtro.
                </p>
              )}
            </div>
          </div>

          {pessoa && (
            <PainelPessoa
              key={pessoa.id}
              pessoa={pessoa}
              aoFechar={() => setSeleccionada(null)}
              aoSeleccionar={setSeleccionada}
              aoAmpliar={setAmpliada}
            />
          )}
        </div>
      )}

      <DefinicoesContratos aberto={definicoes} aoMudar={setDefinicoes} />

      {ampliada && (
        <div
          className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-black/80 p-4"
          onClick={() => setAmpliada(null)}
        >
          <img src={ampliada} alt="BI ampliado" className="max-h-full max-w-full rounded-md" />
        </div>
      )}
    </Page>
  );
}
