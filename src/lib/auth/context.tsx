import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { authEnabled, supabase } from "./supabase";
import type { UserProfile } from "./roles";

interface AuthState {
  /** false enquanto a sessão guardada ainda está a ser lida. */
  ready: boolean;
  session: Session | null;
  profile: UserProfile | null;
  refreshProfile: () => Promise<void>;
  /** Regista que o guia do primeiro login foi visto ou fechado. */
  markOnboarded: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  ready: true,
  session: null,
  profile: null,
  refreshProfile: async () => {},
  markOnboarded: async () => {},
  signOut: async () => {},
});

async function loadProfile(userId: string): Promise<UserProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,created_at,last_sign_in_at,onboarded_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) console.error(error);
  return (data as UserProfile | null) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!authEnabled);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const apply = async (s: Session | null) => {
      const p = s ? await loadProfile(s.user.id) : null;
      if (!alive) return;
      setSession(s);
      setProfile(p);
      setReady(true);
    };
    void supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      // Renovações de token não mudam o utilizador: evita recarregar o perfil.
      if (event === "TOKEN_REFRESHED") return setSession(s);
      // Fora do callback: chamadas ao Supabase dentro dele podem bloquear o cliente.
      setTimeout(() => void apply(s), 0);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session) setProfile(await loadProfile(session.user.id));
  }, [session]);

  const markOnboarded = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("mark_onboarded");
    if (error) return console.error(error);
    setProfile((p) =>
      p ? { ...p, onboarded_at: (data as string | null) ?? new Date().toISOString() } : p,
    );
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider
      value={{ ready, session, profile, refreshProfile, markOnboarded, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
