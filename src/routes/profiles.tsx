import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Fingerprint,
  Monitor,
  Plus,
  Trash2,
  Building2,
  Clock,
  Lock,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Page, EmptyState } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { IdentityForm } from "@/components/identity/identity-form";
import { useAuth } from "@/lib/auth/context";
import { authEnabled } from "@/lib/auth/supabase";
import { atLeast } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { identityAccess } from "@/services/identities";
import { useDeleteProfile, useProfiles } from "@/services/queries";
import type { IdentityProfile } from "@/types/domain";

export const Route = createFileRoute("/profiles")({
  head: () => ({ meta: [{ title: "Identidades · DocQC" }] }),
  component: ProfilesPage,
});

const SCOPE_HINT = {
  user: "Vê apenas as suas identidades.",
  gestor: "Como gestor, vê as identidades de todas as contas; altera apenas as suas.",
  admin: "Como administrador, vê e altera as identidades de todas as contas.",
} as const;

function ProfilesPage() {
  const { data: profiles = [], isPending } = useProfiles();
  const { session, profile } = useAuth();
  const remove = useDeleteProfile();
  // null = fechado; "new" = criar; senão a identidade a ver/editar.
  const [open, setOpen] = useState<IdentityProfile | "new" | null>(null);
  const seesAll = authEnabled && atLeast(profile?.role, "gestor");
  const [scope, setScope] = useState<"mine" | "all">("all");
  const me = { id: session?.user.id, role: profile?.role };

  const visible = useMemo(
    () =>
      seesAll && scope === "mine"
        ? profiles.filter((p) => p.ownerId === session?.user.id)
        : profiles,
    [profiles, scope, seesAll, session?.user.id],
  );
  const mineCount = profiles.filter((p) => !p.ownerId || p.ownerId === session?.user.id).length;

  const current = open && open !== "new" ? open : null;
  const access = current ? identityAccess(current, me) : { mine: true, canEdit: true };

  return (
    <Page
      crumbs={[{ label: "Identidades" }]}
      title="Identidades"
      description="Pessoas e máquinas reais da empresa que ficam registadas nos metadados quando um documento é entregue."
      actions={
        <Button onClick={() => setOpen("new")} data-tour="new-identity">
          <Plus /> Nova identidade
        </Button>
      }
    >
      {authEnabled && profile && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-muted-foreground">{SCOPE_HINT[profile.role]}</p>
          {seesAll && (
            <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-[12.5px]">
              {(
                [
                  ["all", `Todas · ${profiles.length}`],
                  ["mine", `As minhas · ${mineCount}`],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setScope(k)}
                  className={cn(
                    "rounded px-2.5 py-1 transition-colors",
                    scope === k
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isPending ? (
        <div className="panel divide-y divide-border">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="h-4 w-48" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Fingerprint}
          title={scope === "mine" || !seesAll ? "Ainda não tem identidades" : "Sem identidades"}
          body="Crie a sua identidade para poder entregar documentos com metadados da empresa. Os dados do computador são preenchidos automaticamente."
          action={<Button onClick={() => setOpen("new")}>Nova identidade</Button>}
        />
      ) : (
        <motion.ul
          className="panel divide-y divide-border overflow-hidden"
          initial="h"
          animate="s"
          variants={{ s: { transition: { staggerChildren: 0.04 } } }}
        >
          {visible.map((p) => {
            const a = identityAccess(p, me);
            return (
              <motion.li key={p.id} variants={{ h: { opacity: 0, y: 4 }, s: { opacity: 1, y: 0 } }}>
                <button
                  onClick={() => setOpen(p)}
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
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{p.fullName}</span>
                      {!a.canEdit && (
                        <Lock
                          className="size-3 shrink-0 text-muted-foreground"
                          aria-label="Só leitura"
                        />
                      )}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {seesAll && p.ownerEmail ? (
                        <span className="inline-flex items-center gap-1">
                          <UserRound className="size-3" />
                          {a.mine ? "Sua" : p.ownerName || p.ownerEmail}
                          {p.role ? ` · ${p.role}` : ""}
                        </span>
                      ) : (
                        <>
                          {p.role}
                          {p.email ? ` · ${p.email}` : ""}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground md:col-start-auto">
                    <Monitor className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {p.computerName} · {p.os || "—"}
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
            );
          })}
        </motion.ul>
      )}

      <p className="mt-4 max-w-2xl text-[12px] text-muted-foreground">
        Use apenas identidades de pessoas que aprovaram o documento. Os metadados passam a indicar
        quem o assume perante o destinatário.
      </p>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent>
          {open && (
            <div className="flex h-full flex-col">
              <div className="border-b border-border px-5 py-4">
                <SheetTitle className="text-[15px] font-semibold">
                  {open === "new"
                    ? "Nova identidade"
                    : access.canEdit
                      ? "Editar identidade"
                      : "Identidade"}
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {current && !access.mine && current.ownerEmail
                    ? `Pertence a ${current.ownerName || current.ownerEmail}.`
                    : "Pessoa e máquina a registar nos metadados."}
                </SheetDescription>
              </div>
              <IdentityForm
                key={current?.id ?? "new"}
                initial={current}
                readOnly={!access.canEdit}
                onSaved={() => setOpen(null)}
                footerStart={
                  current && access.canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-danger hover:text-danger"
                      onClick={async () => {
                        try {
                          await remove.mutateAsync(current.id);
                          toast.success("Identidade removida");
                          setOpen(null);
                        } catch (e) {
                          toast.error("Não foi possível remover", {
                            description: e instanceof Error ? e.message : String(e),
                          });
                        }
                      }}
                    >
                      <Trash2 /> Remover
                    </Button>
                  ) : undefined
                }
                footerEnd={
                  <Button type="button" variant="outline" onClick={() => setOpen(null)}>
                    {access.canEdit ? "Cancelar" : "Fechar"}
                  </Button>
                }
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </Page>
  );
}
