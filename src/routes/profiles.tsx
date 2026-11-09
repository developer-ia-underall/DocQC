import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { Fingerprint, Monitor, Plus, Trash2, Building2, Clock } from "lucide-react";
import { toast } from "sonner";
import { Page, EmptyState } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteProfile, useProfiles, useSaveProfile, useSettings } from "@/services/queries";
import { uid } from "@/lib/format";
import type { IdentityProfile } from "@/types/domain";

export const Route = createFileRoute("/profiles")({
  head: () => ({ meta: [{ title: "Identidades · DocQC" }] }),
  component: ProfilesPage,
});

const APPS = [
  "Microsoft Word 16.0",
  "Microsoft Excel 16.0",
  "Microsoft PowerPoint 16.0",
  "LibreOffice 24.8",
  "Apple Pages 14.2",
  "Adobe Acrobat Pro 24.0",
];
const TZ = [
  "Africa/Luanda",
  "Europe/Lisbon",
  "Africa/Maputo",
  "America/Sao_Paulo",
  "Atlantic/Cape_Verde",
  "Europe/London",
  "UTC",
];

const empty = (company: string): IdentityProfile => ({
  id: "",
  fullName: "",
  role: "",
  email: "",
  computerName: "",
  os: "Windows 11 Pro",
  application: "Microsoft Word 16.0",
  company,
  timezone: "Africa/Luanda",
  createdAt: "",
});

function ProfilesPage() {
  const { data: profiles = [], isPending } = useProfiles();
  const { data: settings } = useSettings();
  const save = useSaveProfile();
  const remove = useDeleteProfile();
  const [edit, setEdit] = useState<IdentityProfile | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    if (!edit.fullName.trim() || !edit.computerName.trim()) {
      toast.error("Nome e computador são obrigatórios");
      return;
    }
    const isNew = !edit.id;
    await save.mutateAsync({
      ...edit,
      id: edit.id || uid(),
      createdAt: edit.createdAt || new Date().toISOString(),
    });
    toast.success(isNew ? "Identidade criada" : "Identidade atualizada");
    setEdit(null);
  };
  const f = (k: keyof IdentityProfile) => ({
    value: edit?.[k] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setEdit((p) => (p ? { ...p, [k]: e.target.value } : p)),
  });

  return (
    <Page
      crumbs={[{ label: "Identidades" }]}
      title="Identidades"
      description="Pessoas e máquinas reais da empresa que ficam registadas nos metadados quando um documento é entregue."
      actions={
        <Button onClick={() => setEdit(empty(settings?.company.name ?? ""))}>
          <Plus /> Nova identidade
        </Button>
      }
    >
      {isPending ? (
        <div className="panel divide-y divide-border">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="h-4 w-48" />
            </div>
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <EmptyState
          icon={Fingerprint}
          title="Sem identidades"
          body="Crie a primeira identidade para poder entregar documentos com metadados da empresa."
          action={
            <Button onClick={() => setEdit(empty(settings?.company.name ?? ""))}>
              Nova identidade
            </Button>
          }
        />
      ) : (
        <motion.ul
          className="panel divide-y divide-border overflow-hidden"
          initial="h"
          animate="s"
          variants={{ s: { transition: { staggerChildren: 0.04 } } }}
        >
          {profiles.map((p) => (
            <motion.li key={p.id} variants={{ h: { opacity: 0, y: 4 }, s: { opacity: 1, y: 0 } }}>
              <button
                onClick={() => setEdit(p)}
                className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-subtle md:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <span className="grid size-9 place-items-center rounded-full bg-muted text-[12px] font-semibold">
                  {p.fullName
                    .split(" ")
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.fullName}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {p.role}
                    {p.email ? ` · ${p.email}` : ""}
                  </span>
                </span>
                <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground md:col-start-auto">
                  <Monitor className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {p.computerName} · {p.os}
                  </span>
                </span>
                <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground md:col-start-auto">
                  <Building2 className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {p.application} · {p.company || "sem empresa"}
                  </span>
                </span>
                <span className="row-start-1 flex items-center gap-1 text-[12px] text-muted-foreground md:row-start-auto">
                  <Clock className="size-3.5" /> {p.timezone.split("/").pop()?.replace("_", " ")}
                </span>
              </button>
            </motion.li>
          ))}
        </motion.ul>
      )}

      <p className="mt-4 max-w-2xl text-[12px] text-muted-foreground">
        Use apenas identidades de pessoas que aprovaram o documento. Os metadados passam a indicar
        quem o assume perante o destinatário.
      </p>

      <Sheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <SheetContent>
          {edit && (
            <form onSubmit={submit} className="flex h-full flex-col">
              <div className="border-b border-border px-5 py-4">
                <SheetTitle className="text-[15px] font-semibold">
                  {edit.id ? "Editar identidade" : "Nova identidade"}
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-[12.5px] text-muted-foreground">
                  Pessoa e máquina a registar nos metadados.
                </SheetDescription>
              </div>
              <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
                <fieldset className="space-y-3">
                  <legend className="eyebrow mb-1">Pessoa</legend>
                  <Field label="Nome completo">
                    <Input autoFocus {...f("fullName")} placeholder="Eliúde Francisco" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Cargo">
                      <Input {...f("role")} placeholder="Diretor de Operações" />
                    </Field>
                    <Field label="Email">
                      <Input type="email" {...f("email")} placeholder="nome@empresa.co.ao" />
                    </Field>
                  </div>
                </fieldset>
                <fieldset className="space-y-3">
                  <legend className="eyebrow mb-1">Máquina</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nome do computador">
                      <Input
                        {...f("computerName")}
                        placeholder="C4A-LDA-EF01"
                        className="font-mono"
                      />
                    </Field>
                    <Field label="Sistema operativo">
                      <Input {...f("os")} />
                    </Field>
                  </div>
                  <Field
                    label="Aplicação (Creator / Application)"
                    hint="Para Word/Excel/PowerPoint o DocQC usa o nome exato que o Office grava."
                  >
                    <Input list="apps" {...f("application")} />
                    <datalist id="apps">
                      {APPS.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Empresa">
                      <Input {...f("company")} />
                    </Field>
                    <Field label="Fuso horário">
                      <NativeSelect {...f("timezone")}>
                        {TZ.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  </div>
                </fieldset>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
                {edit.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-danger hover:text-danger"
                    onClick={async () => {
                      await remove.mutateAsync(edit.id);
                      toast.success("Identidade removida");
                      setEdit(null);
                    }}
                  >
                    <Trash2 /> Remover
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setEdit(null)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={save.isPending}>
                    Guardar
                  </Button>
                </div>
              </div>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </Page>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
