import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Trash2, Trophy, Copy, Medal, Dice5, Target } from "lucide-react";
import { fmtAr } from "@/lib/constants";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const HIDDEN_KEY = "domino_hidden_history";

function loadHidden(uid: string): string[] {
  try { return JSON.parse(localStorage.getItem(`${HIDDEN_KEY}_${uid}`) ?? "[]"); }
  catch { return []; }
}
function saveHidden(uid: string, ids: string[]) {
  localStorage.setItem(`${HIDDEN_KEY}_${uid}`, JSON.stringify(ids));
}

export default function Profile() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [games, setGames] = useState<any[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<string[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  useEffect(() => {
    if (!user) return;
    setHidden(loadHidden(user.id));
    (async () => {
      const { data: p } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
      setProfile(p);
      const [domRes, ludoRes, petRes] = await Promise.all([
        supabase.from("games")
          .select("id, stake, status, winner_id, player1_id, player2_id, player3_id, score_p1, score_p2, score_p3, players_count, ticket_number, finished_at, created_at, game_mode, last_reason, round_number")
          .or(`player1_id.eq.${user.id},player2_id.eq.${user.id},player3_id.eq.${user.id}`)
          .in("status", ["finished", "cancelled", "blocked"])
          .order("finished_at", { ascending: false, nullsFirst: false })
          .limit(200),
        supabase.from("ludo_games" as any)
          .select("id, stake, status, winner_id, player1_id, player2_id, player3_id, player4_id, players_count, ticket_number, finished_at, created_at, pawns")
          .or(`player1_id.eq.${user.id},player2_id.eq.${user.id},player3_id.eq.${user.id},player4_id.eq.${user.id}`)
          .in("status", ["finished", "cancelled"])
          .order("finished_at", { ascending: false, nullsFirst: false })
          .limit(200),
        supabase.from("petanque_games" as any)
          .select("id, stake, status, winner_id, player1_id, player2_id, score_p1, score_p2, ticket_number, finished_at, created_at, round_number")
          .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
          .in("status", ["finished", "cancelled"])
          .order("finished_at", { ascending: false, nullsFirst: false })
          .limit(200),
      ]);
      const dom = (domRes.data ?? []).map((x: any) => ({ ...x, kind: "domino" as const }));
      const lud = (ludoRes.data ?? []).map((x: any) => ({ ...x, kind: "ludo" as const, players_count: x.players_count ?? 2 }));
      const pet = (petRes.data ?? []).map((x: any) => ({ ...x, kind: "petanque" as const, players_count: 2 }));
      const all = [...dom, ...lud, ...pet].sort((a, b) => {
        const da = new Date(a.finished_at ?? a.created_at ?? 0).getTime();
        const db = new Date(b.finished_at ?? b.created_at ?? 0).getTime();
        return db - da;
      });
      setGames(all);
      const ids = new Set<string>();
      all.forEach((x: any) => {
        [x.player1_id, x.player2_id, x.player3_id, x.player4_id].forEach((id) => id && ids.add(id));
      });
      if (ids.size) {
        const { data: ps } = await supabase.from("profiles").select("user_id, mvola_name").in("user_id", Array.from(ids));
        const m: Record<string, string> = {};
        (ps ?? []).forEach((p: any) => { m[p.user_id] = p.mvola_name ?? "Mpilalao"; });
        setNames(m);
      }
    })();
  }, [user]);

  if (!user) {
    return <div className="min-h-screen felt-bg flex items-center justify-center text-muted-foreground">Miditra aloha…</div>;
  }

  const visible = games.filter((g) => !hidden.includes(g.id));
  const wins = visible.filter((g) => g.winner_id === user.id).length;
  const losses = visible.filter((g) => g.winner_id && g.winner_id !== user.id).length;
  const totalGain = visible.reduce((s, g) => {
    const stake = Number(g.stake ?? 0);
    const pc = Number(g.players_count ?? 2);
    const commissionEach = Math.round(stake * 0.10);
    const pot = (stake - commissionEach) * pc;
    if (g.winner_id === user.id) return s + (pot - stake);
    if (g.winner_id) return s - stake;
    return s;
  }, 0);

  const deleteOne = (id: string) => {
    const next = [...hidden, id];
    setHidden(next); saveHidden(user.id, next);
    setConfirmId(null);
    toast.success("Voafafa amin'ny historique");
  };
  const deleteAll = () => {
    const next = Array.from(new Set([...hidden, ...games.map((g) => g.id)]));
    setHidden(next); saveHidden(user.id, next);
    setConfirmAll(false);
    toast.success("Voafafa daholo ny historique");
  };

  const parseReason = (r: string | null | undefined): { label: string; tone: string; raw?: string | null } => {
    if (!r) return { label: "Lalao vita", tone: "bg-muted text-foreground" };
    const s = r.toLowerCase();
    if (s.includes("datinandro")) return { label: "MANDRESY • Datinandro", tone: "bg-amber-400/20 text-amber-200 border-amber-400/50", raw: r };
    if (s.includes("mandeha irery")) return { label: "MANDRESY • Mandeha irery", tone: "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/40", raw: r };
    if (s.includes("mandresy") && (s.includes("double 6") || s.includes("[6|6]") || s.includes("6/6"))) {
      return { label: "MANDRESY • Double 6 out", tone: "bg-sky-500/20 text-sky-200 border-sky-500/40", raw: r };
    }
    if (s.includes("tonga")) return { label: "MANDRESY • Target tratra", tone: "bg-green-500/20 text-green-300 border-green-500/40", raw: r };
    if (s.includes("bloqué") || s.includes("bloque") || s.includes("blocage")) return { label: "Tour: Blocage", tone: "bg-red-500/20 text-red-300 border-red-500/40", raw: r };
    if (s.includes("double 6") || s.includes("6/6") || s.includes("paire de six") || s.includes("nandeha irery")) {
      return { label: "Historique taloha diso", tone: "bg-amber-500/20 text-amber-300 border-amber-500/40", raw: "Règle taloha diso — tsy ekena intsony io karazana fandresena io." };
    }
    if (s.includes("tour vita") || s.includes("+")) return { label: "Tour vita", tone: "bg-slate-500/20 text-slate-300 border-slate-500/40", raw: r };
    if (s.includes("admin")) return { label: "Naverin'ny admin", tone: "bg-slate-500/20 text-slate-300 border-slate-500/40", raw: r };
    return { label: r, tone: "bg-muted text-foreground", raw: r };
  };

  const copyTicket = (t: string) => {
    navigator.clipboard.writeText(t).then(() => toast.success(`Voa-copie: ${t}`)).catch(() => toast.error("Tsy nety ny copie"));
  };

  return (
    <div className="min-h-screen felt-bg pb-24">
      <header className="p-4 flex items-center gap-3 border-b border-primary/20">
        <Button variant="ghost" size="icon" onClick={() => nav(-1 as any)}><ArrowLeft className="w-5 h-5" /></Button>
        <h1 className="font-display gold-text text-xl font-bold">Profile</h1>
      </header>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        <div className="card-felt rounded-2xl p-5 text-center">
          {profile?.selfie_url || profile?.avatar_url ? (
            <img src={profile.selfie_url ?? profile.avatar_url} alt="" className="w-24 h-24 rounded-full object-cover mx-auto border-4 border-primary/60 shadow-lg" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-primary/20 mx-auto flex items-center justify-center text-3xl font-bold gold-text border-4 border-primary/60">
              {(profile?.mvola_name?.[0] ?? "?").toUpperCase()}
            </div>
          )}
          <h2 className="font-display text-2xl font-bold mt-3">{profile?.mvola_name ?? "..."}</h2>
          <p className="text-xs text-muted-foreground">{profile?.phone}</p>
          {profile?.player_number != null && (
            <p className="mt-2 inline-block rounded-full bg-primary/20 border border-primary/40 px-3 py-1 text-xs font-mono font-bold gold-text">
              ID Nº {String(profile.player_number).padStart(4, "0")}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="card-felt rounded-xl p-3 text-center">
            <p className="text-xs text-muted-foreground">Resy lavitra</p>
            <p className="text-2xl font-bold text-green-500">{wins}</p>
          </div>
          <div className="card-felt rounded-xl p-3 text-center">
            <p className="text-xs text-muted-foreground">Resy</p>
            <p className="text-2xl font-bold text-red-500">{losses}</p>
          </div>
          <div className="card-felt rounded-xl p-3 text-center">
            <p className="text-xs text-muted-foreground">Tombony</p>
            <p className={`text-base font-bold ${totalGain >= 0 ? "text-green-500" : "text-red-500"}`}>
              {totalGain >= 0 ? "+" : ""}{fmtAr(totalGain)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between mt-4">
          <h3 className="font-display text-lg font-bold gold-text flex items-center gap-2">
            <Trophy className="w-5 h-5" /> Historique lalao
          </h3>
          {visible.length > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setConfirmAll(true)} className="gap-1">
              <Trash2 className="w-3.5 h-3.5" /> Fafao daholo
            </Button>
          )}
        </div>

        {visible.length === 0 ? (
          <div className="card-felt rounded-xl p-6 text-center text-sm text-muted-foreground">
            Mbola tsy misy lalao vita.
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((g) => {
              const stake = Number(g.stake ?? 0);
              const pc = Number(g.players_count ?? 2);
              const commissionEach = Math.round(stake * 0.10);
              const pot = (stake - commissionEach) * pc;
              const iWon = g.winner_id === user.id;
              const draw = !g.winner_id;
              const kind: "domino" | "ludo" | "petanque" = g.kind ?? "domino";
              const playerIds = [g.player1_id, g.player2_id, g.player3_id, g.player4_id].filter(Boolean) as string[];
              // Score per player (depends on game type)
              const scoresByPid: Record<string, number> = {};
              if (kind === "domino") {
                scoresByPid[g.player1_id] = Number(g.score_p1 ?? 0);
                if (g.player2_id) scoresByPid[g.player2_id] = Number(g.score_p2 ?? 0);
                if (g.player3_id) scoresByPid[g.player3_id] = Number(g.score_p3 ?? 0);
              } else if (kind === "petanque") {
                scoresByPid[g.player1_id] = Number(g.score_p1 ?? 0);
                if (g.player2_id) scoresByPid[g.player2_id] = Number(g.score_p2 ?? 0);
              } else if (kind === "ludo") {
                // score = number of pawns reaching home (pos === 57) per seat
                const pawns: any[] = Array.isArray(g.pawns) ? g.pawns : [];
                const allPlayers = [g.player1_id, g.player2_id, g.player3_id, g.player4_id];
                allPlayers.forEach((pid, slot) => {
                  if (!pid) return;
                  const finished = pawns.filter((p) => Number(p?.seat) === slot + 1 && Number(p?.pos) === 57).length;
                  scoresByPid[pid] = finished;
                });
              }
              // Filaharana: mpandresy aloha, dia ny score mihena
              const ranking = [...playerIds].sort((a, b) => {
                if (a === g.winner_id) return -1;
                if (b === g.winner_id) return 1;
                // domino: low score = better rank, others: high score = better
                if (kind === "domino") return (scoresByPid[a] ?? 0) - (scoresByPid[b] ?? 0);
                return (scoresByPid[b] ?? 0) - (scoresByPid[a] ?? 0);
              });
              const winnerName = g.winner_id ? (names[g.winner_id] ?? "?") : null;
              const reason = parseReason(g.last_reason);
              const date = g.finished_at ?? g.created_at;
              const target = kind === "domino"
                ? (g.game_mode === "d80" ? 80 : 120)
                : kind === "petanque" ? 12 : 4;
              const kindLabel = kind === "ludo" ? "LUDO" : kind === "petanque" ? "PÉTANQUE" : (g.game_mode ?? "d120");
              const KindIcon = kind === "ludo" ? Dice5 : kind === "petanque" ? Target : Trophy;
              // Pétanque outcome reason: Fani (6-0) ou Maty 12
              const petReason: { label: string; tone: string; raw?: string | null } | null = (() => {
                if (kind !== "petanque" || !g.winner_id) return null;
                const s1 = Number(g.score_p1 ?? 0);
                const s2 = Number(g.score_p2 ?? 0);
                const hi = Math.max(s1, s2);
                const lo = Math.min(s1, s2);
                if (lo === 0 && hi >= 6 && hi < 12) return { label: `FANI ${hi}-0`, tone: "bg-purple-500/20 text-purple-300 border-purple-500/40", raw: null };
                if (hi >= 12) return { label: `Maty 12 (${hi}-${lo})`, tone: "bg-amber-500/20 text-amber-300 border-amber-500/40", raw: null };
                return { label: `Vita ${hi}-${lo}`, tone: "bg-green-500/20 text-green-300 border-green-500/40", raw: null };
              })();
              const showReason = petReason ?? reason;
              return (
                <div key={g.id} className={`card-felt rounded-xl p-3 border-l-4 ${draw ? "border-muted" : iWon ? "border-green-500" : "border-red-500"}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${draw ? "bg-muted text-foreground" : iWon ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                        {draw ? "TAPAKA" : iWon ? "NANDRESY" : "RESY"}
                      </span>
                      <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                        <KindIcon className="w-3 h-3" /> {kindLabel} · {pc}P · {kind === "ludo" ? "4 pion" : `tanjona ${target}`}
                      </span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setConfirmId(g.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {g.ticket_number && (
                    <button
                      onClick={() => copyTicket(g.ticket_number)}
                      className="w-full mb-2 flex items-center justify-between gap-2 rounded-lg border-2 border-primary/50 bg-primary/10 px-3 py-2 hover:bg-primary/20 transition"
                    >
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Nº Ticket</span>
                      <span className="font-mono font-bold gold-text text-base tracking-wider flex-1 text-center select-all">#{g.ticket_number}</span>
                      <Copy className="w-4 h-4 text-primary" />
                    </button>
                  )}

                  <div className="rounded-lg border border-border/40 overflow-hidden mb-2">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30">
                        <tr>
                          <th className="text-left px-2 py-1 font-semibold">Laharana</th>
                          <th className="text-left px-2 py-1 font-semibold">Mpilalao</th>
                          <th className="text-right px-2 py-1 font-semibold">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ranking.map((pid, idx) => {
                          const isWinner = pid === g.winner_id;
                          const isMe = pid === user.id;
                          const isLast = idx === ranking.length - 1 && !isWinner;
                          const rankLabel = isWinner ? "1ᵉʳ" : idx === 1 ? "2ᵉ" : "3ᵉ";
                          return (
                            <tr key={pid} className={`border-t border-border/30 ${isMe ? "bg-primary/5" : ""}`}>
                              <td className="px-2 py-1">
                                <span className={`inline-flex items-center gap-1 font-bold ${isWinner ? "text-green-400" : isLast ? "text-red-400" : "text-muted-foreground"}`}>
                                  {isWinner && <Medal className="w-3 h-3" />}
                                  {rankLabel}
                                </span>
                              </td>
                              <td className="px-2 py-1 truncate max-w-[140px]">
                                {names[pid] ?? "?"}{isMe && <span className="text-[10px] text-primary"> (izaho)</span>}
                              </td>
                              <td className="px-2 py-1 text-right font-mono font-bold">{scoresByPid[pid] ?? 0}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                    <span className={`px-2 py-0.5 rounded border ${showReason.tone}`}>{showReason.label}</span>
                    <span className="text-muted-foreground">
                      Mise: <b>{fmtAr(stake)}</b>
                      {iWon && <span className="text-green-400 font-bold"> · +{fmtAr(pot - stake)}</span>}
                      {!iWon && !draw && <span className="text-red-400 font-bold"> · -{fmtAr(stake)}</span>}
                    </span>
                  </div>
                  {showReason.raw && (
                    <p className="text-[10px] text-muted-foreground/80 mt-1 italic">{showReason.raw}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    {date ? new Date(date).toLocaleString("fr-FR") : ""}
                    {g.round_number ? ` · ${g.round_number} tour` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        )}

      </div>

      <AlertDialog open={!!confirmId} onOpenChange={(o) => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hofafana ity lalao ity?</AlertDialogTitle>
            <AlertDialogDescription>Hesorina amin'ny historique-nao fotsiny — tsy voafafa ny solde.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => confirmId && deleteOne(confirmId)}>
              Fafao
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hofafana daholo ny historique?</AlertDialogTitle>
            <AlertDialogDescription>Hesorina amin'ny historique-nao avokoa — tsy voakitika ny solde.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={deleteAll}>
              Fafao daholo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}