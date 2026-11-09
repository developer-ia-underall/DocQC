import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as store from "./store";
import { seedDemo } from "./seed";
import type { AppSettings, IdentityProfile } from "@/types/domain";

let seeding: Promise<void> | null = null;
/** Seeds demo data once per browser; every query awaits it so screens never flash empty. */
export const ensureSeed = () => (seeding ??= seedDemo().catch((e) => console.error(e)));
export const resetSeed = () => {
  seeding = null;
};

export const qk = {
  docs: ["docs"] as const,
  doc: (id: string) => ["docs", id] as const,
  authors: ["authors"] as const,
  profiles: ["profiles"] as const,
  settings: ["settings"] as const,
};

export const useDocuments = () =>
  useQuery({ queryKey: qk.docs, queryFn: async () => (await ensureSeed(), store.listDocuments()) });
export const useDocument = (id: string) =>
  useQuery({
    queryKey: qk.doc(id),
    queryFn: async () => (await ensureSeed(), store.getDocument(id)),
  });
export const useAuthors = () =>
  useQuery({
    queryKey: qk.authors,
    queryFn: async () => (await ensureSeed(), store.listAuthors()),
  });
export const useProfiles = () =>
  useQuery({
    queryKey: qk.profiles,
    queryFn: async () => (await ensureSeed(), store.listProfiles()),
  });
export const useSettings = () =>
  useQuery({
    queryKey: qk.settings,
    queryFn: async () => (await ensureSeed(), store.getSettings()),
  });

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: IdentityProfile) => store.saveProfile(p),
    onSuccess: () => qc.invalidateQueries(),
  });
}
export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => store.deleteProfile(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.profiles }),
  });
}
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: AppSettings) => store.saveSettings(s),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.settings }),
  });
}
export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => store.deleteDocument(id),
    onSuccess: () => qc.invalidateQueries(),
  });
}
