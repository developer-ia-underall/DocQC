import { useEffect, useState, type ReactNode } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FUNCOES, TIPOS, type Cfg, useContratos } from "@/lib/contratos/engine";
import { classeSelect } from "./painel";

function Campo({
  rotulo,
  larga,
  children,
}: {
  rotulo: string;
  larga?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1", larga && "sm:col-span-2")}>
      <span className="text-[12px] font-medium text-foreground/80">{rotulo}</span>
      {children}
    </label>
  );
}

const MARCADORES = [
  "CODIGO",
  "NOME",
  "MORADA",
  "BI",
  "EMITIDO",
  "VALIDO",
  "LOCAL_DATA",
  "RESIDENCIA",
  "CASA",
  "BAIRRO",
  "MUNICIPIO",
];

/** Definições do módulo e modelos .docx (guardados só neste browser). Fecha sem guardar no × ou em Cancelar. */
export function DefinicoesContratos({
  aberto,
  aoMudar,
}: {
  aberto: boolean;
  aoMudar: (v: boolean) => void;
}) {
  const c = useContratos();
  const [f, setF] = useState<Cfg>(c.cfg);
  useEffect(() => {
    if (aberto) setF(c.cfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);
  const muda = <K extends keyof Cfg>(k: K, v: Cfg[K]) => setF((x) => ({ ...x, [k]: v }));

  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      <DialogContent className="top-[6vh] max-h-[88vh] max-w-2xl overflow-y-auto p-5">
        <DialogTitle className="text-[16px] font-semibold">Definições e modelos</DialogTitle>
        <DialogDescription className="mt-0.5 text-[12.5px] text-muted-foreground">
          Ficam guardadas só neste browser.
        </DialogDescription>

        <form
          className="mt-4 grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            c.guardarCfg(f);
            aoMudar(false);
          }}
        >
          <section>
            <h3 className="mb-1 text-[13px] font-semibold">Modelos de contrato</h3>
            <p className="mb-2 text-[12px] text-muted-foreground">
              Carrega o .docx de cada função. Marcadores aceites:{" "}
              {MARCADORES.map((m) => (
                <code
                  key={m}
                  className="mr-1 rounded bg-muted px-1 font-mono text-[11px]"
                >{`{{${m}}}`}</code>
              ))}
            </p>
            <div className="grid gap-2">
              {FUNCOES.map((fn) => {
                const m = c.modelos[fn.sigla];
                return (
                  <div
                    key={fn.sigla}
                    className={cn(
                      "flex items-center gap-3 rounded-md border px-3 py-2",
                      m ? "border-border" : "border-warning bg-warning-soft",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">
                        {fn.nome} ({fn.sigla})
                      </div>
                      <div className="truncate text-[12px] text-muted-foreground">
                        {m ? m.nome : "Nenhum modelo carregado"}
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <label className="cursor-pointer">
                        <FileUp /> {m ? "Substituir" : "Carregar modelo"}
                        <input
                          type="file"
                          accept=".docx"
                          hidden
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void c.definirModelo(fn.sigla, file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Código do contrato</h3>
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
              <Campo rotulo="Tipo de contrato">
                <select
                  className={classeSelect}
                  value={f.tipo}
                  onChange={(e) => muda("tipo", e.target.value)}
                >
                  {TIPOS.map((t) => (
                    <option key={t.sigla} value={t.sigla}>
                      {t.nome} ({t.sigla})
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Ano (2 dígitos)">
                <Input
                  inputMode="numeric"
                  maxLength={2}
                  value={f.ano}
                  onChange={(e) => muda("ano", e.target.value)}
                />
              </Campo>
              <Campo rotulo="Formato" larga>
                <Input
                  className="font-mono"
                  spellCheck={false}
                  value={f.formato}
                  onChange={(e) => muda("formato", e.target.value)}
                />
              </Campo>
              <Campo rotulo="Função por omissão">
                <select
                  className={classeSelect}
                  value={f.funcao}
                  onChange={(e) => muda("funcao", e.target.value)}
                >
                  {FUNCOES.map((fn) => (
                    <option key={fn.sigla} value={fn.sigla}>
                      {fn.nome} ({fn.sigla})
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Pessoas por município e função">
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={f.limite}
                  onChange={(e) => muda("limite", Number(e.target.value))}
                />
              </Campo>
              <Campo rotulo="Ordem (01, 02…) dentro do município" larga>
                <select
                  className={classeSelect}
                  value={f.criterioOrdem}
                  onChange={(e) => muda("criterioOrdem", e.target.value as Cfg["criterioOrdem"])}
                >
                  <option value="alfabetica">Alfabética pelo nome</option>
                  <option value="carregamento">Pela ordem em que os BI foram carregados</option>
                </select>
              </Campo>
              <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
                <Switch checked={f.sugerir} onCheckedChange={(v) => muda("sugerir", v)} />
                Sugerir o município de colocação a partir da residência do BI
              </label>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Contrato</h3>
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
              <Campo rotulo="Início do contrato">
                <Input
                  placeholder="DD/MM/AAAA"
                  value={f.inicio}
                  onChange={(e) => muda("inicio", e.target.value)}
                />
              </Campo>
              <Campo rotulo="Fim do contrato">
                <Input
                  placeholder="DD/MM/AAAA"
                  value={f.fim}
                  onChange={(e) => muda("fim", e.target.value)}
                />
              </Campo>
              <Campo rotulo="Local e data de assinatura (opcional)" larga>
                <Input
                  placeholder="Fica em branco para preencher à mão"
                  value={f.localData}
                  onChange={(e) => muda("localData", e.target.value)}
                />
              </Campo>
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              As datas servem para avisar quando um BI está caducado ou caduca durante o contrato. O
              texto do contrato não é alterado.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-[13px] font-semibold">NIF</h3>
            <label className="flex items-center gap-2 text-[13px]">
              <Switch checked={f.consultarNif} onCheckedChange={(v) => muda("consultarNif", v)} />
              Consultar o NIF no Portal do Contribuinte (MINFIN) quando o BI estiver lido
            </label>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Só o n.º do BI é enviado ao portal. O resultado (nome, estado, inadimplência, regime
              de IVA) aparece em cada pessoa e no resumo.
            </p>
          </section>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={() => aoMudar(false)}>
              Cancelar
            </Button>
            <Button type="submit">Guardar definições</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
