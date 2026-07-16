import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Radio, Hash, Loader2 } from "lucide-react";
import { SnakeBoard } from "@/components/SnakeBoard";
import { DominoBack } from "@/components/DominoTile";
import SpectatorWinner from "@/components/SpectatorWinner";
import type { Placed, Tile } from "@/lib/dominoEngine";
import dominoSceneBg from "@/assets/domino-scene.jpg";

type Snap = {
  id: string;
  ticket: string | null;
  status: string;
  board: Placed[] | null;
  current_turn: string | null;
  p1_id: string | null;
  p2_id: string | null;
  p3_id: string | null;
  p1_name: string | null;
  p2_name: string | null;
  p3_name: string | null;
  p1_count: number;
  p2_count: number;
  p3_count: number;
  boneyard_count: number;
  score_p1: number;
  score_p2: number;
  score_p3: number;
  players_count: number;
  round: number;
  last_reason: string | null;
  reveal_until?: string | null;
  p1_hand?: Tile[] | null;
  p2_hand?: Tile[] | null;
  p3_hand?: Tile[] | null;
};

function HiddenHand({ name, count, active }: { name: string; count: number; active: boolean; hand?: Tile[] | null }) {
  // Tsy aseho intsony ny vato sisa — atao kely ny back-tile mba ho malalaka
  // tsara ny latabatra ho an'ny mpijery.
  return (
    <div
      className={`flex flex-col items-center gap-0.5 p-1.5 rounded-lg border ${
        active ? "border-primary shadow-[0_0_10px_rgba(212,175,55,0.35)]" : "border-primary/20"
      } bg-card/30 min-w-[72px]`}
    >
      <div className="text-[10px] font-bold truncate max-w-[90px] gold-text">{name}</div>
      <div className="flex flex-wrap justify-center gap-0.5">
        {Array.from({ length: Math.min(count, 7) }).map((_, i) => (
          <DominoBack key={i} size="xs" horizontal={false} />
        ))}
      </div>
      <div className="text-[9px] text-muted-foreground">({count})</div>
    </div>
  );
}

export default function SpectateDomino() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Snap | null>(null);
  const [missing, setMissing] = useState(false);
  const [lastSnap, setLastSnap] = useState<Snap | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = async () => {
      const { data } = await (supabase.rpc as any)("spectator_get", { _game: "domino", _id: id });
      if (!alive) return;
      if (!data) { setMissing(true); setS(null); return; }
      setMissing(false);
      setS(data as Snap);
      setLastSnap(data as Snap);
    };
    load();
    const t = window.setInterval(load, 1500);
    return () => { alive = false; window.clearInterval(t); };
  }, [id]);

  // Lalao tapitra → endriky ny mpandresy
  if (missing && lastSnap) {
    const ranking = [
      { name: lastSnap.p1_name ?? "P1", score: Number(lastSnap.score_p1 ?? 0) },
      { name: lastSnap.p2_name ?? "P2", score: Number(lastSnap.score_p2 ?? 0) },
      ...(lastSnap.players_count === 3
        ? [{ name: lastSnap.p3_name ?? "P3", score: Number(lastSnap.score_p3 ?? 0) }]
        : []),
    ];
    return <SpectatorWinner ranking={ranking} />;
  }

  return (
    <div className="min-h-screen domino-scene-bg flex flex-col" style={{ backgroundImage: `url(${dominoSceneBg})` }}>
      <header className="flex items-center justify-between p-3 border-b border-primary/20">
        <Link to="/" className="flex items-center gap-2 text-sm text-foreground">
          <ArrowLeft className="w-5 h-5" /> <span className="text-base font-bold">Hiverina</span>
        </Link>
        <div className="flex items-center gap-2 text-base">
          <Radio className="w-5 h-5 text-red-500 animate-pulse" />
          <span className="font-extrabold text-red-500 text-lg tracking-widest">LIVE</span>
          <span className="text-muted-foreground">·</span>
          <Hash className="w-4 h-4 text-primary" />
          <span className="font-mono font-extrabold text-base">
            {s?.ticket ?? id?.replace(/-/g, "").slice(-6).toUpperCase()}
          </span>
        </div>
        <div className="w-20 text-right text-xs font-bold text-muted-foreground italic">Spectateur</div>
      </header>

      {missing && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground italic">
          Tsy misy lalao mandeha amin'io tick io intsony
        </div>
      )}

      {!missing && !s && (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      )}

      {s && (
        <div className="flex-1 flex flex-col gap-3 p-3">
          {/* Scores */}
          <div className={`grid gap-2 ${s.players_count === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {[
              { name: s.p1_name, score: s.score_p1, id: s.p1_id, count: s.p1_count },
              { name: s.p2_name, score: s.score_p2, id: s.p2_id, count: s.p2_count },
              ...(s.players_count === 3
                ? [{ name: s.p3_name, score: s.score_p3, id: s.p3_id, count: s.p3_count }]
                : []),
            ].map((p, i) => {
              const active = p.id && s.current_turn === p.id;
              return (
                <div
                  key={i}
                  className={`p-2 rounded-xl border-2 ${active ? "border-primary" : "border-primary/20"} bg-card/40`}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-extrabold truncate">{p.name ?? "—"}</span>
                    <span className="font-display text-2xl gold-text">{Number(p.score ?? 0)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hidden hands */}
          <div className="flex justify-center gap-3 flex-wrap">
            {[
              { name: s.p1_name ?? "P1", id: s.p1_id, count: s.p1_count, hand: s.p1_hand },
              { name: s.p2_name ?? "P2", id: s.p2_id, count: s.p2_count, hand: s.p2_hand },
              ...(s.players_count === 3 ? [{ name: s.p3_name ?? "P3", id: s.p3_id, count: s.p3_count, hand: s.p3_hand }] : []),
            ].map((p, i) => (
              <HiddenHand key={i} name={p.name} count={p.count} active={!!p.id && s.current_turn === p.id} hand={p.hand as Tile[] | null | undefined} />
            ))}
          </div>

          {/* Board */}
          <div className="felt-board relative w-full min-h-[320px] flex-1 overflow-hidden">
            <div className="domino-arena absolute inset-0 rounded-2xl">
              <SnakeBoard board={(s.board ?? []) as Placed[]} tileSize="sm" />
            </div>
          </div>

          {s.last_reason && (
            <div className="text-center text-xs text-muted-foreground italic">{s.last_reason}</div>
          )}
        </div>
      )}
    </div>
  );
}