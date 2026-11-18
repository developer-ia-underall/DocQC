import { Pill } from "@/components/app/status";
import {
  ESTADOS,
  nifActivo,
  nifInadimplente,
  type EstadoPessoa,
  type Pessoa,
} from "@/lib/contratos/engine";
import { cn } from "@/lib/utils";

const TOM: Record<EstadoPessoa, "danger" | "warning" | "safe" | "info" | "neutral"> = {
  ler: "neutral",
  falta: "danger",
  rever: "warning",
  lido: "info",
  confirmado: "safe",
};

export function EstadoBadge({ estado }: { estado: EstadoPessoa }) {
  return <Pill t={TOM[estado]}>{ESTADOS[estado]}</Pill>;
}

/** Linha curta por baixo do n.º do BI na tabela. */
export function NifCurto({ pessoa: p }: { pessoa: Pessoa }) {
  const n = p.nif;
  if (!n) return null;
  let texto: string;
  let mau = false;
  if (n.estado === "aconsultar") texto = "NIF: a consultar…";
  else if (n.estado === "nao") [texto, mau] = ["NIF não encontrado", true];
  else if (n.estado === "erro") texto = "NIF: consulta falhou";
  else {
    const d = n.dados!;
    mau = !nifActivo(d) || nifInadimplente(d);
    texto = `NIF ${d.estado || "encontrado"}${nifInadimplente(d) ? " · inadimplente" : ""}`;
  }
  return (
    <div
      className={cn(
        "font-sans text-[11.5px]",
        n.estado === "ok" && !mau ? "text-safe" : mau ? "text-danger" : "text-muted-foreground",
      )}
    >
      {texto}
    </div>
  );
}
