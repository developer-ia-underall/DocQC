import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, ShieldAlert, Users } from "lucide-react";
import { EmptyState, Page } from "@/components/app/page";
import { Pill } from "@/components/app/status";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/context";
import {
  ROLE_HINT,
  ROLE_LABEL,
  ROLES,
  atLeast,
  authErrorMessage,
  type AppRole,
  type UserProfile,
} from "@/lib/auth/roles";
import { confirmAction } from "@/lib/platform";
import { useSetUserRole, useUsers } from "@/services/users";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Utilizadores · DocQC" }] }),
  component: UsersPage,
});

const roleTone = { admin: "info", gestor: "warning", user: "neutral" } as const;

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

function UsersPage() {
  const { profile } = useAuth();
  const canView = atLeast(profile?.role, "gestor");
  const isAdmin = profile?.role === "admin";
  const { data: users, isLoading, error } = useUsers(canView);
  const setRole = useSetUserRole();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users ?? []).filter(
      (u) => !s || u.email.includes(s) || (u.full_name ?? "").toLowerCase().includes(s),
    );
  }, [users, q]);

  const counts = useMemo(
    () =>
      ROLES.reduce(
        (acc, r) => ({ ...acc, [r]: (users ?? []).filter((u) => u.role === r).length }),
        {} as Record<AppRole, number>,
      ),
    [users],
  );

  const change = (u: UserProfile, role: AppRole) => {
    if (role === u.role) return;
    const run = async () => {
      try {
        await setRole.mutateAsync({ id: u.id, role });
        toast.success(`${u.full_name || u.email} é agora ${ROLE_LABEL[role].toLowerCase()}`);
      } catch (e) {
        toast.error(authErrorMessage(e));
      }
    };
    if (role === "admin" || u.id === profile?.id) {
      const who = u.id === profile?.id ? "a sua própria conta" : u.full_name || u.email;
      confirmAction(`Alterar ${who} para ${ROLE_LABEL[role]}?`, "Confirmar", run);
    } else void run();
  };

  if (!canView) {
    return (
      <Page crumbs={[{ label: "Utilizadores" }]} title="Utilizadores">
        <EmptyState
          icon={ShieldAlert}
          title="Sem permissão"
          body="Só gestores e administradores podem ver as contas."
        />
      </Page>
    );
  }

  return (
    <Page
      crumbs={[{ label: "Utilizadores" }]}
      title="Utilizadores"
      description={
        isAdmin
          ? "Contas registadas e respetivos papéis. Novas contas entram como utilizador."
          : "Contas registadas. Só administradores podem alterar papéis."
      }
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Procurar por nome ou e-mail"
            className="pl-8"
          />
        </div>
        <div className="flex gap-4 text-[12.5px] text-muted-foreground">
          {ROLES.map((r) => (
            <span key={r}>
              <span className="tnum font-medium text-foreground">{counts[r] ?? 0}</span>{" "}
              {ROLE_LABEL[r].toLowerCase()}
              {(counts[r] ?? 0) === 1 ? "" : "es"}
            </span>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : error ? (
        <EmptyState icon={ShieldAlert} title="Erro ao carregar" body={authErrorMessage(error)} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="Nenhuma conta" body="Nada corresponde à pesquisa." />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Conta</th>
                <th className="px-4 py-2.5 font-medium">Criada</th>
                <th className="px-4 py-2.5 font-medium">Último acesso</th>
                <th className="w-[200px] px-4 py-2.5 font-medium">Papel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((u) => (
                <tr key={u.id} className="hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 font-medium">
                      {u.full_name || u.email.split("@")[0]}
                      {u.id === profile?.id && (
                        <span className="text-[11.5px] font-normal text-muted-foreground">
                          (você)
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="tnum px-4 py-2.5 text-muted-foreground">{fmt(u.created_at)}</td>
                  <td className="tnum px-4 py-2.5 text-muted-foreground">
                    {fmt(u.last_sign_in_at)}
                  </td>
                  <td className="px-4 py-2.5">
                    {isAdmin ? (
                      <NativeSelect
                        aria-label={`Papel de ${u.email}`}
                        value={u.role}
                        disabled={setRole.isPending}
                        onChange={(e) => change(u, e.target.value as AppRole)}
                        title={ROLE_HINT[u.role]}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Pill t={roleTone[u.role]}>{ROLE_LABEL[u.role]}</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 grid gap-3 text-[12.5px] text-muted-foreground sm:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r}>
            <span className="font-medium text-foreground">{ROLE_LABEL[r]}.</span> {ROLE_HINT[r]}
          </div>
        ))}
      </div>
    </Page>
  );
}
