import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { supabase } from './supabase';

type AuthState = {
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState>({ session: null, isAdmin: false, loading: true, signOut: async () => {} });

export const useAuth = () => useContext(Ctx);

// Signs the person out after 30 minutes with no activity. A business
// dashboard left open on a shared computer should not stay signed in.
const IDLE_MS = 30 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  async function loadAdmin(s: Session | null) {
    if (!s) return setIsAdmin(false);
    const { data } = await supabase.from('profiles').select('is_admin').eq('id', s.user.id).maybeSingle();
    setIsAdmin(data?.is_admin === true);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadAdmin(data.session).finally(() => setLoading(false));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      loadAdmin(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    const reset = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => supabase.auth.signOut(), IDLE_MS);
    };
    const events = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      window.clearTimeout(timer.current);
    };
  }, [session]);

  return (
    <Ctx.Provider value={{ session, isAdmin, loading, signOut: async () => void (await supabase.auth.signOut()) }}>
      {children}
    </Ctx.Provider>
  );
}
