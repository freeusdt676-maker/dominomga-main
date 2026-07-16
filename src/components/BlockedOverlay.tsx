import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Affichage plein-écran rouge clignotant lorsqu'un compte est bloqué
 * par l'ADMINISTRATIF. Bloque totalement l'utilisation de l'application
 * jusqu'au déblocage par l'admin.
 */
export default function BlockedOverlay() {
  const { user, signOut } = useAuth();
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!user) {
      setBlocked(false);
      return;
    }
    let alive = true;
    const check = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("account_status")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!alive) return;
      setBlocked(data?.account_status === "blocked");
    };
    check();
    const ch = supabase
      .channel(`profile-block-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` },
        (p: any) => {
          if (!alive) return;
          setBlocked(p.new?.account_status === "blocked");
        },
      )
      .subscribe();
    const itv = setInterval(check, 8000);
    return () => {
      alive = false;
      supabase.removeChannel(ch);
      clearInterval(itv);
    };
  }, [user]);

  if (!blocked) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center select-none">
      <div className="animate-pulse">
        <p className="text-red-500 font-display font-black text-3xl sm:text-5xl leading-tight tracking-tight animate-bounce drop-shadow-[0_0_18px_rgba(239,68,68,0.9)]">
          BLOQUÉ NY COMPTE NAO
        </p>
        <p className="mt-4 text-red-400 font-bold text-lg sm:text-2xl animate-pulse">
          MIFANDRAISA AMIN'NY ADMINISTRATIF
        </p>
        <a
          href="tel:0345023006"
          className="mt-6 inline-block text-yellow-300 font-mono font-black text-2xl sm:text-4xl underline animate-pulse drop-shadow-[0_0_12px_rgba(253,224,71,0.8)]"
        >
          TEL: 0345023006
        </a>
      </div>
      <button
        onClick={() => signOut()}
        className="mt-10 px-5 py-2 rounded-lg border border-red-500/60 text-red-200 hover:bg-red-500/20 text-sm"
      >
        Hivoaka
      </button>
    </div>
  );
}