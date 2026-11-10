import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Cpu, Info, Laptop, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth/context";
import {
  COMPUTER_NAME_HELP,
  describeDevice,
  detectDevice,
  suggestApplication,
  suggestComputerName,
} from "@/lib/device";
import { cn } from "@/lib/utils";
import { useSaveProfile, useSettings } from "@/services/queries";
import type { DeviceInfo, IdentityProfile } from "@/types/domain";

export const APPS = [
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

/** De onde veio o valor de cada campo pré-preenchido (desaparece quando a pessoa edita). */
type Auto = Partial<
  Record<
    "os" | "computerName" | "application" | "timezone" | "fullName" | "email" | "company",
    "detected" | "suggested" | "account" | undefined
  >
>;

const blank = (): IdentityProfile => ({
  id: "",
  fullName: "",
  role: "",
  email: "",
  computerName: "",
  os: "",
  application: "Microsoft Word 16.0",
  company: "",
  timezone: "Africa/Luanda",
  createdAt: "",
  ownDevice: true,
});

export interface IdentityFormProps {
  /** Identidade a editar; sem ela, cria uma nova pré-preenchida com os dados deste computador. */
  initial?: IdentityProfile | null;
  readOnly?: boolean;
  /** Versão compacta, para o card do guia. */
  compact?: boolean;
  submitLabel?: string;
  onSaved?: (p: IdentityProfile) => void;
  /** Botões extra à esquerda (ex.: Remover). */
  footerStart?: ReactNode;
  footerEnd?: ReactNode;
}

export function IdentityForm({
  initial,
  readOnly,
  compact,
  submitLabel = "Guardar",
  onSaved,
  footerStart,
  footerEnd,
}: IdentityFormProps) {
  const { session, profile } = useAuth();
  const { data: settings } = useSettings();
  const save = useSaveProfile();
  const isNew = !initial?.id;
  const [v, setV] = useState<IdentityProfile>(() => initial ?? blank());
  const [auto, setAuto] = useState<Auto>({});
  const [device, setDevice] = useState<DeviceInfo | null>(initial?.detected ?? null);
  const filled = useRef(false);

  // Nova identidade: pessoa a partir da conta, máquina a partir deste computador.
  useEffect(() => {
    if (!isNew || filled.current) return;
    filled.current = true;
    void detectDevice().then((d) => {
      setDevice(d);
      setV((cur) => {
        const fullName = cur.fullName || profile?.full_name || "";
        const company = cur.company || settings?.company.name || "";
        return {
          ...cur,
          fullName,
          email: cur.email || session?.user.email || "",
          company,
          ...(cur.ownDevice !== false ? machineFrom(d, fullName, company) : {}),
          detected: d,
        };
      });
      setAuto({
        ...(profile?.full_name ? { fullName: "account" as const } : {}),
        ...(session?.user.email ? { email: "account" as const } : {}),
        ...(settings?.company.name ? { company: "account" as const } : {}),
        os: d.os ? "detected" : undefined,
        timezone: d.timezone ? "detected" : undefined,
        application: "suggested",
        computerName: "suggested",
      });
    });
  }, [isNew, profile?.full_name, session?.user.email, settings?.company.name]);

  const tzOptions = useMemo(
    () => (v.timezone && !TZ.includes(v.timezone) ? [v.timezone, ...TZ] : TZ),
    [v.timezone],
  );

  const setOwnDevice = (own: boolean) => {
    setV((cur) => {
      if (own && device)
        return { ...cur, ownDevice: true, ...machineFrom(device, cur.fullName, cur.company) };
      // Noutro computador: os dados lidos não são os da máquina da pessoa, por isso limpam-se.
      return { ...cur, ownDevice: own, os: "", computerName: "" };
    });
    setAuto((a) =>
      own && device
        ? {
            ...a,
            os: device.os ? "detected" : undefined,
            timezone: "detected",
            application: "suggested",
            computerName: "suggested",
          }
        : {
            ...a,
            os: undefined,
            computerName: undefined,
            application: undefined,
            timezone: undefined,
          },
    );
  };

  const f = (k: keyof IdentityProfile) => ({
    value: (v[k] as string | undefined) ?? "",
    disabled: readOnly,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.value;
      setV((p) => {
        const nextV = { ...p, [k]: value };
        // Enquanto o nome do computador for a sugestão, acompanha o nome e a empresa.
        if ((k === "fullName" || k === "company") && auto.computerName === "suggested")
          nextV.computerName = suggestComputerName(nextV.fullName, nextV.company);
        return nextV;
      });
      setAuto((a) => ({ ...a, [k]: undefined }));
    },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (!v.fullName.trim() || !v.computerName.trim()) {
      toast.error("Nome e computador são obrigatórios");
      return;
    }
    try {
      const saved = await save.mutateAsync(v);
      toast.success(isNew ? "Identidade criada" : "Identidade atualizada");
      onSaved?.(saved);
    } catch (err) {
      toast.error("Não foi possível guardar", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const help = device ? COMPUTER_NAME_HELP[device.platform] : undefined;
  const gap = compact ? "space-y-3" : "space-y-6";

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <div className={cn("flex-1 overflow-y-auto", compact ? "space-y-3" : "space-y-6 px-5 py-5")}>
        {readOnly && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-subtle px-3 py-2 text-[12px] text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Pode ver esta identidade porque é gestor. Só o dono
              {initial?.ownerEmail ? ` (${initial.ownerEmail})` : ""} ou um administrador a podem
              alterar.
            </span>
          </div>
        )}

        {isNew && !readOnly && (
          <div className="rounded-lg border border-border bg-subtle p-3">
            <label className="flex cursor-pointer items-center gap-3">
              <Laptop className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">Estou no meu computador</span>
                <span className="block text-[11.5px] text-muted-foreground">
                  {v.ownDevice !== false
                    ? "Os dados da máquina foram lidos deste computador. Pode editá-los."
                    : "Preencha os dados do computador onde costuma trabalhar."}
                </span>
              </span>
              <Switch checked={v.ownDevice !== false} onCheckedChange={setOwnDevice} />
            </label>
            <AnimatePresence initial={false}>
              {device && v.ownDevice !== false && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border pt-2.5">
                    <Cpu className="size-3.5 text-muted-foreground" />
                    {describeDevice(device).map((x) => (
                      <span
                        key={x}
                        className="rounded border border-border bg-card px-1.5 py-px font-mono text-[10.5px] text-muted-foreground"
                      >
                        {x}
                      </span>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <div className={gap}>
          <fieldset className="space-y-3">
            <legend className="eyebrow mb-1">Pessoa</legend>
            <Field label="Nome completo" tag={auto.fullName}>
              <Input
                autoFocus={!compact && !readOnly}
                {...f("fullName")}
                placeholder="Eliúde Francisco"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cargo">
                <Input {...f("role")} placeholder="Diretor de Operações" />
              </Field>
              <Field label="Email" tag={auto.email}>
                <Input type="email" {...f("email")} placeholder="nome@empresa.co.ao" />
              </Field>
            </div>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="eyebrow mb-1">Máquina</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Nome do computador"
                tag={auto.computerName}
                hint={
                  !readOnly && auto.computerName === "suggested"
                    ? "O navegador não lê o nome real. Confirme."
                    : undefined
                }
              >
                <Input {...f("computerName")} placeholder="C4A-LDA-EF01" className="font-mono" />
              </Field>
              <Field label="Sistema operativo" tag={auto.os}>
                <Input {...f("os")} placeholder="Windows 11 Pro" />
              </Field>
            </div>
            {!readOnly && auto.computerName === "suggested" && help && (
              <p className="-mt-1 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
                <Info className="mt-0.5 size-3 shrink-0" /> Onde ver o nome: {help}
              </p>
            )}
            <Field
              label="Aplicação (Creator / Application)"
              tag={auto.application}
              hint={
                compact
                  ? undefined
                  : "Para Word/Excel/PowerPoint o DocQC usa o nome exato que o Office grava."
              }
            >
              <Input list="apps" {...f("application")} />
              <datalist id="apps">
                {APPS.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Empresa" tag={auto.company}>
                <Input {...f("company")} />
              </Field>
              <Field label="Fuso horário" tag={auto.timezone}>
                <NativeSelect {...f("timezone")}>
                  {tzOptions.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </fieldset>
        </div>
      </div>

      <div
        className={cn(
          "flex items-center justify-between gap-2",
          compact ? "pt-4" : "border-t border-border px-5 py-3",
        )}
      >
        {footerStart ?? <span />}
        <div className="flex gap-2">
          {footerEnd}
          {!readOnly && (
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "A guardar…" : submitLabel}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

function machineFrom(d: DeviceInfo, fullName: string, company: string) {
  return {
    os: d.os,
    // O Windows indica o fuso WAT como Africa/Lagos; para Angola usa-se o nome local.
    timezone: !d.timezone || d.timezone === "Africa/Lagos" ? "Africa/Luanda" : d.timezone,
    application: suggestApplication(d.platform),
    computerName: suggestComputerName(fullName, company),
  };
}

const TAG = {
  detected: { label: "Detetado", icon: Cpu },
  suggested: { label: "Sugestão", icon: Sparkles },
  account: { label: "Da conta", icon: null },
} as const;

function Field({
  label,
  hint,
  tag,
  children,
}: {
  label: string;
  hint?: string | undefined;
  tag?: keyof typeof TAG | undefined;
  children: ReactNode;
}) {
  const t = tag ? TAG[tag] : null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {t && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-1 text-[10px] font-medium leading-4",
              tag === "detected" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            {t.icon && <t.icon className="size-2.5" />}
            {t.label}
          </span>
        )}
      </div>
      {children}
      {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
