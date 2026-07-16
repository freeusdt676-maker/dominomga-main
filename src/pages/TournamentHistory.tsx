import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Trophy } from "lucide-react";

type GT = "all" | "domino" | "ludo" | "petanque";
const LABEL: Record<string, string> = { domino: "🁫 Domino", ludo: "🎲 Ludo", petanque: "🎯 Pétanque" };

function fmtDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000);
  return `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
}

export default function TournamentHistory() {
  const nav = useNavigate();
  const [gt, setGt] = useState<GT>("all");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supabase.rpc("tournament_history" as any, { _limit: 50, _game_type: gt === "all" ? null : gt })
      .then(({ data }) => { setItems((data as any[]) ?? []); setLoading(false); });
  }, [gt]);

  return (
    <div className="min-h-screen luxe-bg">
      <header className="px-4 py-3 flex items-center gap-3 hairline-b">
        <Button variant="ghost" size="icon" onClick={() => nav("/tournament")} className="text-[hsl(var(--gold-1))]">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2 flex-1">
          <Trophy className="w-6 h-6 text-[hsl(var(--gold-1))]" />
          <div>
            <p className="eyebrow">Palmarès</p>
            <h1 className="font-serif-luxe gold-luxe-text text-xl leading-none">Tantaran'ny Tornoi</h1>
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
        {!loading && items.length === 0 && (
          <p className="text-center text-muted-foreground italic py-12 text-sm">Mbola tsy misy tantara</p>
        )}
        {!loading && (
          <div className="space-y-2">
            {items.map((t) => (
              <div key={t.id} className="luxe-card p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[10px] tracking-widest text-[hsl(var(--gold-1))]">
                      {LABEL[t.game_type]?.toUpperCase() ?? t.game_type.toUpperCase()} · {fmtDate(t.week_start)}
                    </p>
                    {t.status === "cancelled" ? (
                      <p className="text-sm text-red-400 mt-1">❌ Voafoana</p>
                    ) : (
                      <>
                        <p className="text-sm mt-1">🥇 <b>{t.winner_name ?? "?"}</b></p>
                        <p className="text-xs text-muted-foreground">🥈 {t.runner_up_name ?? "?"}</p>
                      </>
                    )}
                  </div>
                  {t.status === "finished" && (
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Loka</p>
                      <p className="gold-luxe-text font-serif-luxe text-base">30k</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}