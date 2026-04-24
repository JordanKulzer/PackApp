import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "../lib/supabase";

export interface CurrentUserProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  hasCompletedOnboarding: boolean;
}

interface CurrentUserContextValue {
  user: CurrentUserProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  applyLocal: (patch: Partial<CurrentUserProfile>) => void;
}

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data: session } = await supabase.auth.getUser();
    if (!session?.user) {
      setUser(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("users")
      .select("id, display_name, avatar_url, has_completed_onboarding")
      .eq("id", session.user.id)
      .single();
    if (error || !data) {
      setUser(null);
    } else {
      setUser({
        id: data.id,
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
        hasCompletedOnboarding: data.has_completed_onboarding ?? false,
      });
    }
    setLoading(false);
  }, []);

  const applyLocal = useCallback((patch: Partial<CurrentUserProfile>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  return (
    <CurrentUserContext.Provider value={{ user, loading, refresh, applyLocal }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser() {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) throw new Error("useCurrentUser must be used within CurrentUserProvider");
  return ctx;
}
