import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import SpectatorHub from "./SpectatorHub";

type Props = {
  /** Position helper — controls fixed placement and offset from ADMINISTRATIF button */
  position?: "auth" | "home";
};

/**
 * Bokotra LIVE mena — manokatra Hub Spectateur.
 * Apetraka eo akaikin'ny bokotra ADMINISTRATIF (Auth) na FAB Shield (Home).
 */
export default function LiveSpectatorButton({ position = "home" }: Props) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const games = ["domino", "ludo", "petanque"] as const;
        let total = 0;
        for (const g of games) {
          const { data } = await (supabase.rpc as any)("spectator_list", { _game: g });
          total += Array.isArray(data) ? data.length : 0;
        }
        if (alive) setCount(total);
      } catch {
        /* silent */
      }
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  const posClass =
    position === "auth"
      ? "fixed bottom-4 right-44 z-50"
      : "fixed bottom-4 right-20 z-50";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="LIVE — Spectateur"
        className={`${posClass} group flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-display font-bold text-sm shadow-2xl active:scale-95 transition select-none`}
        style={{
          background: "linear-gradient(135deg,#ef4444,#b91c1c)",
          color: "white",
          boxShadow: "0 0 0 2px rgba(255,255,255,0.4), 0 6px 22px rgba(239,68,68,0.55)",
        }}
      >
        <span className="relative inline-flex items-center justify-center w-2.5 h-2.5">
          <span className="absolute inset-0 rounded-full bg-white/90 animate-ping" />
          <span className="relative inline-block w-2.5 h-2.5 rounded-full bg-white" />
        </span>
        <Radio className="w-4 h-4" />
        <span className="tracking-wide">LIVE</span>
        {count > 0 && (
          <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white text-red-700 text-[10px] font-extrabold">
            {count}
          </span>
        )}
      </button>

      <SpectatorHub open={open} onOpenChange={setOpen} />
    </>
  );
}