import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { fmtAr, ADMIN_CODE, ADMIN_CODE_ALT } from "@/lib/constants";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Wallet, Users, Trophy, MessageCircle, LogOut, Shield, MessagesSquare, User as UserIcon, Download, Eye, EyeOff, FileEdit, RotateCcw, BookOpen, ArrowDownToLine } from "lucide-react";
import { Play } from "lucide-react";
import CircleNavButton from "@/components/CircleNavButton";
import logo from "@/assets/logo.png";
import logoDomino from "@/assets/logo-domino.png";
import logoPetanque from "@/assets/logo-petanque.png";
import logoTournoi from "@/assets/logo-tournoi.png";
import logoLudo from "@/assets/logo-ludo.png";
import MessageInbox from "@/components/MessageInbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import LiveSpectatorButton from "@/components/LiveSpectatorButton";
import TournamentCountdown from "@/components/TournamentCountdown";

const ABANDONED_GAME_KEY = "domino_abandoned_game_id";

export default function Home() {
  const { user, isAdmin, signOut } = useAuth();
  const nav = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [balance, setBalance] = useState(0);
  const [tapCount, setTapCount] = useState(0);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");
  const [incoming, setIncoming] = useState<any[]>([]);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [pendingProfilesCount, setPendingProfilesCount] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [activeLudoId, setActiveLudoId] = useState<string | null>(null);
  const [activePetanqueId, setActivePetanqueId] = useState<string | null>(null);

  useEffect(() => {
    const onBip = (e: any) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  const installApp = async () => {
    if (!installPrompt) {
      toast.info("Hampidirana ny app: tsindrio ny menu navigateur → 'Ajouter à l'écran d'accueil'");
      return;
    }
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") toast.success("Voapetraka ny app!");
    setInstallPrompt(null);
  };

  useEffect(() => {
    if (!user) return;

    const redirectToActiveGame = async () => {
      const abandonedGameId = sessionStorage.getItem(ABANDONED_GAME_KEY);
      const { data } = await supabase
        .from("games")
        .select("id, status, updated_at")
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
        .eq("status", "in_progress")
        .order("updated_at", { ascending: false })
        .limit(1);

      const nextActiveGame = data?.find((g) => g.id !== abandonedGameId);

      if (nextActiveGame?.id) {
        nav(`/game/${nextActiveGame.id}`);
      }
    };

    redirectToActiveGame();

    // Only listen to MY games (huge reduction in fanout at scale).
    const ch1 = supabase.channel(`home-games-p1-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "games", filter: `player1_id=eq.${user.id}` },
        () => redirectToActiveGame())
      .subscribe();
    const ch2 = supabase.channel(`home-games-p2-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "games", filter: `player2_id=eq.${user.id}` },
        () => redirectToActiveGame())
      .subscribe();
    const itv = setInterval(redirectToActiveGame, 30000);
    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
      clearInterval(itv);
    };
  }, [user, nav]);

  // Ludo + Pétanque: hita ny lalao mandeha (tsy manao auto-redirect fa "Hanohy" fotsiny)
  useEffect(() => {
    if (!user) return;
    const loadActive = async () => {
      const { data: l } = await supabase
        .from("ludo_games")
        .select("id")
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id},player3_id.eq.${user.id},player4_id.eq.${user.id}`)
        .eq("status", "in_progress")
        .order("updated_at", { ascending: false })
        .limit(1);
      setActiveLudoId(l?.[0]?.id ?? null);
      const { data: p } = await supabase
        .from("petanque_games")
        .select("id")
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
        .eq("status", "in_progress")
        .order("updated_at", { ascending: false })
        .limit(1);
      setActivePetanqueId(p?.[0]?.id ?? null);
    };
    loadActive();
    const ch1 = supabase.channel(`home-ludo-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ludo_games" }, () => loadActive())
      .subscribe();
    const ch2 = supabase.channel(`home-petanque-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "petanque_games" }, () => loadActive())
      .subscribe();
    const itv = setInterval(loadActive, 30000);
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); clearInterval(itv); };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
      setProfile(p);
      const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", user.id).single();
      setBalance(Number(w?.balance ?? 0));
      // mark online
      await supabase.from("profiles").update({ is_online: true, last_seen: new Date().toISOString() }).eq("user_id", user.id);
    })();

    const interval = setInterval(() => {
      supabase.from("profiles").update({ last_seen: new Date().toISOString(), is_online: true }).eq("user_id", user.id);
    }, 60_000);

    return () => {
      clearInterval(interval);
      supabase.from("profiles").update({ is_online: false }).eq("user_id", user.id);
    };
  }, [user]);

  // Admin: count pending profile approvals
  useEffect(() => {
    if (!isAdmin) return;
    const load = async () => {
      const { count } = await supabase
        .from("profile_change_requests" as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      setPendingProfilesCount(count ?? 0);
    };
    load();
    const ch = supabase
      .channel("home-pcr")
      .on("postgres_changes", { event: "*", schema: "public", table: "profile_change_requests" }, () => load())
      .subscribe();
    const itv = setInterval(load, 60000);
    return () => { supabase.removeChannel(ch); clearInterval(itv); };
  }, [isAdmin]);

  // Mandray fanasana (challenges) miditra
  useEffect(() => {
    if (!user) return;
    const loadCh = async () => {
      const { data } = await supabase
        .from("challenges")
        .select("*, profiles!challenges_from_user_fkey(mvola_name)")
        .eq("to_user", user.id).eq("status","pending")
        .gt("expires_at", new Date().toISOString());
      setIncoming(data ?? []);
    };
    loadCh();
    const ch = supabase.channel("ch-"+user.id)
      .on("postgres_changes",{event:"*",schema:"public",table:"challenges",filter:`to_user=eq.${user.id}`}, () => loadCh())
      .subscribe();
    const itv = setInterval(loadCh, 30000);
    return () => { supabase.removeChannel(ch); clearInterval(itv); };
  }, [user]);

  const acceptChallenge = async (c: any) => {
    if (!user) return;
    const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", user.id).single();
    if (Number(w?.balance ?? 0) < Number(c.stake)) return toast.error("Tsy ampy ny solde");
    const { data, error } = await supabase.rpc("accept_challenge_start_game", { _challenge_id: c.id });
    const gameId = data && typeof data === "object" && "game_id" in data ? String((data as any).game_id ?? "") : "";
    if (error || !gameId) return toast.error(error?.message ?? "Hadisoana");
    nav(`/game/${gameId}`);
  };
  const declineChallenge = async (c: any) => {
    await supabase.from("challenges").update({ status: "declined" }).eq("id", c.id);
  };

  const handleAdminTap = () => {
    const next = tapCount + 1;
    setTapCount(next);
    if (next >= 3) {
      setTapCount(0);
      setShowCode(true);
    }
    setTimeout(() => setTapCount(0), 1500);
  };

  const handleAdminCode = () => {
    const c = code.trim();
    if (c === ADMIN_CODE || c === ADMIN_CODE_ALT) {
      setShowCode(false);
      setCode("");
      sessionStorage.setItem("admin_code_ok", "1");
      nav("/admin");
    } else {
      toast.error("Code diso");
    }
  };

  const handleResetData = async () => {
    if (resetting) return;
    setResetting(true);
    const { error } = await supabase.rpc("user_reset_history" as any);
    setResetting(false);
    setResetOpen(false);
    if (error) return toast.error(error.message ?? "Tsy nahomby");
    toast.success("Voafafa daholo ny tantara — ny vola tsy voakitika");
  };

  return (
    <div className="min-h-screen luxe-bg">
      <header className="relative z-10 px-5 py-4 flex items-center justify-between hairline-b">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute -inset-1 rounded-full bg-[hsl(var(--gold-1)/0.15)] blur-md" />
            <img src={logo} alt="DOMINO MGA" className="relative w-10 h-10 rounded-full ring-1 ring-[hsl(var(--gold-1)/0.4)]" />
          </div>
          <div className="leading-none">
            <p className="eyebrow">Maison de jeu</p>
            <h1 className="font-serif-luxe gold-luxe-text text-2xl mt-1">Domino MGA</h1>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <MessageInbox />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setResetOpen(true)}
            title="Réinitialiser les données"
            className="text-[hsl(var(--gold-1))] hover:bg-[hsl(var(--gold-1)/0.08)]"
          >
            <RotateCcw className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={signOut} className="text-[hsl(var(--gold-1))] hover:bg-[hsl(var(--gold-1)/0.08)]"><LogOut className="w-5 h-5" /></Button>
        </div>
      </header>

      {/* Tournoi banner — eny ambony indrindra */}
      <div className="relative z-10 px-4 pt-2 max-w-lg mx-auto">
        <TournamentCountdown />
      </div>

      <div className="relative z-10 px-4 pt-5 pb-32 space-y-5 max-w-lg mx-auto">
        {incoming.length > 0 && (
          <div className="luxe-card p-4 ring-1 ring-[hsl(var(--gold-1)/0.5)] animate-pulse">
            <p className="eyebrow mb-1">Défi</p>
            <p className="font-serif-luxe gold-luxe-text text-xl mb-2">⚔️ Misy fanasana</p>
            {incoming.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 py-2 hairline-t first:border-t-0">
                <div className="text-sm">
                  <p className="font-bold">{c.profiles?.mvola_name ?? "?"}</p>
                  <p className="text-xs text-muted-foreground">Mise: {fmtAr(c.stake)}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => acceptChallenge(c)} className="btn-luxe !py-2 !px-4 text-[11px]">Eny</button>
                  <button onClick={() => declineChallenge(c)} className="btn-luxe-ghost !py-2 !px-3 text-[11px]">Tsia</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Hero wallet card */}
        <div className="luxe-hero p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="eyebrow">Tonga soa</p>
              <h2 className="font-serif-luxe text-3xl mt-1 gold-luxe-text leading-none">{profile?.mvola_name ?? "..."}</h2>
              <p className="text-[11px] text-muted-foreground mt-2 tracking-wider">{profile?.phone}</p>
            </div>
            <span className="text-[10px] font-sans-pro tracking-[0.2em] uppercase text-[hsl(var(--gold-1))] border border-[hsl(var(--gold-1)/0.4)] rounded-full px-2 py-1">VIP</span>
          </div>

          <div className="my-5 h-px bg-gradient-to-r from-transparent via-[hsl(var(--gold-1)/0.4)] to-transparent" />

          <div className="flex items-end justify-between">
            <div>
              <p className="eyebrow">Solde WALLET</p>
              <p className="font-serif-luxe text-[40px] leading-none gold-luxe-text mt-2">{fmtAr(balance)}</p>
            </div>
            <Link to="/wallet">
              <button className="btn-luxe inline-flex items-center gap-2">
                <Wallet className="w-3.5 h-3.5" />
                <span>WALLET</span>
                <span className="inline-flex items-center gap-0.5 text-[9px] font-black leading-none text-[hsl(var(--gold-1))]">
                  <span className="rounded-full border border-[hsl(var(--gold-1)/0.5)] px-1">M</span>
                  <span className="rounded-full border border-[hsl(var(--gold-1)/0.5)] px-1">A</span>
                </span>
              </button>
            </Link>
          </div>
        </div>

        <div className="crest-divider px-2">
          <span className="text-[10px] tracking-[0.4em] uppercase">— Salles —</span>
        </div>

        {/* Game rooms */}
        <div className="space-y-3">
          <Link to="/lobby" className="block luxe-card p-5 group transition hover:border-[hsl(var(--gold-1)/0.5)]">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl flex items-center justify-center bg-gradient-to-br from-[hsl(150_55%_22%)] to-[hsl(155_65%_10%)] border border-[hsl(var(--gold-1)/0.3)] overflow-hidden">
                <img src={logoDomino} alt="Domino" className="w-14 h-14 object-contain" width={56} height={56} loading="lazy" />
              </div>
              <div className="flex-1">
                <p className="eyebrow">Classique</p>
                <h3 className="font-serif-luxe text-2xl gold-luxe-text leading-tight">Domino</h3>
                <p className="text-xs text-muted-foreground mt-1">2P · 3P — Mise sy gain mitovy</p>
              </div>
              <span className="text-[hsl(var(--gold-1))] opacity-50 group-hover:opacity-100 transition text-xl">→</span>
            </div>
          </Link>

          <Link to={activePetanqueId ? `/petanque/${activePetanqueId}` : "/petanque"} className="block luxe-card p-5 group transition hover:border-[hsl(var(--gold-1)/0.5)] relative">
            {activePetanqueId && (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 bg-green-600 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-md animate-pulse">
                <Play className="w-3 h-3 fill-current" /> Hanohy
              </span>
            )}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl flex items-center justify-center bg-gradient-to-br from-[#1a5e3a] to-[#0a2e1c] border border-[hsl(var(--gold-1)/0.3)] overflow-hidden">
                <img src={logoPetanque} alt="Pétanque" className="w-14 h-14 object-contain" width={56} height={56} loading="lazy" />
              </div>
              <div className="flex-1">
                <p className="eyebrow">Tropical 3D</p>
                <h3 className="font-serif-luxe text-2xl gold-luxe-text leading-tight">Pétanque MGA</h3>
                <p className="text-xs text-muted-foreground mt-1">Duel 2P — Maty 12 · Décor Malagasy</p>
              </div>
              <span className="text-[hsl(var(--gold-1))] opacity-50 group-hover:opacity-100 transition text-xl">→</span>
            </div>
          </Link>

          <Link to={activeLudoId ? `/ludo/${activeLudoId}` : "/ludo"} className="block luxe-card p-5 group transition hover:border-[hsl(var(--gold-1)/0.5)] relative">
            {activeLudoId && (
              <span className="absolute top-2 right-2 inline-flex items-center gap-1 bg-blue-600 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-md animate-pulse">
                <Play className="w-3 h-3 fill-current" /> Hanohy
              </span>
            )}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl flex items-center justify-center bg-gradient-to-br from-[#1e88e5] to-[#0b3d75] border border-[hsl(var(--gold-1)/0.3)] overflow-hidden">
                <img src={logoLudo} alt="Ludo" className="w-14 h-14 object-contain" width={56} height={56} loading="lazy" />
              </div>
              <div className="flex-1">
                <p className="eyebrow">Classique</p>
                <h3 className="font-serif-luxe text-2xl gold-luxe-text leading-tight">Ludo</h3>
                <p className="text-xs text-muted-foreground mt-1">Solo vs 3 bot — Board tena tarehy</p>
              </div>
              <span className="text-[hsl(var(--gold-1))] opacity-50 group-hover:opacity-100 transition text-xl">→</span>
            </div>
          </Link>

          <Link to="/tournament" className="block luxe-card p-5 group transition hover:border-[hsl(var(--gold-1)/0.5)] ring-1 ring-[hsl(var(--gold-1)/0.35)]">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl flex items-center justify-center bg-gradient-to-br from-[#8a6c10] to-[#3a2a04] border border-[hsl(var(--gold-1)/0.5)] overflow-hidden">
                <img src={logoTournoi} alt="Tournoi" className="w-14 h-14 object-contain" width={56} height={56} loading="lazy" />
              </div>
              <div className="flex-1">
                <p className="eyebrow">Hebdomadaire</p>
                <h3 className="font-serif-luxe text-2xl gold-luxe-text leading-tight">Tournoi du Semaine</h3>
                <p className="text-xs text-muted-foreground mt-1">8 mpilalao · 5 000 Ar · Loka 30 000 Ar</p>
              </div>
              <span className="text-[hsl(var(--gold-1))] opacity-50 group-hover:opacity-100 transition text-xl">→</span>
            </div>
          </Link>
        </div>

        {/* Règles du jeu — résumé direct sur la page d'accueil */}
        <div className="crest-divider px-2">
          <span className="text-[10px] tracking-[0.4em] uppercase">— Règles du jeu —</span>
        </div>
        <div className="luxe-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-[hsl(var(--gold-1))]" />
            <p className="font-serif-luxe text-lg leading-none gold-luxe-text">Lalàna fohifohy</p>
          </div>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="r1">
              <AccordionTrigger className="text-sm">1. Mombamomba ny mise</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">Apetraka MVola fotsiny ny mise. Ny gain = mise × isan'ny mpilalao × 0,9 (commission 10%). Tsy misy fanovana mise rehefa miditra ny lalao.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="r2">
              <AccordionTrigger className="text-sm">2. Fitsipiky ny lobby (2 min)</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">Ny demande tsy mahita mpifanandrina ao anatin'ny <b>2 minitra</b> dia foanana ho azy. Afaka mametraka demande indray ianao avy hatrany.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="r3">
              <AccordionTrigger className="text-sm">3. Domino — Maty 120 / 80 / Atanana</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">2P na 3P. Mpilalao mametraka domy araka ny laharana. Resy ny manana domy be indrindra rehefa tapaka ny lalao. Atao 120 na 80 isa, na ny manaisotra ny domy rehetra eny an-tanana.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="r4">
              <AccordionTrigger className="text-sm">4. Ludo — 2P / 3P / 4P</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">Hokitihana ny dés mba hampandeha pion. 6 = miala ny pion sady mihazakazaka indray. Manompy ny pion fahavalo dia averina any am-pirina. Mpandresy ny voalohany manatratra ny 4 pion ao am-pirina.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="r5">
              <AccordionTrigger className="text-sm">5. Pétanque MGA — duel 2P</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">Hatsipy ny boule akaiky ny cochonnet (mpadry). 20 segondra isaky ny tour — raha lany ny ora, mitsipy ho azy. Mahazo poent ny boule akaiky kokoa noho ny rehetra an'ny fahavalo. Maty 12 no resy.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="r6">
              <AccordionTrigger className="text-sm">6. Appel (voice chat)</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">Isaky ny lalao mandeha, afaka miantso amin'ny "APEL" ny mpilalao tsirairay. Mety hoan'ny 2P, 3P na 4P. Tsindrio "Vono micro" raha tsy te hiteny.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="r7">
              <AccordionTrigger className="text-sm">7. Solde MVola sy fakana vola</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">Mametraka vola amin'ny MVola, miandry validation ny admin. Ny solde dia <b>tsy fafana mihitsy</b> na inona na inona Réinitialiser ataonao.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="r8">
              <AccordionTrigger className="text-sm">8. Réinitialisation</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">Ny bokotra ↻ eo ambony dia mamafa ny <b>message, historique du jeu sy transaction</b>. Ny <b>vola</b> dia tsy voakitika.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="r9">
              <AccordionTrigger className="text-sm">9. Sécurité sy hosoka</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">Tsy fanontaniana mihitsy ny PIN MVola amin'olon-kafa. Ny admin mahita ny fanao rehetra. Voasakana 15 min ianao raha diso 5 ny mot de passe.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="r10">
              <AccordionTrigger className="text-sm">10. Fitondran-tena</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">Lalao milamina no kendrena. Aza manompa, aza mandrora, aza manakorontana mpilalao hafa. Ny fandikan-dalàna mahatonga fanasarahana mandrakizay.</AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <div className="crest-divider px-2">
          <span className="text-[10px] tracking-[0.4em] uppercase">— Conciergerie —</span>
        </div>

        <div className="luxe-card p-3">
          <div className="grid grid-cols-3 gap-2">
            <CircleNavButton
              icon={<Wallet />}
              label="WALLET"
              variant="primary"
              onClick={() => nav("/wallet")}
            />
            <CircleNavButton
              icon={<ArrowDownToLine />}
              label="Transactions"
              variant="warning"
              onClick={() => nav("/wallet")}
            />
            <CircleNavButton
              icon={<MessagesSquare />}
              label="Discussions"
              variant="info"
              onClick={() => nav("/discussions")}
            />
            <CircleNavButton
              icon={<MessageCircle />}
              label="Chat Admin"
              variant="success"
              onClick={() => nav("/admin-chat")}
            />
            <CircleNavButton
              icon={<UserIcon />}
              label="Profil"
              variant="default"
              onClick={() => nav("/profile")}
            />
            {isAdmin && (
              <CircleNavButton
                icon={<Shield />}
                label="Admin"
                variant="danger"
                badge={pendingProfilesCount}
                onClick={() => nav("/admin")}
              />
            )}
          </div>
        </div>

        <Link to="/profile" className="block luxe-card p-4 group">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[hsl(var(--gold-1)/0.1)] border border-[hsl(var(--gold-1)/0.3)] flex items-center justify-center">
              <UserIcon className="w-5 h-5 text-[hsl(var(--gold-1))]" />
            </div>
            <div className="flex-1">
              <p className="font-serif-luxe text-lg leading-none">Profile</p>
              <p className="text-xs text-muted-foreground mt-1">Historique sy score</p>
            </div>
            <Trophy className="w-4 h-4 text-[hsl(var(--gold-1))] opacity-60 group-hover:opacity-100 transition" />
          </div>
        </Link>

        {/* Private profile card — visible only to the owner */}
        <div className="luxe-card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="eyebrow">Mombamomba anao (privé)</p>
            <button
              onClick={() => setShowSecrets((s) => !s)}
              className="text-[10px] text-[hsl(var(--gold-1))] inline-flex items-center gap-1"
            >
              {showSecrets ? <><EyeOff className="w-3 h-3" /> Hafenina</> : <><Eye className="w-3 h-3" /> Asehoy</>}
            </button>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-16 h-16 rounded-full overflow-hidden border border-[hsl(var(--gold-1)/0.4)] bg-black/40 flex items-center justify-center">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="selfie" className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-7 h-7 text-[hsl(var(--gold-1))]" />
              )}
            </div>
            <div className="text-xs flex-1 min-w-0 space-y-0.5">
              <p><span className="text-muted-foreground">Nom:</span> <b>{profile?.mvola_name ?? "—"}</b></p>
              <p><span className="text-muted-foreground">Tel:</span> {profile?.phone ?? "—"}</p>
              <p><span className="text-muted-foreground">ID:</span> #{profile?.player_number ?? "—"}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="hairline rounded-lg p-2">
              <p className="text-muted-foreground text-[10px]">Password</p>
              <p className="font-mono">{showSecrets ? (profile?.password_plain ?? "—") : "••••••"}</p>
            </div>
            <div className="hairline rounded-lg p-2">
              <p className="text-muted-foreground text-[10px]">PIN</p>
              <p className="font-mono">{showSecrets ? (profile?.pin_plain ?? "—") : "••••"}</p>
            </div>
          </div>
          <Link to="/profile/edit" className="mt-3 block">
            <button className="w-full btn-luxe inline-flex items-center justify-center gap-2">
              <FileEdit className="w-4 h-4" /> Remplir les informations
            </button>
          </Link>
          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            Ny olon-kafa amin'ny lalao tsy mahita ny Tel, Password, na PIN-nao.
          </p>
        </div>

        <Link to="/rules" className="block text-center hairline rounded-xl p-3 text-xs tracking-[0.2em] uppercase text-muted-foreground hover:text-[hsl(var(--gold-1))] hover:border-[hsl(var(--gold-1)/0.5)] transition">
          Règle du jeu
        </Link>

        <button onClick={installApp} className="w-full luxe-card p-3.5 flex items-center justify-center gap-2 text-xs font-sans-pro tracking-wide hover:border-[hsl(var(--gold-1)/0.6)] transition">
          <Download className="w-4 h-4 text-[hsl(var(--gold-1))]" />
          <span className="font-semibold">Hampiditra ny app amin'ny finday</span>
        </button>

        <p className="text-center text-[10px] tracking-[0.35em] uppercase text-muted-foreground/50 pt-4">Domino MGA · Maison de jeu · v1</p>

        {isAdmin && (
          <Link to="/admin" className="block">
            <button className="w-full btn-luxe-ghost relative inline-flex items-center justify-center gap-2">
              Tableau Admin
              {pendingProfilesCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[26px] h-[26px] px-2 rounded-full bg-red-600 text-white text-xs font-bold ring-2 ring-red-300 animate-pulse shadow-lg shadow-red-500/50">
                  {pendingProfilesCount}
                </span>
              )}
            </button>
          </Link>
        )}
      </div>

      {/* Bokotra ADMINISTRATIF — FAB amin'ny zorony havanana ambany — triple click */}
      <button
        onClick={handleAdminTap}
        aria-label="Administratif"
        className="fixed bottom-4 right-4 w-14 h-14 rounded-full bg-card/40 border border-primary/20 backdrop-blur flex items-center justify-center shadow-lg active:scale-95 transition select-none z-50"
      >
        <Shield className="w-5 h-5 text-primary/40" />
        {tapCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-bold">{tapCount}</span>
        )}
      </button>

      <LiveSpectatorButton position="home" />

      <Dialog open={showCode} onOpenChange={setShowCode}>
        <DialogContent>
          <DialogHeader><DialogTitle>Code Administratif</DialogTitle></DialogHeader>
          <Input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" />
          <Button onClick={handleAdminCode} className="btn-gold">Hampiditra</Button>
        </DialogContent>
      </Dialog>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hofafainao daholo?</AlertDialogTitle>
            <AlertDialogDescription>
              Ity bokotra ity dia hamafa ny <b>message</b>, ny <b>historique du jeu</b>, ary ny <b>historique transaction</b>.
              Ny <b>vola anananao</b> dia <b>tsy voakitika</b>. Tsy azo averina io fanafana io.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tsia</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetData} disabled={resetting}>
              {resetting ? "Manafa..." : "Eny, fafao"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
