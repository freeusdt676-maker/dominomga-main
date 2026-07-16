import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trophy, XCircle, AlertTriangle, FastForward, UserX } from "lucide-react";
import { fmtAr } from "@/lib/constants";

function fmtMG(iso?: string | null) {
  if (!iso) return "—";
  const mg = new Date(new Date(iso).getTime() + 3 * 3600_000);
  const days = ["Alahady","Lat","Tal","Alr","Alk","Zoma","Sab"];
  return `${days[mg.getUTCDay()]} ${String(mg.getUTCDate()).padStart(2,"0")}/${String(mg.getUTCMonth()+1).padStart(2,"0")} ${String(mg.getUTCHours()).padStart(2,"0")}:${String(mg.getUTCMinutes()).padStart(2,"0")}`;
}

type GameType = "domino" | "petanque";
const GT_LABEL: Record<GameType, string> = { domino: "🁫 DOMINO", petanque: "🎯 PÉTANQUE" };

export default function TournamentAdmin() {
  const [gameType, setGameType] = useState<GameType>("domino");
  const [data, setData] = useState<any>(null);
  const [cancelReg, setCancelReg] = useState<any | null>(null);
  const [cancelAllOpen, setCancelAllOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [forfeitMatch, setForfeitMatch] = useState<any | null>(null);
  const [forfeitLoser, setForfeitLoser] = useState<string>("");

  const load = async () => {
    const { data: d } = await supabase.rpc("tournament_get_current" as any, { _game_type: gameType });
    setData(d);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("tourn-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_registrations" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_matches" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameType]);

  const handleCancelReg = async () => {
    if (!cancelReg) return;
    const { error } = await supabase.rpc("tournament_admin_cancel_registration" as any, { _reg_id: cancelReg.id, _pin: pin });
    if (error) { toast.error(error.message); return; }
    toast.success("Voafoana — naverina ny 5 000 Ar");
    setCancelReg(null); setPin("");
    load();
  };

  const handleCancelAll = async () => {
    const { data: r, error } = await supabase.rpc("tournament_admin_cancel" as any, { _game_type: gameType, _pin: pin });
    if (error) { toast.error(error.message); return; }
    toast.success(`Voafoana — ${(r as any)?.refunded ?? 0} mpilalao naverin'ny vola`);
    setCancelAllOpen(false); setPin("");
    load();
  };

  const handleForceAdvance = async () => {
    const pin2 = prompt("PIN admin?");
    if (!pin2) return;
    const { error } = await supabase.rpc("tournament_admin_force_advance" as any, { _pin: pin2 });
    if (error) { toast.error(error.message); return; }
    toast.success("Force advance tafita");
    load();
  };

  const handleForceForfeit = async () => {
    if (!forfeitMatch || !forfeitLoser) return;
    const { error } = await supabase.rpc("tournament_admin_force_forfeit" as any, {
      _match_id: forfeitMatch.id, _loser: forfeitLoser, _pin: pin,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Forfait voarakitra");
    setForfeitMatch(null); setForfeitLoser(""); setPin("");
    load();
  };

  const t = data?.tournament;
  const regs: any[] = data?.registrations ?? [];
  const matches: any[] = data?.matches ?? [];

  if (!t) return <p className="text-sm text-muted-foreground py-4">Mihandry...</p>;

  return (
    <div className="space-y-3">
      <div className="luxe-card p-1.5 grid grid-cols-3 gap-1">
        {(Object.keys(GT_LABEL) as GameType[]).map((gt) => {
          const active = gameType === gt;
          return (
            <button
              key={gt}
              onClick={() => { if (gt !== gameType) { setGameType(gt); setData(null); } }}
              className={`rounded-md py-2 px-1 text-[11px] font-bold transition ${
                active ? "bg-[hsl(var(--gold-1)/0.18)] gold-luxe-text shadow-inner" : "text-muted-foreground"
              }`}
            >
              {GT_LABEL[gt]}
            </button>
          );
        })}
      </div>

      <div className="luxe-card p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] tracking-widest text-[hsl(var(--gold-1))] uppercase">Tournoi {gameType}</p>
            <p className="font-serif-luxe text-lg gold-luxe-text mt-1">
              {t.status === "registration" && "📝 Inscription mandeha"}
              {t.status === "running" && "🎮 Lalao mandeha"}
              {t.status === "finished" && "🏁 Vita"}
              {t.status === "cancelled" && "❌ Voafoana"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase text-muted-foreground">Vola tafiditra</p>
            <p className="font-serif-luxe text-xl gold-luxe-text">{fmtAr(t.total_collected ?? 0)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
          <div className="hairline rounded p-2">
            <p className="text-muted-foreground text-[10px]">Mpisoratra anarana</p>
            <p className="font-bold">{regs.length} / 8</p>
          </div>
          <div className="hairline rounded p-2">
            <p className="text-muted-foreground text-[10px]">Inscription mikatona</p>
            <p className="font-bold">{fmtMG(t.reg_close)}</p>
          </div>
          <div className="hairline rounded p-2">
            <p className="text-muted-foreground text-[10px]">¼ Finale</p>
            <p className="font-bold">{fmtMG(t.qf_at)}</p>
          </div>
          <div className="hairline rounded p-2">
            <p className="text-muted-foreground text-[10px]">Finale</p>
            <p className="font-bold">{fmtMG(t.final_at)}</p>
          </div>
        </div>
      </div>

      <div className="luxe-card p-3">
        <p className="font-serif-luxe text-sm gold-luxe-text mb-2">Mpisoratra anarana</p>
        {regs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-3 text-center">Tsy misy mpisoratra anarana</p>
        ) : (
          <div className="space-y-1">
            {regs.map((r) => (
              <div key={r.id} className="hairline rounded p-2 flex items-center gap-2 text-xs">
                <div className="w-8 h-8 rounded-full bg-[hsl(var(--gold-1)/0.15)] flex items-center justify-center font-bold">
                  {r.group_letter}{r.slot}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate">{r.nom}</p>
                  <p className="text-muted-foreground truncate">📞 {r.tel} · 🆔 {r.id_card}</p>
                </div>
                <p className="font-bold gold-luxe-text">{fmtAr(r.paid_amount)}</p>
                {t.status !== "finished" && t.status !== "cancelled" && (
                  <Button size="icon" variant="ghost" onClick={() => setCancelReg(r)} className="text-red-500">
                    <XCircle className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {matches.length > 0 && (
        <div className="luxe-card p-3">
          <p className="font-serif-luxe text-sm gold-luxe-text mb-2">Lalao</p>
          <div className="space-y-1 text-xs">
            {matches.map((m) => {
              const nameOf = (uid?: string) => regs.find((r) => r.user_id === uid)?.nom ?? "?";
              return (
                <div key={m.id} className="hairline rounded p-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] text-[hsl(var(--gold-1))]">{m.round.toUpperCase()} #{m.match_index}</p>
                    <p>{nameOf(m.player1_id)} <span className="text-muted-foreground">vs</span> {nameOf(m.player2_id)}</p>
                  </div>
                  <div className="text-right">
                    {m.winner_id ? (
                      <p className="text-emerald-400 font-bold">🏆 {nameOf(m.winner_id)}</p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="text-amber-400">⏳ Miandry</p>
                        {m.game_id && (
                          <Button size="sm" variant="ghost" className="text-red-400 h-7 px-2"
                            onClick={() => { setForfeitMatch(m); setForfeitLoser(""); }}>
                            <UserX className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {t.status !== "finished" && t.status !== "cancelled" && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="w-full" onClick={handleForceAdvance}>
            <FastForward className="w-4 h-4 mr-1" /> Force advance
          </Button>
          <Button variant="destructive" className="w-full" onClick={() => setCancelAllOpen(true)}>
            <AlertTriangle className="w-4 h-4 mr-1" /> HANAFOANA
          </Button>
        </div>
      )}

      {/* Cancel single */}
      <Dialog open={!!cancelReg} onOpenChange={(o) => { if (!o) { setCancelReg(null); setPin(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Hanafoana fisoratana anarana</DialogTitle></DialogHeader>
          <p className="text-sm">{cancelReg?.nom} — naverina amin'ny wallet ny <b>{fmtAr(cancelReg?.paid_amount)}</b></p>
          <Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Code PIN admin" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelReg(null)}>Tsia</Button>
            <Button variant="destructive" onClick={handleCancelReg}>Foanana</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelAllOpen} onOpenChange={(o) => { setCancelAllOpen(o); if (!o) setPin(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Hanafoana ny tournoi manontolo</DialogTitle></DialogHeader>
          <p className="text-sm">Hiverina any amin'ny wallet ny vola rehetra (8 × 5 000 Ar maximum).</p>
          <Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Code PIN admin" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelAllOpen(false)}>Tsia</Button>
            <Button variant="destructive" onClick={handleCancelAll}>FOANANA DAHOLO</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force forfeit */}
      <Dialog open={!!forfeitMatch} onOpenChange={(o) => { if (!o) { setForfeitMatch(null); setForfeitLoser(""); setPin(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Force forfait — Match {forfeitMatch?.round?.toUpperCase()} #{forfeitMatch?.match_index}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Safidio izay mpilalao resy:</p>
          {forfeitMatch && (
            <div className="grid grid-cols-2 gap-2">
              {[forfeitMatch.player1_id, forfeitMatch.player2_id].map((pid) => {
                const nm = regs.find((r) => r.user_id === pid)?.nom ?? "?";
                const active = forfeitLoser === pid;
                return (
                  <button key={pid} onClick={() => setForfeitLoser(pid)}
                    className={`hairline rounded p-2 text-sm ${active ? "bg-red-500/20 border-red-400" : ""}`}>
                    {nm}
                  </button>
                );
              })}
            </div>
          )}
          <Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Code PIN admin" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForfeitMatch(null)}>Tsia</Button>
            <Button variant="destructive" onClick={handleForceForfeit} disabled={!forfeitLoser || !pin}>
              Forfait
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}