import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Users } from "lucide-react";

type Props = {
  kind: "domino" | "ludo" | "petanque";
  accent?: string; // tailwind text color class
};

type Member = { user_id: string; name: string };

/**
 * Lisitra mahalaky ny mpilalao tafiditra ao amin'ny lobby (Domino/Ludo/Pétanque).
 * Mampiasa Supabase Realtime Presence — miakatra/midina arakaraka ny olona
 * miditra/miala ny pejy lobby tsy mila refresh.
 */
export default function LobbyPresence({ kind, accent = "text-primary" }: Props) {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let myName = "Mpilalao";
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("mvola_name")
        .eq("user_id", user.id)
        .maybeSingle();
      myName = (data?.mvola_name as string) || "Mpilalao";
      if (cancelled) return;
      const channel = supabase.channel(`lobby-presence-${kind}`, {
        config: { presence: { key: user.id } },
      });
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState() as Record<string, Array<{ name?: string }>>;
          const list: Member[] = Object.entries(state).map(([uid, metas]) => ({
            user_id: uid,
            name: (metas?.[0]?.name as string) || "Mpilalao",
          }));
          list.sort((a, b) => a.name.localeCompare(b.name));
          setMembers(list);
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await channel.track({ name: myName });
          }
        });
      // cleanup
      (window as any).__lobbyPresenceCleanup__ = () => {
        supabase.removeChannel(channel);
      };
    })();
    return () => {
      cancelled = true;
      const c = (window as any).__lobbyPresenceCleanup__;
      if (typeof c === "function") c();
    };
  }, [user, kind]);

  return (
    <div className="rounded-2xl p-4 border border-white/10 bg-black/20 backdrop-blur">
      <div className="flex items-center gap-2 mb-2">
        <Users className={`w-4 h-4 ${accent}`} />
        <h3 className={`font-display font-bold ${accent}`}>
          Olona ao amin'ny Lobby ({members.length})
        </h3>
      </div>
      {members.length === 0 ? (
        <p className="text-center text-xs text-muted-foreground py-3">Tsy mbola misy</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <li
              key={m.user_id}
              className="px-2 py-1 rounded-full text-[11px] font-semibold bg-white/10 border border-white/15"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle" />
              {m.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}