import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalPresence } from "@/hooks/useGlobalPresence";
import { ensurePushSubscription, unsubscribePush } from "@/lib/pushNotifications";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({ user: null, session: null, loading: true, isAdmin: false, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // defer DB call
        setTimeout(async () => {
          const { data } = await supabase.from("user_roles").select("role").eq("user_id", s.user.id).eq("role", "admin").maybeSingle();
          const admin = !!data;
          setIsAdmin(admin);
          ensurePushSubscription({ isAdmin: admin });
        }, 0);
      } else {
        setIsAdmin(false);
        unsubscribePush();
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
      if (data.session?.user) {
        supabase.from("user_roles").select("role").eq("user_id", data.session.user.id).eq("role", "admin").maybeSingle().then(({ data: r }) => {
          const admin = !!r;
          setIsAdmin(admin);
          ensurePushSubscription({ isAdmin: admin });
        });
      }
    });

    // Auto-lock: rehefa miala ny app ela be (30 min), vao manala
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        sessionStorage.setItem("dmga_lastHide", String(Date.now()));
      } else {
        const t = Number(sessionStorage.getItem("dmga_lastHide") || 0);
        if (t && Date.now() - t > 30 * 60_000) {
          supabase.auth.signOut();
        }
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      sub.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); };

  // Track presence globally — only while the app is open & visible.
  useGlobalPresence(user);

  return <Ctx.Provider value={{ user, session, loading, isAdmin, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
