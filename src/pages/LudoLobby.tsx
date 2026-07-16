import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { STAKE_LEVELS, fmtAr } from "@/lib/constants";
import { ArrowLeft, Loader2, Coins, Users, X, Play } from "lucide-react";
import { toast } from "sonner";
import { useThemeClass } from "@/hooks/use-theme-class";
import OnlineUsersList from "@/components/OnlineUsersList";

type WaitingGame = {
  id: string; player1_id: string; player2_id?: string | null; player3_id?: string | null; player4_id?: string | null;
  stake: number; created_at: string; players_count: number; status: string; _name?: string;
};
type ResumeGame = { id: string; stake: number; players_count: number };

export default function LudoLobby() {
  useThemeClass("ludo");
  const { user } = useAuth();
  const nav = useNavigate();
  const [stake, setStake] = useState(STAKE_LEVELS[0]);
  const [playersCount, setPlayersCount] = useState<2 | 3 | 4>(2);
  const [waiting, setWaiting] = useState<WaitingGame[]>([]);
  const [myWaiting, setMyWaiting] = useState<WaitingGame | null>(null);
  const [activeGame, setActiveGame] = useState<ResumeGame | null>(null);
  const [placing, setPlacing] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    const { data: mine } = await supabase
      .from("ludo_games")
      .select("id, stake, players_count")
      .or(`player1_id.eq.${user.id},player2_id.eq.${user.id},player3_id.eq.${user.id},player4_id.eq.${user.id}`)
      .eq("status", "in_progress")
      .order("updated_at", { ascending: false })
      .limit(1);
    const a = mine?.[0];
    setActiveGame(a ? { id: a.id, stake: Number(a.stake), players_count: Number(a.players_count) } : null);

    const { data: gs } = await supabase
      .from("ludo_games")
      .select("id, player1_id, player2_id, player3_id, player4_id, stake, created_at, players_count, status")
      .eq("status", "waiting")
      .order("created_at", { ascending: true });
    const list = (gs ?? []) as WaitingGame[];
    const EXPIRY_MS = 2 * 60 * 1000;
    const nowMs = Date.now();
    const open = list.filter((g) => {
      if (nowMs - new Date(g.created_at).getTime() > EXPIRY_MS) return false;
      const pc = Number(g.players_count);
      const filled = [g.player1_id, g.player2_id, g.player3_id, g.player4_id].filter(Boolean).length;
      return filled < pc;
    });
    const ids = Array.from(new Set(open.map((g) => g.player1_id)));
    const nameMap: Record<string, string> = {};
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("user_id, mvola_name").in("user_id", ids);
      (ps ?? []).forEach((p: any) => { nameMap[p.user_id] = p.mvola_name; });
    }
    const enriched = open.map((g) => ({ ...g, _name: nameMap[g.player1_id] ?? "Mpilalao" }));
    setWaiting(enriched.filter((g) => ![g.player1_id, g.player2_id, g.player3_id, g.player4_id].includes(user.id)));
    setMyWaiting(enriched.find((g) => g.player1_id === user.id) ?? null);
  };

  useEffect(() => {
    if (!user) return;
    load();
    let t: any = null;
    const debounced = () => { if (t) clearTimeout(t); t = setTimeout(load, 250); };
    const ch = supabase.channel("ludo-lobby-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "ludo_games" }, debounced)
      .subscribe();
    const itv = setInterval(load, 20000);
    return () => { supabase.removeChannel(ch); clearInterval(itv); if (t) clearTimeout(t); };
    // eslint-disable-next-line
  }, [user]);

  // Rehefa lasa in_progress ny room-ko → mankany amin'ny table
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel("ludo-mine-rt")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ludo_games" }, (p: any) => {
        const g = p.new;
        if (!g) return;
        const mine = [g.player1_id, g.player2_id, g.player3_id, g.player4_id].includes(user.id);
        if (mine && g.status === "in_progress") {
          setActiveGame({ id: g.id, stake: Number(g.stake), players_count: Number(g.players_count) });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const placeMise = async () => {
    if (!user || placing) return;
    setPlacing(true);
    const { data: existing } = await supabase
      .from("ludo_games")
      .select("id")
      .or(`player1_id.eq.${user.id},player2_id.eq.${user.id},player3_id.eq.${user.id},player4_id.eq.${user.id}`)
      .in("status", ["waiting", "in_progress"])
      .limit(1);
    if (existing && existing.length > 0) {
      setPlacing(false);
      toast.error("Efa manana lalao Ludo mandeha ianao");
      load();
      return;
    }
    const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", user.id).single();
    if (Number(w?.balance ?? 0) < stake) { setPlacing(false); return toast.error("Tsy ampy ny solde"); }
    const { data: g, error } = await supabase
      .from("ludo_games")
      .insert({ player1_id: user.id, stake, players_count: playersCount, status: "waiting" } as any)
      .select("id")
      .single();
    setPlacing(false);
    if (error || !g) return toast.error(error?.message ?? "Tsy nahomby");
    toast.success("Vonona — miandry mpifanandrina");
    nav(`/ludo/${g.id}`);
  };

  const cancelMyWaiting = async () => {
    if (!myWaiting) return;
    const { error } = await supabase.rpc("ludo_cancel_waiting" as any, { _game_id: myWaiting.id });
    if (error) return toast.error(error.message);
    toast("Nesorina");
    load();
  };

  const joinWaiting = async (g: WaitingGame) => {
    if (!user) return;
    const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", user.id).single();
    if (Number(w?.balance ?? 0) < Number(g.stake)) return toast.error("Tsy ampy ny solde");
    setJoining(g.id);
    const { error } = await supabase.rpc("ludo_join_and_start" as any, { _game_id: g.id, _user: user.id });
    setJoining(null);
    if (error) return toast.error(error.message);
    nav(`/ludo/${g.id}`);
  };

  const grouped = useMemo(() => {
    const m: Record<number, WaitingGame[]> = {};
    waiting.forEach((g) => { (m[Number(g.stake)] = m[Number(g.stake)] || []).push(g); });
    return m;
  }, [waiting]);

  return (
    <div className="min-h-screen felt-bg">
      <header className="p-4 flex items-center gap-3 border-b border-primary/20">
        <Button variant="ghost" size="icon" onClick={() => nav("/")}><ArrowLeft /></Button>
        <h1 className="font-display text-xl font-bold gold-text">Lobby Ludo</h1>
      </header>

      <div className="p-4 max-w-lg mx-auto space-y-4">
        <OnlineUsersList accent="text-primary" />
        {activeGame && (
          <button
            onClick={() => nav(`/ludo/${activeGame.id}`)}
            className="w-full rounded-2xl p-4 border-2 border-blue-400 bg-gradient-to-r from-blue-600 to-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.6)] transition flex items-center justify-between gap-3 animate-pulse"
          >
            <div className="text-left">
              <p className="text-sm font-bold text-white">Mbola misy lalao tsy vita</p>
              <p className="text-xs text-blue-50/90">{activeGame.players_count}P · {fmtAr(activeGame.stake)}</p>
            </div>
            <span className="shrink-0 inline-flex items-center gap-2 bg-white text-blue-700 font-bold px-4 py-2 rounded-full shadow-md">
              <Play className="h-4 w-4 fill-current" /> Hanohy
            </span>
          </button>
        )}

        <div className="card-felt rounded-2xl p-4">
          <p className="text-sm text-muted-foreground mb-2">1. Mpilalao</p>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[2, 3, 4].map((n) => (
              <button key={n} onClick={() => setPlayersCount(n as 2 | 3 | 4)}
                className={`py-2 rounded-lg text-xs font-semibold border ${playersCount === n ? "btn-gold border-primary" : "border-primary/30 text-foreground"}`}>
                {n}P
              </button>
            ))}
          </div>

          <p className="text-sm text-muted-foreground mb-2">2. Mise</p>
          <div className="grid grid-cols-5 gap-2 mb-4">
            {STAKE_LEVELS.map((s) => (
              <button key={s} onClick={() => setStake(s)}
                className={`py-2 rounded-lg text-xs font-semibold border ${stake === s ? "btn-gold border-primary" : "border-primary/30 text-foreground"}`}>
                {s / 1000}k
              </button>
            ))}
          </div>

          <p className="text-center text-sm">
            <b className="gold-text">{playersCount}P</b> · Mise <b className="gold-text">{fmtAr(stake)}</b> · Gain net <b className="gold-text">{fmtAr(Math.round(stake * 0.9 * playersCount))}</b>
          </p>

          {myWaiting ? (
            <div className="mt-3 p-3 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-between">
              <div className="text-sm">
                <p className="font-bold gold-text">Misy mise vonona ianao</p>
                <p className="text-xs text-muted-foreground">{myWaiting.players_count}P · {fmtAr(myWaiting.stake)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => nav(`/ludo/${myWaiting.id}`)} className="bg-blue-600 hover:bg-blue-500 text-white font-bold gap-1.5">
                  <Play className="h-4 w-4 fill-current" /> Hanohy
                </Button>
                <Button size="sm" variant="destructive" onClick={cancelMyWaiting}><X className="w-4 h-4" /></Button>
              </div>
            </div>
          ) : (
            <Button className="btn-gold w-full mt-3" onClick={placeMise} disabled={placing}>
              {placing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Coins className="w-4 h-4 mr-2" />}
              {placing ? "Andraso..." : `3. Confirmer — ${fmtAr(stake)}`}
            </Button>
          )}
        </div>

        <div className="card-felt rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-primary" />
            <h3 className="font-display font-bold">Mpilalao vonona ({waiting.length})</h3>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">Tsindrio izay mitovy mise aminao.</p>
          {waiting.length === 0 && <p className="text-center text-sm text-muted-foreground py-6">Tsy mbola misy vonona</p>}
          <div className="space-y-3">
            {Object.keys(grouped).sort((a, b) => Number(a) - Number(b)).map((k) => (
              <div key={k}>
                <p className="text-[10px] uppercase text-muted-foreground mb-1">Mise {fmtAr(Number(k))}</p>
                <div className="space-y-1.5">
                  {grouped[Number(k)].map((g) => {
                    const filled = [g.player1_id, g.player2_id, g.player3_id, g.player4_id].filter(Boolean).length;
                    return (
                      <button key={g.id} onClick={() => joinWaiting(g)} disabled={joining === g.id}
                        className="w-full flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-muted/20 hover:bg-muted/30 transition">
                        <div className="text-left">
                          <p className="font-bold text-sm">{g._name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            <b className="gold-text">{g.players_count}P</b> · {filled}/{g.players_count} tafiditra · mise <b className="gold-text">{fmtAr(g.stake)}</b>
                          </p>
                        </div>
                        {joining === g.id ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                          <span className="text-xs font-bold text-primary">Hiditra ▶</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}