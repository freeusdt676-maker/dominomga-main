import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trophy, Crown, Medal } from "lucide-react";

export type Ranking = Array<{ name: string; score: number | string; color?: string }>;

/**
 * Overlay namaranana — aseho mandritra ny 10 segondra rehefa tapitra ny lalao.
 * Lisitra mitsangana: mpandresy lehibe (1), avy eo faharoa, dia ny farany.
 */
export default function SpectatorWinner({ ranking, durationMs = 10_000 }: { ranking: Ranking; durationMs?: number }) {
  const nav = useNavigate();
  const [left, setLeft] = useState(Math.ceil(durationMs / 1000));
  useEffect(() => {
    const t = window.setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    const out = window.setTimeout(() => nav("/"), durationMs);
    return () => { window.clearInterval(t); window.clearTimeout(out); };
  }, [durationMs, nav]);

  const sorted = [...ranking].sort((a, b) => Number(b.score) - Number(a.score));
  const winner = sorted[0];
  const rest = sorted.slice(1);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 p-6"
         style={{ background: "radial-gradient(circle at 50% 30%, rgba(212,175,55,0.18), rgba(0,0,0,0.92))", backdropFilter: "blur(8px)" }}>
      {winner && (
        <div className="flex flex-col items-center gap-3 animate-scale-in text-center">
          <Crown className="w-16 h-16 text-yellow-300 drop-shadow-[0_0_18px_rgba(250,204,21,0.9)]" />
          <div className="text-2xl md:text-3xl font-bold text-yellow-200 tracking-widest uppercase">MPANDRESY</div>
          <div className="text-5xl md:text-7xl font-extrabold gold-text leading-tight max-w-[90vw] break-words" style={{ filter: "drop-shadow(0 6px 18px rgba(250,204,21,0.55))" }}>
            {winner.name || "—"}
          </div>
          <div className="text-3xl md:text-4xl font-mono font-bold text-white/95 flex items-center gap-3">
            <Trophy className="w-7 h-7 text-yellow-300" /> {winner.score}
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <div className="flex flex-col gap-2 w-full max-w-md">
          {rest.map((r, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3 rounded-xl border border-primary/30 bg-black/50">
              <div className="flex items-center gap-3">
                <Medal className={`w-5 h-5 ${i === 0 ? "text-slate-300" : "text-amber-700"}`} />
                <span className="text-base md:text-lg font-bold text-white/90">{i + 2}.</span>
                <span className="text-lg md:text-xl font-bold text-white/95 truncate max-w-[55vw]">{r.name || "—"}</span>
              </div>
              <span className="text-xl md:text-2xl font-mono font-bold text-yellow-200">{r.score}</span>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-white/60 mt-4">Hivoaka ny ecran rehefa {left}s…</div>
    </div>
  );
}