import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { fmtAr } from "@/lib/constants";

type GT = "all" | "domino" | "ludo" | "petanque";
const LABEL: Record<string, string> = { domino: "🁫 Domino", ludo: "🎲 Ludo", petanque: "🎯 Pétanque" };

export default function TournamentLeaderboard() {
  const nav = useNavigate();
  const [gt, setGt] = useState<GT>("all");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supabase.rpc("tournament_leaderboard" as any, { _game_type: gt === "all" ? null : gt })
      .then(({ data }) => { setRows((data as any[]) ?? []); setLoading(false); });
  }, [gt]);

  return (
    <div className="min-h-screen luxe-bg">
      <header className="px-4 py-3 flex items-center gap-3 hairline-b">
        <Button variant="ghost" size="icon" onClick={() => nav("/tournament")} className="text-[hsl(var(--gold-1))]">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2 flex-1">
          <BarChart3 className="w-6 h-6 text-[hsl(var(--gold-1))]" />
          <div>
            <p className="eyebrow">Top 20</p>
            <h1 className="font-serif-luxe gold-luxe-text text-xl leading-none">Classement</h1>
          </div>
        </div>
      </header>

      <div className="px-4 py-4 pb-24 max-w-lg mx-auto">
        <div className="luxe-card p-1.5 mb-4 grid grid-cols-4 gap-1">
          {(["all","domino","ludo","petanque"] as GT[]).map((g) => (
            <button key={g} onClick={() => setGt(g)}
              className={`rounded-md py-2 px-1 text-[11px] font-bold transition ${
                gt === g ? "bg-[hsl(var(--gold-1)/0.18)] gold-luxe-text" : "text-muted-foreground"
              }`}>
              {g === "all" ? "REHETRA" : LABEL[g]}
            </button>
          ))}
        </div>

        {loading && <p className="text-center text-muted-foreground py-12 text-sm">Mihandry…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-center text-muted-foreground italic py-12 text-sm">Mbola tsy misy mpilalao</p>
        )}
        {!loading && (
          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <div key={r.user_id} className="luxe-card p-3 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-serif-luxe text-base ${
                  i === 0 ? "bg-[hsl(var(--gold-1)/0.3)] gold-luxe-text" :
                  i === 1 ? "bg-zinc-300/20 text-zinc-200" :
                  i === 2 ? "bg-orange-600/20 text-orange-400" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{r.name ?? "?"}</p>
                  <p className="text-[10px] text-muted-foreground">
                    🏆 {r.trophies} · 🥈 {r.runner_ups} · ⚔️ {r.match_wins} wins
                  </p>
                </div>
                <p className="gold-luxe-text font-serif-luxe text-sm">{fmtAr(r.prize_total)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}