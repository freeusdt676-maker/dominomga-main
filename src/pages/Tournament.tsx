import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import { ArrowLeft, Trophy, CheckCircle2, Dices, Target, BookOpen, BarChart3, History, Eye } from "lucide-react";
import { fmtAr } from "@/lib/constants";
import logoTournoi from "@/assets/logo-tournoi.png";

const MG_TZ_OFFSET = 3 * 3600_000;

type GameType = "domino" | "petanque";

const GAME_META: Record<GameType, { label: string; icon: any; emoji: string; gameRoute: (id: string) => string; subtitle: string }> = {
  domino: { label: "Domino", icon: Trophy, emoji: "🁫", gameRoute: (id) => `/game/${id}`, subtitle: "Bracket apahavalon-dalana · Domino 2P" },
  petanque: { label: "Pétanque", icon: Target, emoji: "🎯", gameRoute: (id) => `/petanque/${id}`, subtitle: "Bracket apahavalon-dalana · Pétanque 2P" },
};

function fmtMG(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  // shift to MG time naive
  const mg = new Date(d.getTime() + MG_TZ_OFFSET);
  const days = ["Alahady","Alatsinainy","Talata","Alarobia","Alakamisy","Zoma","Sabotsy"];
  return `${days[mg.getUTCDay()]} ${String(mg.getUTCDate()).padStart(2,"0")}/${String(mg.getUTCMonth()+1).padStart(2,"0")} ${String(mg.getUTCHours()).padStart(2,"0")}:${String(mg.getUTCMinutes()).padStart(2,"0")}`;
}

