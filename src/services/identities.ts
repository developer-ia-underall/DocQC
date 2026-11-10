/**
 * Identidades: no Supabase (tabela public.identities, com RLS por papel) quando há login;
 * no IndexedDB do navegador em modo local (build estática de testes).
 *
 * Quem vê o quê é decidido pela base de dados (ver supabase/migrations/…_identities_onboarding.sql):
 * utilizador → só as suas; gestor → todas (edita só as suas); administrador → todas.
 */
import { supabase } from "@/lib/auth/supabase";
import type { AppRole } from "@/lib/auth/roles";
import type { DeviceInfo, IdentityProfile } from "@/types/domain";
import * as store from "./store";

interface IdentityRow {
  id: string;
  owner_id: string;
  full_name: string;
  job_title: string;
  email: string;
  computer_name: string;
  os: string;
  application: string;
  company: string;
  timezone: string;
  detected: DeviceInfo | null;
  own_device: boolean;
  created_at: string;
  owner?: { email: string; full_name: string | null } | null;
}

const COLUMNS =
  "id,owner_id,full_name,job_title,email,computer_name,os,application,company,timezone,detected,own_device,created_at,owner:profiles!identities_owner_id_fkey(email,full_name)";

const fromRow = (r: IdentityRow): IdentityProfile => ({
  id: r.id,
  fullName: r.full_name,
  role: r.job_title,
  email: r.email,
  computerName: r.computer_name,
  os: r.os,
  application: r.application,
  company: r.company,
  timezone: r.timezone,
  createdAt: r.created_at,
  ownerId: r.owner_id,
  ownerEmail: r.owner?.email,
  ownerName: r.owner?.full_name ?? undefined,
  ownDevice: r.own_device,
  detected: r.detected,
});

const toRow = (p: IdentityProfile) => ({
  full_name: p.fullName.trim(),
  job_title: p.role.trim(),
  email: p.email.trim(),
  computer_name: p.computerName.trim(),
  os: p.os.trim(),
  application: p.application.trim(),
  company: p.company.trim(),
  timezone: p.timezone,
  own_device: p.ownDevice ?? true,
  detected: p.detected ?? null,
});

export async function listIdentities(): Promise<IdentityProfile[]> {
  if (!supabase) return store.listProfiles();
  const { data, error } = await supabase
    .from("identities")
    .select(COLUMNS)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as IdentityRow[]).map(fromRow);
}

/** Cria (sem id) ou atualiza. Devolve a identidade guardada. */
export async function saveIdentity(p: IdentityProfile): Promise<IdentityProfile> {
  if (!supabase) {
    const saved = {
      ...p,
      id: p.id || crypto.randomUUID(),
      createdAt: p.createdAt || new Date().toISOString(),
    };
    await store.saveProfile(saved);
    return saved;
  }
  const q = p.id
    ? supabase.from("identities").update(toRow(p)).eq("id", p.id)
    : supabase.from("identities").insert(toRow(p));
  const { data, error } = await q.select(COLUMNS).single();
  if (error) throw error;
  // Mantém a biblioteca de autores (local) a par, como antes.
  await store.resolveAuthor(p.fullName);
  return fromRow(data as unknown as IdentityRow);
}

export async function deleteIdentity(id: string): Promise<void> {
  if (!supabase) return store.deleteProfile(id);
  const { error, count } = await supabase
    .from("identities")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) throw error;
  if (count === 0) throw new Error("Sem permissão para remover esta identidade.");
}

/** O que a conta atual pode fazer com uma identidade (espelha as regras da base de dados). */
export function identityAccess(
  p: Pick<IdentityProfile, "ownerId">,
  me: { id?: string | undefined; role?: AppRole | undefined },
) {
  // Modo local: sem contas, tudo é editável.
  if (!supabase || !p.ownerId) return { mine: true, canEdit: true };
  const mine = p.ownerId === me.id;
  return { mine, canEdit: mine || me.role === "admin" };
}

/** Nome a gravar como "carregado por" nos documentos. */
export async function uploaderName(): Promise<string> {
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (user) {
      const { data: rows } = await supabase
        .from("identities")
        .select("full_name")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1);
      return (
        rows?.[0]?.full_name ??
        (user.user_metadata?.["full_name"] as string | undefined) ??
        user.email ??
        "Utilizador"
      );
    }
  }
  return (await store.listProfiles())[0]?.fullName ?? "Utilizador";
}
