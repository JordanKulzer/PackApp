import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "../lib/supabase";

export interface CurrentUserProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
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

  console.log('[Provider] render. user.displayName =', user?.displayName);

  const refresh = useCallback(async () => {
    console.log('[Context] refresh() START');
    const { data: session } = await supabase.auth.getUser();
    if (!session?.user) {
      console.log('[Context] refresh() no session, setting user to null');
      setUser(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("users")
      .select("id, display_name, avatar_url, email")
      .eq("id", session.user.id)
      .single();
    if (error || !data) {
      console.log('[Context] refresh() ERROR or no data:', error?.message);
      setUser(null);
    } else {
      console.log('[Context] refresh() DB returned display_name:', data.display_name);
      setUser({
        id: data.id,
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
        email: data.email,
      });
    }
    setLoading(false);
  }, []);

  const applyLocal = useCallback((patch: Partial<CurrentUserProfile>) => {
    console.log('[Context] applyLocal() patch:', JSON.stringify(patch));
    setUser((prev) => {
      const next = prev ? { ...prev, ...patch } : prev;
      console.log('[Context] applyLocal() new displayName:', next?.displayName);
      return next;
    });
  }, []);

  useEffect(() => {
    console.log('[Provider] MOUNT');
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      console.log('[Provider] auth state change, refreshing');
      refresh();
    });
    return () => {
      console.log('[Provider] UNMOUNT');
      sub.subscription.unsubscribe();
    };
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