export default function Tournament() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [gameType, setGameType] = useState<GameType>("domino");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [balance, setBalance] = useState(0);
  const [tab, setTab] = useState("tournoi");

  // Register form
  const [openReg, setOpenReg] = useState(false);
  const [step, setStep] = useState<"form" | "pin" | "confirm">("form");
  const [fNom, setFNom] = useState("");
  const [fTel, setFTel] = useState("");
  const [fId, setFId] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const { data: d, error } = await supabase.rpc("tournament_get_current" as any, { _game_type: gameType });
    if (error) { toast.error(error.message); return; }
    setData(d);
    setLoading(false);
    // also advance (idempotent) — picks up new rounds when time arrives
    try { await supabase.rpc("tournament_advance" as any, { _game_type: gameType }); } catch {}
  };

  useEffect(() => {
    setLoading(true);
    load();
    const ch = supabase.channel("tourn-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_registrations" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_matches" }, () => load())
      .subscribe();
    const itv = setInterval(load, 30_000);
    return () => { supabase.removeChannel(ch); clearInterval(itv); };
  }, [gameType]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
      setProfile(p);
      setFNom(p?.mvola_name ?? "");
      setFTel(p?.phone ?? "");
      setFId(String(p?.player_number ?? ""));
      const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", user.id).single();
      setBalance(Number(w?.balance ?? 0));
    })();
  }, [user]);

  const tournament = data?.tournament;
  const regs: any[] = data?.registrations ?? [];
  const matches: any[] = data?.matches ?? [];
  const count = regs.length;
  const myReg = regs.find((r) => r.user_id === user?.id);
  const isOpen = tournament?.status === "registration"
    && new Date(tournament?.reg_close).getTime() > Date.now()
    && count < 8;

  const handleConfirmForm = () => {
    if (!fNom.trim() || !fTel.trim() || !fId.trim()) return toast.error("Fenoy daholo ny tsipika");
    setStep("pin");
  };

  const handleSubmitPin = async () => {
    if (!pin.trim()) return toast.error("Soraty ny code PIN");
    setSubmitting(true);
    const { data: r, error } = await supabase.rpc("tournament_register" as any, {
      _game_type: gameType, _nom: fNom.trim(), _tel: fTel.trim(), _id_card: fId.trim(), _pin: pin.trim()
    });
    setSubmitting(false);
    if (error) {
      const map: Record<string,string> = {
        pin_diso: "Code PIN diso",
        pin_not_set: "Tsy mbola namboarinao ny PIN-nao",
        insufficient_balance: "Tsy ampy ny solde-nao (5 000 Ar)",
        already_registered: "Efa voasoratra anarana ianao",
        tournament_full: "Feno ny tournoi (8 olona)",
        registration_closed: "Mikatona ny fisoratana anarana",
        registration_closed_time: "Tapitra ny ora fisoratana anarana",
        fields_required: "Fenoy daholo ny tsipika",
        id_card_already_used: "Efa nampiasaina io ID kara-panondro io",
        has_active_tournament_match: "Mbola misy match tornoi tsy vita anananao",
      };
      return toast.error(map[error.message] ?? error.message);
    }
    toast.success(`Tafita! Tafiditra amin'ny groupe ${r?.group} (slot ${r?.slot})`);
    setOpenReg(false); setStep("form"); setPin("");
    load();
  };

  const groupRegs = useMemo(() => {
    const g: Record<string, any[]> = { A: [], B: [], C: [], D: [] };
    regs.forEach((r) => { if (g[r.group_letter]) g[r.group_letter].push(r); });
    return g;
  }, [regs]);

  const myActiveMatch = matches.find((m) =>
    (m.player1_id === user?.id || m.player2_id === user?.id)
    && !m.winner_id && m.game_id && new Date(m.scheduled_at).getTime() <= Date.now()
  );

  const meta = GAME_META[gameType];

  // Auto-redirect: rehefa misy match efa vonona ho an'ity mpilalao ity → tonga
  // dia mafofona ao anaty table du jeu izy (tsy mila mipiana bokotra).
  useEffect(() => {
    if (!myActiveMatch?.game_id) return;
    const t = setTimeout(() => {
      nav(meta.gameRoute(myActiveMatch.game_id));
    }, 800);
    return () => clearTimeout(t);
  }, [myActiveMatch?.game_id]);

  // Countdown live: dingana manaraka
  const nextPhase = useMemo(() => {
    if (!tournament) return null;
    const now = Date.now();
    const phases: { label: string; at: string }[] = [
      { label: "Mikatona inscription", at: tournament.reg_close },
      { label: "Quart de finale", at: tournament.qf_at },
      { label: "Demi-finale", at: tournament.sf_at },
      { label: "Petite finale", at: tournament.third_at },
      { label: "Finale", at: tournament.final_at },
    ];
    return phases.find((p) => new Date(p.at).getTime() > now) ?? null;
  }, [tournament, data]);

  const [tick, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  const countdown = useMemo(() => {
    if (!nextPhase) return null;
    const ms = new Date(nextPhase.at).getTime() - Date.now();
    if (ms <= 0) return "Manomboka...";
    const h = Math.floor(ms / 3600_000);
    const m = Math.floor((ms % 3600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    if (h > 0) return `${h}h ${String(m).padStart(2,"0")}mn`;
    return `${m}mn ${String(s).padStart(2,"0")}s`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextPhase, tick]);

  const liveMatches = matches.filter((m) => !m.winner_id && m.game_id && new Date(m.scheduled_at).getTime() <= Date.now());
  const spectateRoute = (id: string) => ({
    domino: `/spectate/domino/${id}`, petanque: `/spectate/petanque/${id}`,
  } as const)[gameType];

  return (
    <div className="min-h-screen luxe-bg">
      <header className="px-4 py-3 flex items-center gap-3 hairline-b">
        <Button variant="ghost" size="icon" onClick={() => nav("/")} className="text-[hsl(var(--gold-1))]">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2 flex-1">
          <img src={logoTournoi} alt="Tournoi" className="w-9 h-9" />
          <div>
            <p className="eyebrow">Hebdomadaire</p>
            <h1 className="font-serif-luxe gold-luxe-text text-xl leading-none">Tournoi du Semaine</h1>
          </div>
        </div>
      </header>

      <div className="px-4 pt-4 pb-24 max-w-lg mx-auto">
        {tournament?.status === "running" && (
          <div className="mb-4 rounded-xl overflow-hidden border-2 border-red-500/60 bg-gradient-to-r from-red-600/30 via-red-500/20 to-red-600/30 shadow-[0_0_24px_rgba(239,68,68,0.45)] animate-pulse">
            <div className="flex items-center justify-center gap-2 py-2.5 px-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
              <p className="font-serif-luxe text-sm sm:text-base tracking-[0.18em] uppercase text-red-50 drop-shadow">
                🏆 Tornoi du Semaine — <span className="text-yellow-200">EN DIRECT</span>
              </p>
            </div>
          </div>
        )}

        {/* Game type selector */}
        <div className="luxe-card p-1.5 mb-4 grid grid-cols-3 gap-1">
          {(Object.keys(GAME_META) as GameType[]).map((gt) => {
            const m = GAME_META[gt];
            const active = gameType === gt;
            return (
              <button
                key={gt}
                onClick={() => { if (gt !== gameType) { setGameType(gt); setData(null); } }}
                className={`rounded-md py-2 px-1 text-xs font-bold transition-all ${
                  active
                    ? "bg-[hsl(var(--gold-1)/0.18)] gold-luxe-text shadow-inner"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="text-base mr-1">{m.emoji}</span>{m.label.toUpperCase()}
              </button>
            );
          })}
        </div>

        {/* Quick nav: Rules · History · Leaderboard */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <button onClick={() => nav("/tournament/rules")}
            className="luxe-card py-2 px-2 text-[11px] font-bold flex items-center justify-center gap-1 text-muted-foreground hover:gold-luxe-text">
            <BookOpen className="w-3.5 h-3.5" /> FITSIPIKA
          </button>
          <button onClick={() => nav("/tournament/history")}
            className="luxe-card py-2 px-2 text-[11px] font-bold flex items-center justify-center gap-1 text-muted-foreground hover:gold-luxe-text">
            <History className="w-3.5 h-3.5" /> TANTARA
          </button>
          <button onClick={() => nav("/tournament/leaderboard")}
            className="luxe-card py-2 px-2 text-[11px] font-bold flex items-center justify-center gap-1 text-muted-foreground hover:gold-luxe-text">
            <BarChart3 className="w-3.5 h-3.5" /> TOP 20
          </button>
        </div>

        {countdown && nextPhase && tournament?.status !== "finished" && tournament?.status !== "cancelled" && (
          <div className="luxe-card p-3 mb-4 flex items-center justify-between bg-[hsl(var(--gold-1)/0.06)]">
            <div>
              <p className="text-[10px] tracking-widest text-[hsl(var(--gold-1))] uppercase">⏱️ Manaraka</p>
              <p className="text-sm font-bold">{nextPhase.label}</p>
            </div>
            <p className="font-serif-luxe text-2xl gold-luxe-text tabular-nums">{countdown}</p>
          </div>
        )}

        {loading ? (
          <p className="text-center text-muted-foreground py-12">Mihandry...</p>
        ) : (
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="tournoi">🏆 Tournoi</TabsTrigger>
            <TabsTrigger value="regle">📖 Règler</TabsTrigger>
            <TabsTrigger value="join">✍️ Handray</TabsTrigger>
          </TabsList>

          {/* TAB 1 — TOURNOI */}
          <TabsContent value="tournoi" className="space-y-4 mt-4">
            <div className="luxe-card p-5 text-center">
              <img src={logoTournoi} alt="" className="w-24 h-24 mx-auto" loading="lazy" />
              <h2 className="font-serif-luxe text-2xl gold-luxe-text mt-2">Tournoi {meta.label}</h2>
              <p className="text-xs text-muted-foreground mt-1">{meta.subtitle}</p>

              <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                <div className="hairline rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground uppercase">Mpilalao</p>
                  <p className="font-serif-luxe text-2xl gold-luxe-text">{count}/8</p>
                </div>
                <div className="hairline rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground uppercase">Mise</p>
                  <p className="font-serif-luxe text-xl gold-luxe-text">5 000</p>
                </div>
                <div className="hairline rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground uppercase">Loka 1<sup>er</sup></p>
                  <p className="font-serif-luxe text-xl gold-luxe-text">30 000</p>
                </div>
              </div>

              <div className="mt-4 text-left text-xs space-y-1 hairline rounded-lg p-3">
                <p className="flex justify-between"><span>📅 Inscription:</span><span>{fmtMG(tournament?.week_start)} → {fmtMG(tournament?.reg_close)}</span></p>
                <p className="flex justify-between"><span>⏰ ¼ finale:</span><span>{fmtMG(tournament?.qf_at)}</span></p>
                <p className="flex justify-between"><span>⏰ ½ finale:</span><span>{fmtMG(tournament?.sf_at)}</span></p>
                <p className="flex justify-between"><span>⏰ Petite finale:</span><span>{fmtMG(tournament?.third_at)}</span></p>
                <p className="flex justify-between"><span>⏰ Finale:</span><span>{fmtMG(tournament?.final_at)}</span></p>
                <p className="flex justify-between border-t border-[hsl(var(--gold-1)/0.2)] pt-1 mt-1">
                  <span>Statut:</span>
                  <span className="font-bold">
                    {tournament?.status === "registration" && "Inscription mandeha"}
                    {tournament?.status === "running" && "Lalao mandeha"}
                    {tournament?.status === "finished" && "Vita"}
                    {tournament?.status === "cancelled" && "Voafoana"}
                  </span>
                </p>
              </div>

              {myReg && (
                <div className="mt-3 hairline rounded-lg p-3 bg-[hsl(var(--gold-1)/0.06)]">
                  <p className="text-xs"><CheckCircle2 className="inline w-3.5 h-3.5 mr-1 text-emerald-400" />
                    Voasoratra anarana — <b>Groupe {myReg.group_letter}</b> (slot {myReg.slot})</p>
                </div>
              )}

              {myActiveMatch && (
                <button onClick={() => nav(meta.gameRoute(myActiveMatch.game_id))}
                  className="mt-3 w-full btn-luxe animate-pulse">
                  ▶️ Miditra amin'ny lalao-ko
                </button>
              )}
            </div>

            {/* Bracket */}
            {tournament?.status !== "registration" && (
              <div className="luxe-card p-4">
                <h3 className="font-serif-luxe text-lg gold-luxe-text mb-3">Bracket</h3>
                <BracketView matches={matches} regs={regs} />
              </div>
            )}

            {/* Groups */}
            <div className="luxe-card p-4">
              <h3 className="font-serif-luxe text-lg gold-luxe-text mb-3">Groupes (8 mpilalao)</h3>
              <div className="grid grid-cols-2 gap-2">
                {(["A","B","C","D"] as const).map((g) => (
                  <div key={g} className="hairline rounded-lg p-2">
                    <p className="text-[11px] tracking-widest text-[hsl(var(--gold-1))] font-bold">GROUPE {g}</p>
                    {groupRegs[g].length === 0 && <p className="text-[10px] text-muted-foreground italic mt-1">Banga</p>}
                    {groupRegs[g].map((r) => (
                      <p key={r.id} className="text-xs mt-1 truncate">
                        {r.slot}. {r.nom}{r.user_id === user?.id && " (Ianao)"}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Live spectator matches */}
            {liveMatches.length > 0 && (
              <div className="luxe-card p-4">
                <h3 className="font-serif-luxe text-lg gold-luxe-text mb-3 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                  Matchs an-dalana
                </h3>
                <div className="space-y-2">
                  {liveMatches.map((m) => {
                    const nameOf = (uid?: string) => regs.find((r) => r.user_id === uid)?.nom ?? "?";
                    return (
                      <div key={m.id} className="hairline rounded p-2 flex items-center justify-between text-xs">
                        <div>
                          <p className="text-[10px] text-[hsl(var(--gold-1))]">{String(m.round).toUpperCase()} #{m.match_index}</p>
                          <p>{nameOf(m.player1_id)} <span className="text-muted-foreground">vs</span> {nameOf(m.player2_id)}</p>
                        </div>
                        <button onClick={() => nav(spectateRoute(m.game_id))}
                          className="px-3 py-1.5 rounded bg-[hsl(var(--gold-1)/0.18)] gold-luxe-text font-bold flex items-center gap-1">
                          <Eye className="w-3.5 h-3.5" /> Jereo
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tournament?.status === "finished" && tournament.winner_id && (
              <div className="luxe-card p-4 text-center">
                <Trophy className="w-12 h-12 mx-auto text-[hsl(var(--gold-1))]" />
                <p className="eyebrow mt-2">Champion</p>
                <p className="font-serif-luxe text-xl gold-luxe-text">
                  {regs.find((r) => r.user_id === tournament.winner_id)?.nom ?? "?"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  2<sup>è</sup>: {regs.find((r) => r.user_id === tournament.runner_up_id)?.nom ?? "?"}
                </p>
              </div>
            )}
          </TabsContent>

          {/* TAB 2 — RÈGLER */}
          <TabsContent value="regle" className="space-y-3 mt-4">
            <div className="luxe-card p-4">
              <h3 className="font-serif-luxe text-xl gold-luxe-text mb-3">📖 Lalàna feno — {meta.label}</h3>
              <Accordion type="single" collapsible defaultValue="r1">
                <AccordionItem value="r1">
                  <AccordionTrigger className="text-sm">🎮 1. Lalao sy rafitra</AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1">
                    <p>• {meta.label} 2P (mitovy amin'ny lalao tsotra)</p>
                    <p>• 8 mpilalao no ekena (raha feno = mikatona)</p>
                    <p>• Apahavalon-dalana avy hatrany (single-elimination)</p>
                    <p>• Group A/B/C/D (olona 2 isaky ny groupe), miankina amin'ny fahatongavana aloha</p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="r2">
                  <AccordionTrigger className="text-sm">💰 2. Mise sy loka</AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1">
                    <p>• <b>Mise: 5 000 Ar / olona</b> — alaina amin'ny wallet rehefa CONFIRMER + PIN</p>
                    <p>• Vola tafiditra: 8 × 5 000 = <b>40 000 Ar</b></p>
                    <p>• 🥇 Champion: <b>30 000 Ar</b></p>
                    <p>• 🥈 2<sup>è</sup> place: <b>6 000 Ar</b></p>
                    <p>• 🏛️ Commission Administratif: <b>4 000 Ar</b></p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="r3">
                  <AccordionTrigger className="text-sm">📅 3. Fandaharan-tenetena</AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1">
                    <p>• 🗓️ Inscription: <b>Latsinainy 00:00</b> → <b>Sabotsy 00:00</b> (ora MG)</p>
                    <p>• ⏰ <b>14:00</b> — ¼ finale (4 lalao)</p>
                    <p>• ⏰ <b>14:40</b> — ½ finale (2 lalao)</p>
                    <p>• ⏰ <b>15:20</b> — Petite finale (faharoa)</p>
                    <p>• ⏰ <b>16:00</b> — Finale</p>
                    <p>• 🔄 Alahady 00:00: inscription vaovao manomboka indray</p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="r4">
                  <AccordionTrigger className="text-sm">✍️ 4. Fisoratana anarana</AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1">
                    <p>• Wallet iray = inscription iray</p>
                    <p>• Fenoina: NOM, TÉL, ID, MISE 5 000 Ar</p>
                    <p>• CONFIRMER → mitaky code PIN (an'ny wallet)</p>
                    <p>• Vita: alaina avy hatrany ny 5 000 Ar</p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="r5">
                  <AccordionTrigger className="text-sm">❌ 5. Annulation</AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1">
                    <p>• Ny <b>ADMINISTRATIF irery</b> no afaka manafoana fandraisana anjara na ny tournoi manontolo</p>
                    <p>• Raha foanana: <b>miverina avy hatrany ny 5 000 Ar</b> amin'ny wallet</p>
                    <p>• Raha tsy ampy ny 8 mpilalao amin'ny 14:00: foanana ho azy, miverina ny vola</p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="r6">
                  <AccordionTrigger className="text-sm">🛡️ 6. Madio, mazava, tsy misy halatra</AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground space-y-1">
                    <p>• Bracket sy lahatra atao avy hatrany amin'ny serveur — tsy azo kitihina</p>
                    <p>• Ny vola: invariant matematika (40 000 In = 40 000 Out)</p>
                    <p>• Audit log isaky ny dingana</p>
                    <p>• Tsy misy mahalala ny PIN-nao afa-tsy ianao</p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </TabsContent>

          {/* TAB 3 — HANDRAY ANJARA */}
          <TabsContent value="join" className="space-y-3 mt-4">
            <div className="luxe-card p-5 text-center">
              <Trophy className="w-12 h-12 mx-auto text-[hsl(var(--gold-1))]" />
              <h3 className="font-serif-luxe text-xl gold-luxe-text mt-2">Handray anjara</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Soratana anarana 1 isan-tsemana. {count}/8 efa voasoratra.
              </p>
              <p className="text-xs mt-2">Solde-nao: <b className="gold-luxe-text">{fmtAr(balance)}</b></p>

              {myReg ? (
                <div className="mt-4 hairline rounded-lg p-3 bg-[hsl(var(--gold-1)/0.08)] text-left text-sm">
                  <p className="text-emerald-400 font-bold">✓ Efa voasoratra anarana ianao</p>
                  <p className="mt-1 text-xs">Nom: <b>{myReg.nom}</b></p>
                  <p className="text-xs">Tél: <b>{myReg.tel}</b></p>
                  <p className="text-xs">ID: <b>{myReg.id_card}</b></p>
                  <p className="text-xs">Groupe: <b>{myReg.group_letter}{myReg.slot}</b></p>
                  <p className="text-xs">Mise: <b>{fmtAr(myReg.paid_amount)}</b></p>
                </div>
              ) : !isOpen ? (
                <p className="mt-4 text-sm text-amber-400">
                  {count >= 8 ? "Feno ny tournoi" : "Mikatona ny fisoratana anarana"}
                </p>
              ) : null}

              <p className="mt-4 text-[10px] text-muted-foreground">
                Amin'ny fanindriana CONFIRMER + PIN, ekenao fa hanaisotra <b>5 000 Ar</b> amin'ny wallet-nao avy hatrany.
              </p>
            </div>

            {/* Inline registration form */}
            {!myReg && isOpen && (
              <div className="luxe-card p-4 space-y-3">
                <p className="font-serif-luxe text-base gold-luxe-text text-center">
                  ✍️ Fenoy ny fisoratana anarana
                </p>

                <div>
                  <label className="text-[11px] tracking-widest text-[hsl(var(--gold-1))] uppercase">Anarana</label>
                  <Input value={fNom} onChange={(e) => setFNom(e.target.value)} placeholder="Anaranao feno" />
                </div>
                <div>
                  <label className="text-[11px] tracking-widest text-[hsl(var(--gold-1))] uppercase">Numéro</label>
                  <Input value={fTel} onChange={(e) => setFTel(e.target.value)} placeholder="034 / 038..." inputMode="tel" />
                </div>
                <div>
                  <label className="text-[11px] tracking-widest text-[hsl(var(--gold-1))] uppercase">ID</label>
                  <Input value={fId} onChange={(e) => setFId(e.target.value)} placeholder="ID kara-panondro" />
                </div>
                <div className="hairline rounded-lg p-3 text-center bg-[hsl(var(--gold-1)/0.06)]">
                  <p className="text-[11px] tracking-widest text-[hsl(var(--gold-1))] uppercase">Mise</p>
                  <p className="font-serif-luxe text-2xl gold-luxe-text">5 000 Ar</p>
                </div>

                <Button onClick={() => {
                  if (!fNom.trim() || !fTel.trim() || !fId.trim()) { toast.error("Fenoy daholo ny tsipika"); return; }
                  setStep("pin"); setOpenReg(true);
                }} className="w-full btn-luxe text-base py-3">
                  CONFIRMER
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  Avy eo: hangataka ny <b>Code PIN</b> mba hanesorana ny 5 000 Ar amin'ny wallet-nao.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
        )}
      </div>

      {/* Registration Dialog */}
      <Dialog open={openReg} onOpenChange={(o) => { setOpenReg(o); if (!o) { setStep("form"); setPin(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif-luxe gold-luxe-text">
              {step === "form" && "✍️ Fisoratana anarana"}
              {step === "pin" && "🔐 Code PIN"}
            </DialogTitle>
          </DialogHeader>

          {step === "form" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">NOM</label>
                <Input value={fNom} onChange={(e) => setFNom(e.target.value)} placeholder="Anaranao" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">TÉL</label>
                <Input value={fTel} onChange={(e) => setFTel(e.target.value)} placeholder="034..." />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">ID</label>
                <Input value={fId} onChange={(e) => setFId(e.target.value)} placeholder="ID kara-panondro" />
              </div>
              <div className="hairline rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">MISE</p>
                <p className="font-serif-luxe text-2xl gold-luxe-text">5 000 Ar</p>
              </div>
              <DialogFooter className="flex-col gap-2">
                <Button onClick={handleConfirmForm} className="w-full btn-gold">CONFIRMER</Button>
              </DialogFooter>
            </div>
          )}

          {step === "pin" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Hampidiro ny code PIN ny wallet-nao mba hanamarinana ny fanindriana.
              </p>
              <Input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••"
                className="text-center text-2xl tracking-[0.4em]"
                maxLength={6}
              />
              <div className="hairline rounded-lg p-2 text-xs text-center">
                Halaina: <b className="gold-luxe-text">5 000 Ar</b> amin'ny solde-nao
              </div>
              <DialogFooter className="flex-col gap-2">
                <Button onClick={handleSubmitPin} disabled={submitting} className="w-full btn-gold">
                  {submitting ? "Mandefa..." : "CONFIRMER & ALAINA"}
                </Button>
                <Button variant="ghost" onClick={() => setStep("form")} className="w-full">Hiverina</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BracketView({ matches, regs }: { matches: any[]; regs: any[] }) {
  const nameOf = (uid?: string | null) => regs.find((r) => r.user_id === uid)?.nom ?? "?";
  const qf = matches.filter((m) => m.round === "qf").sort((a, b) => a.match_index - b.match_index);
  const sf = matches.filter((m) => m.round === "sf").sort((a, b) => a.match_index - b.match_index);
  const third = matches.find((m) => m.round === "third");
  const final = matches.find((m) => m.round === "final");

  const MatchCard = ({ m, label }: { m?: any; label: string }) => (
    <div className="hairline rounded-lg p-2 min-w-[120px]">
      <p className="text-[9px] tracking-widest text-[hsl(var(--gold-1))]">{label}</p>
      {m ? (
        <>
          <p className={`text-xs truncate ${m.winner_id === m.player1_id ? "font-bold text-emerald-400" : ""}`}>
            {nameOf(m.player1_id)}
          </p>
          <p className={`text-xs truncate ${m.winner_id === m.player2_id ? "font-bold text-emerald-400" : ""}`}>
            {nameOf(m.player2_id)}
          </p>
        </>
      ) : (
        <p className="text-[10px] text-muted-foreground italic">En attente</p>
      )}
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-3 min-w-max">
        <div className="space-y-2">
          <p className="text-[10px] tracking-widest text-muted-foreground">¼ FINALE</p>
          {[1,2,3,4].map((i) => <MatchCard key={i} m={qf.find((m) => m.match_index===i)} label={`QF${i}`} />)}
        </div>
        <div className="space-y-2 self-center">
          <p className="text-[10px] tracking-widest text-muted-foreground">½ FINALE</p>
          {[1,2].map((i) => <MatchCard key={i} m={sf.find((m) => m.match_index===i)} label={`SF${i}`} />)}
        </div>
        <div className="space-y-2 self-center">
          <p className="text-[10px] tracking-widest text-muted-foreground">FINALE</p>
          <MatchCard m={final} label="🏆" />
          <MatchCard m={third} label="🥉 3e" />
        </div>
      </div>
    </div>
  );
}