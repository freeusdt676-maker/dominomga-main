import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Radio, Users, Coins, Hash, Loader2 } from "lucide-react";
import { fmtAr } from "@/lib/constants";

type GameType = "domino" | "ludo" | "petanque";

type Row = {
  id: string;
  ticket: string | null;
  stake: number;
  players_count?: number;
  score_p1?: number;
  score_p2?: number;
  score_p3?: number;
  round?: number;
  created_at: string;
  p1?: string | null;
  p2?: string | null;
  p3?: string | null;
  p4?: string | null;
};

const LABELS: Record<GameType, string> = {
  domino: "DOMINO",
  ludo: "LUDO",
  petanque: "PÉTANQUE",
};

function shortTick(id: string, ticket: string | null) {
  if (ticket) return ticket;
  return id.replace(/-/g, "").slice(-6).toUpperCase();
}

function GamesList({
  type,
  onPick,
}: {
  type: GameType;
  onPick: (id: string) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await (supabase.rpc as any)("spectator_list", { _game: type });
      if (alive) setRows(Array.isArray(data) ? (data as Row[]) : []);
    };
    load();
    const id = window.setInterval(load, 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, [type]);

  if (rows === null) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground italic">
        Tsy misy lalao mandeha
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto pr-1">
      {rows.map((r) => {
        const players = [r.p1, r.p2, r.p3, r.p4].filter(Boolean) as string[];
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onPick(r.id)}
            className="text-left p-3 rounded-xl border-2 border-primary/30 bg-card/40 hover:border-primary hover:bg-card/70 transition active:scale-[0.98]"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <Hash className="w-3.5 h-3.5 text-primary" />
                <span className="font-mono font-bold text-sm text-foreground">
                  {shortTick(r.id, r.ticket)}
                </span>
              </div>
              <div className="flex items-center gap-1 text-xs text-primary font-bold">
                <Coins className="w-3.5 h-3.5" />
                {fmtAr(r.stake)}
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="w-3.5 h-3.5" />
              <span className="truncate">
                {players.join(" · ") || "Mpilalao"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function SpectatorHub({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const nav = useNavigate();
  const [tab, setTab] = useState<GameType>("domino");

  const goSpectate = (id: string) => {
    onOpenChange(false);
    nav(`/spectate/${tab}/${id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-red-500" />
            <span>LIVE — Lalao mandeha</span>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as GameType)}>
          <TabsList className="grid grid-cols-3 w-full">
            {(Object.keys(LABELS) as GameType[]).map((t) => (
              <TabsTrigger key={t} value={t} className="text-xs font-bold">
                {LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>

          {(Object.keys(LABELS) as GameType[]).map((t) => (
            <TabsContent key={t} value={t} className="mt-3">
              <GamesList type={t} onPick={goSpectate} />
            </TabsContent>
          ))}
        </Tabs>

        <p className="text-[10px] text-center text-muted-foreground/70 mt-2 italic">
          Mode spectateurs · ny vato eo am-pelatànana tsy hita
        </p>
      </DialogContent>
    </Dialog>
  );
}