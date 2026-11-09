import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Page } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useSaveSettings, useSettings } from "@/services/queries";
import { resetAll } from "@/services/store";
import type { AppSettings } from "@/types/domain";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Definições · DocQC" }] }),
  component: SettingsPage,
});

function Row({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)] md:items-center">
      <div>
        <div className="font-medium">{title}</div>
        {body && <div className="mt-0.5 text-[12.5px] text-muted-foreground">{body}</div>}
      </div>
      <div className="md:justify-self-end md:w-full">{children}</div>
    </div>
  );
}

function SettingsPage() {
  const { data } = useSettings();
  const save = useSaveSettings();
  const [s, setS] = useState<AppSettings | null>(null);
  useEffect(() => {
    if (data) setS(structuredClone(data));
  }, [data]);
  const dirty = s && data && JSON.stringify(s) !== JSON.stringify(data);

  if (!s)
    return (
      <Page crumbs={[{ label: "Definições" }]} title="Definições">
        <Skeleton className="h-64 w-full" />
      </Page>
    );

  const set = <K extends keyof AppSettings>(k: K, v: Partial<AppSettings[K]>) =>
    setS({ ...s, [k]: { ...s[k], ...v } });

  return (
    <Page
      crumbs={[{ label: "Definições" }]}
      title="Definições"
      description="Dados da empresa, retenção e opções de verificação."
      actions={
        <Button
          disabled={!dirty || save.isPending}
          onClick={async () => {
            await save.mutateAsync(s);
            toast.success("Definições guardadas");
          }}
        >
          Guardar alterações
        </Button>
      }
    >
      <h2 className="mb-2 text-[14px] font-semibold tracking-tight">Empresa</h2>
      <div className="panel divide-y divide-border">
        <Row title="Nome" body="Usado por omissão no campo Empresa das novas identidades.">
          <Input
            value={s.company.name}
            onChange={(e) => set("company", { name: e.target.value })}
          />
        </Row>
        <Row title="NIF">
          <Input
            value={s.company.nif}
            onChange={(e) => set("company", { nif: e.target.value })}
            className="font-mono"
            placeholder="5000000000"
          />
        </Row>
        <Row title="País">
          <Input
            value={s.company.country}
            onChange={(e) => set("company", { country: e.target.value })}
          />
        </Row>
        <Row title="Email de contacto">
          <Input
            type="email"
            value={s.company.email}
            onChange={(e) => set("company", { email: e.target.value })}
          />
        </Row>
      </div>

      <h2 className="mb-2 mt-8 text-[14px] font-semibold tracking-tight">Verificação</h2>
      <div className="panel divide-y divide-border">
        <Row
          title="Tamanho máximo"
          body="Ficheiros acima deste limite são recusados antes da análise."
        >
          <NativeSelect
            value={s.scanning.maxSizeMb}
            onChange={(e) => set("scanning", { maxSizeMb: +e.target.value })}
          >
            {[10, 25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n} MB
              </option>
            ))}
          </NativeSelect>
        </Row>
        <Row
          title="Análise profunda de PDF"
          body="Inspeciona também objetos comprimidos em object streams, onde código malicioso costuma esconder-se."
        >
          <Switch
            checked={s.scanning.deepPdf}
            onCheckedChange={(v) => set("scanning", { deepPdf: v })}
          />
        </Row>
        <Row
          title="Reportar todas as ligações"
          body="Inclui hiperligações normais (nível informativo) e não apenas as que atuam ao abrir."
        >
          <Switch
            checked={s.scanning.reportLinks}
            onCheckedChange={(v) => set("scanning", { reportLinks: v })}
          />
        </Row>
      </div>

      <h2 className="mb-2 mt-8 text-[14px] font-semibold tracking-tight">Retenção</h2>
      <div className="panel divide-y divide-border">
        <Row
          title="Guardar versões durante"
          body="Aplica-se quando o armazenamento no servidor estiver ativo."
        >
          <NativeSelect
            value={s.retention.days ?? ""}
            onChange={(e) => set("retention", { days: e.target.value ? +e.target.value : null })}
          >
            <option value="">Sempre</option>
            <option value="30">30 dias</option>
            <option value="90">90 dias</option>
            <option value="365">1 ano</option>
          </NativeSelect>
        </Row>
        <Row
          title="Apagar ficheiros, manter análise"
          body="Ao expirar, remove o ficheiro mas mantém metadados e resultados para o corpus do autor."
        >
          <Switch
            checked={s.retention.purgeFiles}
            onCheckedChange={(v) => set("retention", { purgeFiles: v })}
          />
        </Row>
      </div>

      <h2 className="mb-2 mt-8 text-[14px] font-semibold tracking-tight">Dados locais</h2>
      <div className="panel">
        <Row
          title="Repor dados de demonstração"
          body="Apaga documentos, identidades e definições deste navegador e volta a criar os exemplos."
        >
          <Button
            variant="outline"
            className="text-danger hover:text-danger md:float-right"
            onClick={async () => {
              if (!confirm("Apagar todos os dados locais e repor a demonstração?")) return;
              await resetAll();
              location.reload();
            }}
          >
            <RotateCcw /> Repor
          </Button>
        </Row>
      </div>
    </Page>
  );
}
