import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/auth/supabase";
import type { AppRole, UserProfile } from "@/lib/auth/roles";

const key = ["users"] as const;

export const useUsers = (enabled = true) =>
  useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from("profiles")
        .select("id,email,full_name,role,created_at,last_sign_in_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as UserProfile[];
    },
  });

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: AppRole }) => {
      const { data, error } = await requireSupabase().rpc("set_user_role", {
        target: id,
        new_role: role,
      });
      if (error) throw error;
      return data as UserProfile;
    },
    onSuccess: (p) => {
      qc.setQueryData<UserProfile[]>(key, (list) =>
        list?.map((u) => (u.id === p.id ? { ...u, role: p.role } : u)),
      );
    },
  });
}
