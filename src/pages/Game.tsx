import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Home as HomeIcon, Clock, LogOut } from "lucide-react";
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
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { fmtAr } from "@/lib/constants";
// Domino: tour mandritra 15 segondra. Aloha ny 15s dia ny mpilalao IHANY no
// manindry, rehefa tapitra ny 15s vao mandeha automatique (auto-play).
const TURN_TIMEOUT_SEC = 15;
// Anti-skip 3P: ny client an'ilay tompon'ny tour ihany no mahazo manao auto.
// Raha offline izy, ny backend watchdog no mandray andraikitra fa tsy client an'ny hafa.
import { DominoTile, DominoBack } from "@/components/DominoTile";
import { SnakeBoard } from "@/components/SnakeBoard";
import { useThemeClass } from "@/hooks/use-theme-class";
import { RadioPlayer } from "@/components/RadioPlayer";
import { GameChat } from "@/components/GameChat";
import LudoVoiceChat from "@/components/LudoVoiceChat";
import dominoSceneBg from "@/assets/domino-scene.jpg";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Tile, Placed, deal, deal3, ends, canPlace, place, pipsTotal, hasMove, chooseOpening,
} from "@/lib/dominoEngine";
import { toast } from "sonner";
import { sfx } from "@/lib/sfx";
import {
  getDominoRoundReason,
  getDominoSoloThreshold,
  getDominoTarget,
  isDominoDoubleSixOut,
  isDominoGameWin,
  isDominoSoloWin,
} from "@/lib/dominoRules";

type GameState = {
  player1_hand: Tile[];
  player2_hand: Tile[];
  board: Placed[];
  boneyard: Tile[];
  current_turn: string;
  passes: number;
};

const ABANDONED_GAME_KEY = "domino_abandoned_game_id";

type GameMode = "d120" | "d80" | "hand";
// Mode "hand" (Maty atànana) nesorina — tsy misy intsony karazana lalao "atànana".
// Ny lalao rehetra dia tonga amin'ny target (80 na 120) ihany no mamarana azy.

function getPlayerIds(g: any): string[] {
  const pc = Number(g?.players_count ?? 2);
  return pc === 3
    ? [g.player1_id, g.player2_id, g.player3_id].filter(Boolean)
    : [g.player1_id, g.player2_id].filter(Boolean);
}
function nextTurnId(g: any, currentId: string): string {
  // Fihodinana mihodina mankany ANKAVIA (contraire montre) — mihemotra ao amin'ny
  // ordre table live. 2P: P1 ↔ P2. 3P: P1 → P3 → P2 → P1 (A → C → B → A).
  const ids = getPlayerIds(g);
  const i = ids.indexOf(currentId);
  const n = ids.length;
  return ids[(i - 1 + n) % n] ?? ids[0];
}
function roundOpenerId(g: any, roundNumber: number): string {
  const ids = getPlayerIds(g);
  // Lohavato mifandimby tanteraka isaky ny tour/round: R1=P1, R2=P2, R3=P3, R4=P1...
  return ids[(Math.max(1, roundNumber) - 1) % ids.length] ?? ids[0];
}
function getHandKey(g: any, uid: string): "player1_hand" | "player2_hand" | "player3_hand" | null {
  if (!g) return null;
  if (uid === g.player1_id) return "player1_hand";
  if (uid === g.player2_id) return "player2_hand";
  if (uid === g.player3_id) return "player3_hand";
  return null;
}

// ============================================================
// Bot GRAND-MAÎTRE — mahay lavitra noho ny olombelona.
// Fandinihana:
//  - Fandresena (vato farany, mandeha irery, double 6 out) = ambony indrindra
//  - "Unseen tiles" (vato tsy hita) → probabilité manana suit ny mpanohitra
//  - Blocking: mifidy tendrony izay saro-tadiavina ho an'ny mpanohitra
//  - Endgame: raha kely ny an-tànana ny mpanohitra, avantana ny fanakanana
//  - Control: mitazona suit hifehezany, fadio ny manokatra suit tsy anananao
//  - Dump: mesorina ny pips lehibe indrindra alohan'ny blocage
//  - Doubles: alefaso raha tsy mifehy ilay suit; tazomy raha mifehy
// ============================================================
function tileKey(a: number, b: number) { return `${Math.min(a, b)}-${Math.max(a, b)}`; }
function computeUnseenTiles(hand: Tile[], board: Placed[]): Tile[] {
  const seen = new Set<string>();
  for (const p of board) seen.add(tileKey(p.tile[0], p.tile[1]));
  for (const t of hand) seen.add(tileKey(t[0], t[1]));
  const arr: Tile[] = [];
  for (let a = 0; a <= 6; a += 1) for (let b = a; b <= 6; b += 1) {
    if (!seen.has(tileKey(a, b))) arr.push([a, b]);
  }
  return arr;
}
function countSuit(h: Tile[], v: number) {
  return h.reduce((n, [a, b]) => n + (a === v ? 1 : 0) + (b === v ? 1 : 0), 0);
}
function chooseBestBotMove(
  hand: Tile[],
  board: Placed[],
  opts: { opponentSizes?: number[]; boneyardSize?: number } = {},
): { index: number; side: "left" | "right" } | null {
  type Cand = { index: number; side: "left" | "right"; score: number };
  const cands: Cand[] = [];
  const unseen = computeUnseenTiles(hand, board);
  const unseenSuit = (v: number) => countSuit(unseen, v);
  const oppSizes = opts.opponentSizes ?? [];
  const oppMin = oppSizes.length ? Math.min(...oppSizes) : 7;
  const endgameOpp = oppMin <= 3;
  const criticalOpp = oppMin <= 2;

  for (let i = 0; i < hand.length; i++) {
    const tile = hand[i];
    const can = canPlace(board, tile);
    if (can === null) continue;
    const sides: ("left" | "right")[] =
      can === "either" ? ["left", "right"] : [can];
    for (const side of sides) {
      const nb = place(board, tile, side);
      const e = ends(nb);
      const remaining = hand.filter((_, k) => k !== i);
      const pipsRem = pipsTotal(remaining);
      const [a, b] = tile;
      const isDouble = a === b;
      let score = 0;

      // 1) Fandresena = ambony indrindra (mamarana ny tour, mety mandresy ny lalao)
      if (remaining.length === 0) {
        score += 1_000_000;
        // Double 6 out bonus
        if (a === 6 && b === 6) score += 500;
        cands.push({ index: i, side, score });
        continue;
      }

      // 2) Dump pips — lanjaina ambony amin'ny endgame (fandrao blocage)
      const dumpWeight = criticalOpp ? 8 : endgameOpp ? 5 : 3;
      score += (a + b) * dumpWeight;
      // Mihena raha be ny sisa an-tanana (mety ho bloqué)
      score -= pipsRem * 0.35;

      // 3) Doubles: alefaso raha tsy mifehy ilay suit, tazomy raha mifehy
      if (isDouble) {
        const suitAfter = countSuit(remaining, a);
        if (suitAfter <= 1) score += 12 + a * 1.5; // dump — mora bloqué
        else score -= 3 + a * 0.5; // hold — mifehy ilay suit
      }

      if (e) {
        const myLeft = countSuit(remaining, e.left);
        const myRight = countSuit(remaining, e.right);
        const uL = unseenSuit(e.left);
        const uR = unseenSuit(e.right);

        // 4) Control — mitazona hifanaraka amin'ny tendrony vaovao
        score += myLeft * 5 + myRight * 5;

        // 5) Blocking — tendrony sarotra ho an'ny mpanohitra (unseen kely)
        // 8 = isan'ny vato manana ilay suit iray ao anaty jeu (7 mifanaraka + double)
        const blockL = Math.max(0, 8 - uL);
        const blockR = Math.max(0, 8 - uR);
        const blockMul = criticalOpp ? 3.5 : endgameOpp ? 2 : 1;
        score += (blockL + blockR) * blockMul;

        // 6) Domination — tendrony roa mitovy suit + isika mifehy
        if (e.left === e.right) {
          if (myLeft >= 2) score += 25 + myLeft * 4;
          else if (myLeft === 1) score += 8;
          else score -= 25; // manome fahafahana ho an'ny mpanohitra
        }

        // 7) Fadio ny manokatra suit tsy anananao intsony
        if (myLeft === 0 && e.left !== e.right) score -= 5;
        if (myRight === 0 && e.left !== e.right) score -= 5;

        // 8) Raha efa hifarana ny mpanohitra ary probable fa tsy hanana ilay suit
        //    (unseen kely) → tena tsara ny manakana
        if (endgameOpp) {
          if (uL <= 2) score += 15;
          if (uR <= 2) score += 15;
        }
      }

      cands.push({ index: i, side, score });
    }
  }
  if (cands.length === 0) return null;
  cands.sort((x, y) => y.score - x.score);
  return { index: cands[0].index, side: cands[0].side };
}

export default function Game() {
  useThemeClass("domino");
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [serverGame, setServerGame] = useState<any>(null);
  const [optimistic, setOptimistic] = useState<any>(null);
  const game = optimistic ?? serverGame;
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [myBalance, setMyBalance] = useState<number | null>(null);
  const [profilePhotos, setProfilePhotos] = useState<Record<string, string | null>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Famadihana an-tànana: ny pilalao afaka mamadika ny vato ao am-pelatànany
  // araka izay tiany (rotation 180°), nefa tsy miova ny valeur azo ametraka.
  const [flippedHand, setFlippedHand] = useState<Record<number, boolean>>({});
  const [ticketBanner, setTicketBanner] = useState<string | null>(null);
  const [roundBanner, setRoundBanner] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [isAbandoning, setIsAbandoning] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);
  const autoActedRef = useRef<string | null>(null);
  const warnedRef = useRef<string | null>(null);
  // Bot local — local-only toggle per user (raketina ao amin'ny localStorage).
  // Tsy mihatra mihitsy amin'ny compte adversaire.
  const [botActive, setBotActive] = useState<boolean>(() => {
    try { return localStorage.getItem("domino_bot_active") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("domino_bot_active", botActive ? "1" : "0"); } catch {}
  }, [botActive]);
  // Fantsona local: rehefa miova ny tour dia raketina ny ora LOCAL — izany no
  // miaro amin'ny "clock skew" (ora server ≠ ora telefaona) izay nahatonga ny
  // auto-play handeha mialoha ny 15s.
  const turnAnchorRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const watchdogNudgeRef = useRef<string | null>(null);
  const initLockRef = useRef(false);
  const roundEndLockRef = useRef<string | null>(null);
  const revealCommitRef = useRef<string | null>(null);
  const isMobile = useIsMobile();
  const longPressRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const suppressClickRef = useRef(false);
  const pressStartXRef = useRef(0);
  const pressStartYRef = useRef(0);
  const pointerTileIndexRef = useRef<number | null>(null);

  const getAbandonedGameId = () => sessionStorage.getItem(ABANDONED_GAME_KEY);

  // Reconcile optimistic with server: drop optimistic when server catches up
  useEffect(() => {
    if (!serverGame) return;
    if (!optimistic) return;
    // If server is at least as new as optimistic (same updated_at or newer), drop optimistic
    if (new Date(serverGame.updated_at).getTime() >= new Date(optimistic.updated_at ?? 0).getTime()) {
      setOptimistic(null);
    }
  }, [serverGame, optimistic]);

  // Safety: optimistic state must never linger more than 2.5s. After that,
  // the server view wins, which prevents "stuck" wrong-turn display when an
  // RPC was slow or a realtime event was missed.
  useEffect(() => {
    if (!optimistic) return;
    const t = setTimeout(() => setOptimistic(null), 2500);
    return () => clearTimeout(t);
  }, [optimistic]);

  // Tsy misy toast pass/placement intsony: résumé "Tour vita" ihany no aseho.

  // DATINANDRO — NESORINA tanteraka. Tsy fandresena intsony ny "datinandro".
  // Ny target (D80=80, D120=120) sy SOLO sy DOUBLE 6 ihany no mahatonga
  // fandresena. (Voasoratra eto mba tsy hiverina ho azy ny code.)

  const initializeGameHands = async (currentGame: any) => {
    const pc = Number(currentGame?.players_count ?? 2);
    if (!currentGame?.id || !currentGame.player1_id || !currentGame.player2_id) return;
    if (pc === 3 && !currentGame.player3_id) return;
    if (initLockRef.current) return;
    initLockRef.current = true;

    try {
      const seed = `${currentGame.ticket_number || currentGame.id}-r${currentGame.round_number ?? 1}`;
      const mode = (currentGame.game_mode ?? "d120") as GameMode;
      let hands: Tile[][];
      let boneyard: Tile[];
      if (pc === 3) {
        const d = deal3(seed);
        hands = [d.p1, d.p2, d.p3];
        boneyard = d.boneyard;
      } else {
        const d = deal(seed);
        hands = [d.p1, d.p2];
        boneyard = d.boneyard;
      }
      // LOCKED: Tsy misy "instant win" amin'ny double atànana intsony. Ny lalao
      // dia mandeha hatrany, ary izay tonga aloha amin'ny target (D80=80,
      // D120=120) no mandresy. (Sokajy hafa rehetra nesorina.)
      // Rotation explicite ny topon'ny tour: tour 1 = player1, tour 2 = player2,
      // tour 3 = player3, dia miverina amin'ny player1. Tsy miankina amin'ny vato
      // lehibe indrindra intsony — io no mahatonga ny "mifanatrika" mateti-piverina.
      const ids = getPlayerIds(currentGame);
      const round1 = Number(currentGame.round_number ?? 1);
      // Rotation TSOTRA isaky ny tour: tour 1 → P1, tour 2 → P2, tour 3 → P3,
      // dia miverina amin'ny P1. Mitovy aminizay nataony ao amin'ny finishRound
      // sy finishBlocked mba tsy hisy mpilalao iray foana no lohavato.
      const openerId = roundOpenerId(currentGame, round1);
      const openerIdxInit = Math.max(0, ids.indexOf(openerId));
      const opener = { ...chooseOpening(hands, mode), playerIndex: openerIdxInit, forced: false };
      // DATINANDRO nesorina — tsy fandresena intsony.
      let board: Placed[] = [];
      let nextId = openerId;
      if (opener.forced) {
        // Remove forced opening tile from opener's hand and place on board
        const openerHand = hands[opener.playerIndex].filter(
          (t) => !(t[0] === opener.tile[0] && t[1] === opener.tile[1]),
        );
        hands[opener.playerIndex] = openerHand;
        board = [{ tile: opener.tile, flipped: false }];
        nextId = nextTurnId(currentGame, openerId);
      }
      // If not forced (hand mode or no qualifying double), opener keeps full hand
      // and plays any tile of their choice on an empty board.
      const { error } = await updateGameState({
        player1_hand: hands[0],
        player2_hand: hands[1],
        player3_hand: pc === 3 ? hands[2] : undefined,
        boneyard,
        board_state: board,
        current_turn: nextId,
        turn_started_at: new Date().toISOString(),
      });
      if (error) {
        throw error;
      }
      const _ = openerId;
    } catch (error: any) {
      toast.error(error?.message ?? "Tsy tafapetraka ny vaton'ny lalao", { duration: 500 });
    } finally {
      initLockRef.current = false;
    }
  };

  const updateGameState = async (payload: {
    board_state?: Placed[];
    player1_hand?: Tile[];
    player2_hand?: Tile[];
    player3_hand?: Tile[];
    boneyard?: Tile[];
    current_turn?: string;
    turn_started_at?: string;
    passes?: number;
    status?: "waiting" | "in_progress" | "finished" | "cancelled" | "blocked";
  }, options?: {
    expectedCurrentTurn?: string | null;
    expectedTurnStartedAt?: string | null;
  }) => {
    if (!game?.id) return { error: new Error("game_missing") };
    if (options?.expectedCurrentTurn || options?.expectedTurnStartedAt) {
      return (supabase.rpc as any)("player_update_game_state_guarded", {
        _game_id: game.id,
        _board_state: payload.board_state ?? null,
        _player1_hand: payload.player1_hand ?? null,
        _player2_hand: payload.player2_hand ?? null,
        _boneyard: payload.boneyard ?? null,
        _current_turn: payload.current_turn ?? null,
        _turn_started_at: payload.turn_started_at ?? null,
        _passes: payload.passes ?? null,
        _status: payload.status ?? null,
        _player3_hand: payload.player3_hand ?? null,
        _expected_current_turn: options.expectedCurrentTurn ?? null,
        _expected_turn_started_at: options.expectedTurnStartedAt ?? null,
      });
    }
    return supabase.rpc("player_update_game_state", {
      _game_id: game.id,
      _board_state: payload.board_state ?? null,
      _player1_hand: payload.player1_hand ?? null,
      _player2_hand: payload.player2_hand ?? null,
      _boneyard: payload.boneyard ?? null,
      _current_turn: payload.current_turn ?? null,
      _turn_started_at: payload.turn_started_at ?? null,
      _passes: payload.passes ?? null,
      _status: payload.status ?? null,
      _player3_hand: payload.player3_hand ?? null,
    });
  };

  // Mamarana tour iray. Raha tratra target / iala double-6 / mitovy daty -> resy daholo ny lalao.
  // Raha tsy izany dia atomboka tour vaovao (re-deal).
  const finishRound = async (
    winnerId: string,
    points: number,
    lastTile: Tile | null,
    reasonOverride?: string,
  ) => {
    if (!game) return;
    const key = `${game.id}-r${game.round_number ?? 1}-end`;
    if (roundEndLockRef.current === key) return;
    roundEndLockRef.current = key;

    // Vakio ny score MARINA avy any amin'ny serveur alohan'ny hanampiana
    // teboka, mba tsy hisy "score tsy mitombo" raha sendra mbola lany
    // ny state optimistic na tara ny realtime.
    let liveGame: any = game;
    try {
      const { data: fresh } = await supabase
        .from("games")
        .select("id, round_number, score_p1, score_p2, score_p3, player1_id, player2_id, player3_id, players_count, game_mode")
        .eq("id", game.id)
        .single();
      if (fresh) liveGame = { ...game, ...fresh };
    } catch {}

    const pc = Number(liveGame.players_count ?? 2);
    // LOCKED: Tsy misy intsony datinandro/double-6 ho fandresena. Ny target
    // ihany (D80 → 80, D120 → 120) no mandresy ny lalao.
    void lastTile; // tahirizina ho an'ny historique fotsiny
    const safePoints = Math.max(0, Number(points) || 0);
    const addTo = (uid: string, base: number) => Number(base ?? 0) + (winnerId === uid ? safePoints : 0);
    const newScoreP1 = addTo(liveGame.player1_id, liveGame.score_p1);
    const newScoreP2 = addTo(liveGame.player2_id, liveGame.score_p2);
    const newScoreP3 = pc === 3 ? addTo(liveGame.player3_id, liveGame.score_p3) : 0;
    const mode = (liveGame.game_mode ?? "d120") as GameMode;
    const target = getDominoTarget(mode);
    const wScore =
      winnerId === liveGame.player1_id ? newScoreP1 : winnerId === liveGame.player2_id ? newScoreP2 : newScoreP3;

    const targetReached = isDominoGameWin(wScore, mode);
    const soloThreshold = getDominoSoloThreshold(mode);
    const opponentScores = [
      winnerId === liveGame.player1_id ? null : liveGame.score_p1,
      winnerId === liveGame.player2_id ? null : liveGame.score_p2,
      pc === 3 && winnerId !== liveGame.player3_id ? liveGame.score_p3 : null,
    ].filter((score) => score !== null);
    const soloWin = isDominoSoloWin(wScore, mode, opponentScores);
    const doubleSixOut = isDominoDoubleSixOut(lastTile, points);
    const instantWin = targetReached || soloWin || doubleSixOut;

    // Build a human-readable "porofo" of how this round was won, for the replay banner.
    const winnerName = (profileNames[winnerId] ?? "Mpandresy");
    // Anaran'ny mpilalao resy (raha mpilalao 2)
    const loserIds = (pc === 3
      ? [game.player1_id, game.player2_id, game.player3_id]
      : [game.player1_id, game.player2_id]
    ).filter((id) => id && id !== winnerId);
    const loserName = loserIds.length === 1
      ? (profileNames[loserIds[0]!] ?? "Mpilalao")
      : loserIds.map((id) => profileNames[id!] ?? "Mpilalao").join(" sy ");
    // Lazaina mazava tsara ao anatin'ny historique ny ATONY mahatonga ny fandresena.
    // Anisan'ny sokajy "MANDRESY NY LALAO" ireto efatra ireto ihany:
    //   • TARGET (D120/D80) • SOLO (60/40 irery) • DOUBLE 6 • DATINANDRO.
    // Ny ambin'ireo (lany vato, blocage, +N isa) dia tour ihany.
    const reason = doubleSixOut && !targetReached && !soloWin
      ? `MANDRESY NY LALAO — DOUBLE 6 • ${winnerName} namarana ny tour tamin'ny [6|6]`
      : soloWin && !targetReached
      ? `MANDRESY NY LALAO — MANDEHA IRERY • ${winnerName} tonga ${wScore} (${soloThreshold}+)`
      : getDominoRoundReason({
          winnerName,
          mode,
          winnerScore: wScore,
          points,
          reasonOverride,
        });
    // `loserName` voatahiry ho an'ny famaharana hafa (raha tsy ampiasaina, tsy
    // mamotika ny build satria mety ho diso interpretation ny linter).
    void loserName;

    const REVEAL_MS = 5000;
    const revealUntil = new Date(Date.now() + REVEAL_MS).toISOString();
    setRoundBanner(
      pc === 3
        ? `${reason} • ${newScoreP1}-${newScoreP2}-${newScoreP3}`
        : `${reason} • ${newScoreP1} - ${newScoreP2}`,
    );
    setTimeout(() => setRoundBanner(null), REVEAL_MS + 500);
    const updatePayload: any = {
      score_p1: newScoreP1,
      score_p2: newScoreP2,
      reveal_until: revealUntil,
      last_reason: reason,
      // Vonoy ny tour mandritra ny reveal mba tsy hisy fihetsika afaka atao
      // alohan'ny hidiran'ny tour manaraka.
      current_turn: null,
      turn_started_at: null,
      passes: 0,
    };
    if (pc === 3) updatePayload.score_p3 = newScoreP3;
    // Raha mandeha irery: terena mitovy amin'ny target ny score-n'ny mpandresy
    // mba ho rakitry ny historique fa lalao vita.
    if ((soloWin || doubleSixOut) && !targetReached) {
      const slot = winnerId === game.player1_id ? 1 : winnerId === game.player2_id ? 2 : 3;
      updatePayload[`score_p${slot}`] = target;
    }
    await supabase.from("games").update(updatePayload).eq("id", game.id);
    setOptimistic(null);

    setTimeout(async () => {
      if (instantWin) {
        // Aorian'ny reveal fohy dia avela hanidy sy handoa vola ny backend.
        await supabase.rpc("settle_game", { _game_id: game.id, _winner: winnerId });
        return;
      }
      const nextRound = (game.round_number ?? 1) + 1;
      const seed = `${game.ticket_number || game.id}-r${nextRound}`;
      let h1: Tile[], h2: Tile[], h3: Tile[] = [], boneyard: Tile[];
      if (pc === 3) {
        const d = deal3(seed); h1 = d.p1; h2 = d.p2; h3 = d.p3; boneyard = d.boneyard;
      } else {
        const d = deal(seed); h1 = d.p1; h2 = d.p2; boneyard = d.boneyard;
      }
      // LOCKED: tsy misy "instant win" mandritra ny re-deal — target ihany.
      // Tour 2+: tsy misy double terena, ny topon'ny tour no mametraka izay tiany.
      // Mihodina automatique makany ANKAVIA isaky ny tour.
      const ids = pc === 3 ? [game.player1_id, game.player2_id, game.player3_id] : [game.player1_id, game.player2_id];
      const hands = pc === 3 ? [h1, h2, h3] : [h1, h2];
      const nextId = roundOpenerId(game, nextRound);
      // DATINANDRO nesorina — tsy fandresena intsony.
      const updateNext: any = {
        round_number: nextRound,
        player1_hand: hands[0],
        player2_hand: hands[1],
        boneyard,
        board_state: [],
        current_turn: nextId,
        turn_started_at: new Date().toISOString(),
        passes: 0,
        reveal_until: null,
      };
      if (pc === 3) updateNext.player3_hand = hands[2];
      await supabase.from("games").update(updateNext).eq("id", game.id);
    }, REVEAL_MS);
  };

  // Bloqué (samy tsy afaka mihetsika): kely vato indrindra mahazo ny diferansa
  const finishBlocked = async () => {
    if (!game) return;
    const pc = Number(game.players_count ?? 2);
    const p1H = (game.player1_hand as Tile[]) ?? [];
    const p2H = (game.player2_hand as Tile[]) ?? [];
    const p3H = (game.player3_hand as Tile[]) ?? [];
    const p1Pips = pipsTotal(p1H);
    const p2Pips = pipsTotal(p2H);
    const p3Pips = pc === 3 ? pipsTotal(p3H) : Infinity;
    const totals = pc === 3
      ? [{ id: game.player1_id, p: p1Pips }, { id: game.player2_id, p: p2Pips }, { id: game.player3_id, p: p3Pips }]
      : [{ id: game.player1_id, p: p1Pips }, { id: game.player2_id, p: p2Pips }];
    totals.sort((a, b) => a.p - b.p);
    const tied = totals[0].p === totals[1].p;
    if (tied) {
      // Mitovy: tsy misy point, alefa tour vaovao
      const nextRound = (game.round_number ?? 1) + 1;
      const seed = `${game.ticket_number || game.id}-r${nextRound}`;
      const mode = (game.game_mode ?? "d120") as GameMode;
      let h1: Tile[], h2: Tile[], h3: Tile[] = [], boneyard: Tile[];
      if (pc === 3) {
        const d = deal3(seed); h1 = d.p1; h2 = d.p2; h3 = d.p3; boneyard = d.boneyard;
      } else {
        const d = deal(seed); h1 = d.p1; h2 = d.p2; boneyard = d.boneyard;
      }
      const idsTied = pc === 3
        ? [game.player1_id, game.player2_id, game.player3_id]
        : [game.player1_id, game.player2_id];
      // LOCKED: tsy misy "instant win" — target ihany ny fandresena.
      const ids = idsTied;
      const hands = pc === 3 ? [h1, h2, h3] : [h1, h2];
      const nextId = roundOpenerId(game, nextRound);
      setRoundBanner(`Mitovy vato — tour vaovao`);
      setTimeout(() => setRoundBanner(null), 3500);
      // DATINANDRO nesorina — tsy fandresena intsony.
      const updateNext: any = {
        round_number: nextRound,
        player1_hand: hands[0],
        player2_hand: hands[1],
        boneyard,
        board_state: [],
        current_turn: nextId,
        turn_started_at: new Date().toISOString(),
        passes: 0,
      };
      if (pc === 3) updateNext.player3_hand = hands[2];
      await supabase.from("games").update(updateNext).eq("id", game.id);
      return;
    }
    const winnerId = totals[0].id;
    const sumOthers = totals.slice(1).reduce((s, x) => s + x.p, 0);
    const points = sumOthers - totals[0].p;
    const winnerName = (profileNames[winnerId] ?? "Mpandresy");
    const loserIds = totals.slice(1).map((x) => x.id);
    const loserName = loserIds
      .map((id) => profileNames[id] ?? "Mpilalao")
      .join(" sy ");
    await finishRound(
      winnerId,
      points,
      null,
      `Blocage: ${winnerName} nahazo +${points} isa (vato kely indrindra)`,
    );
  };

  // Hipoitra ny banniere TICKET Nº...ACCEPTÉ raha vao tafapetraka ny ticket
  useEffect(() => {
    if (game?.ticket_number) {
      setTicketBanner(game.ticket_number);
      const t = setTimeout(() => setTicketBanner(null), 4000);
      return () => clearTimeout(t);
    }
  }, [game?.ticket_number]);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const { data } = await supabase.from("games").select("*").eq("id", id).single();
      setServerGame(data);
    };
    load();
    const ch = supabase.channel("game-" + id)
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${id}` },
        (p: any) => setServerGame((prev: any) => {
          if (!p.new) return prev;
          if (!prev) return p.new;
          const a = new Date(prev.updated_at ?? 0).getTime();
          const b = new Date(p.new.updated_at ?? 0).getTime();
          return b >= a ? p.new : prev;
        }))
      .subscribe();
    // Polling fallback (1.5s) — raha sendra tara ny realtime, mba hifohazan'ny tour avy hatrany
    const poll = setInterval(async () => {
      const { data } = await supabase.from("games").select("*").eq("id", id).single();
      if (data) setServerGame((prev: any) => {
        if (!prev) return data;
        const a = new Date(prev.updated_at ?? 0).getTime();
        const b = new Date(data.updated_at ?? 0).getTime();
        return b >= a ? data : prev;
      });
    }, 1500);
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [id]);

  useEffect(() => {
    if (!game || !user || !id) return;
    const abandonedGameId = getAbandonedGameId();
    if (
      abandonedGameId === id &&
      game.status === "finished" &&
      game.winner_id &&
      game.winner_id !== user.id
    ) {
      nav("/lobby", { replace: true });
    }
  }, [game, user, id, nav]);

  // Tic-tac timer 1s
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Background tick worker — mampandeha ny timer na dia minimize/tab hafa aza
  // mba hahafahan'ny bot miasa tsara rehefa active.
  useEffect(() => {
    if (!game || game.status !== "in_progress") return;
    const workerCode = `
      let id = setInterval(() => self.postMessage("tick"), 1000);
      self.onmessage = (e) => { if (e.data === "stop") { clearInterval(id); self.postMessage("stopped"); } };
    `;
    const blob = new Blob([workerCode], { type: "application/javascript" });
    const worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = (e) => { if (e.data === "tick") setNow(Date.now()); };
    return () => {
      worker.postMessage("stop");
      setTimeout(() => worker.terminate(), 100);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.status, game?.id]);

  // Wake Lock — tsy avela matory ny ecran rehefa active ny bot, ka ny JS
  // timer mbola mandeha tsara na dia tsy mihetsika ny finday aza.
  useEffect(() => {
    if (!game || game.status !== "in_progress") return;
    if (!botActive) return;
    let lock: any = null;
    const acquire = async () => {
      try {
        if ("wakeLock" in navigator && !lock) {
          lock = await (navigator as any).wakeLock.request("screen");
        }
      } catch {}
    };
    acquire();
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !lock) acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (lock?.release) lock.release().catch(() => {});
    };
  }, [botActive, game?.status, game?.id]);

  useEffect(() => {
    const syncNow = () => setNow(Date.now());
    document.addEventListener("visibilitychange", syncNow);
    window.addEventListener("focus", syncNow);
    return () => {
      document.removeEventListener("visibilitychange", syncNow);
      window.removeEventListener("focus", syncNow);
    };
  }, []);

  useEffect(() => {
    if (!id || !game || game.status !== "in_progress") return;
    const markAbandoned = () => {
      if (document.visibilityState === "hidden") {
        sessionStorage.setItem(ABANDONED_GAME_KEY, id);
      }
    };
    document.addEventListener("visibilitychange", markAbandoned);
    return () => document.removeEventListener("visibilitychange", markAbandoned);
  }, [id, game?.status]);

  useEffect(() => {
    if (!id || !game) return;
    if (game.status === "finished" || game.status === "cancelled" || game.status === "blocked") {
      const stored = getAbandonedGameId();
      if (stored === id) sessionStorage.removeItem(ABANDONED_GAME_KEY);
    }
  }, [game?.status, id]);

  // LOCKED: tsy misy intsony "endgame vote" ao amin'ny Domino.
  // Raha tratra ny target dia vita avy hatrany ny lalao.

  // Mamboatra ny lalao raha vao nivadika ho in_progress saingy mbola tsy nizara piesy
  useEffect(() => {
    if (!game || !user) return;
    if (game.status !== "in_progress") return;
    const board = (game.board_state as Placed[]) ?? [];
    const p1 = (game.player1_hand as Tile[]) ?? [];
    const p2 = (game.player2_hand as Tile[]) ?? [];
    const p3 = (game.player3_hand as Tile[]) ?? [];
    const pc = Number(game.players_count ?? 2);
    const ready = pc === 3 ? !!game.player3_id : !!game.player2_id;
    if (board.length === 0 && p1.length === 0 && p2.length === 0 && p3.length === 0 && ready) {
      initializeGameHands(game);
    }
  }, [game, user]);

  // Anaran'ny mpilalao
  useEffect(() => {
    if (!game) return;
    const ids = getPlayerIds(game);
    if (!ids.length) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, mvola_name, selfie_url, avatar_url")
        .in("user_id", ids);
      const m: Record<string, string> = {};
      const ph: Record<string, string | null> = {};
      (data ?? []).forEach((p: any) => {
        m[p.user_id] = p.mvola_name ?? "Mpilalao";
        ph[p.user_id] = p.selfie_url ?? p.avatar_url ?? null;
      });
      setProfileNames(m);
      setProfilePhotos(ph);
    })();
  }, [game?.player1_id, game?.player2_id, game?.player3_id]);

  // Solde ny mpilalao mijery (tsy hita amin'ny adversaire).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const fetchBal = async () => {
      const { data } = await supabase
        .from("wallets")
        .select("balance")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) setMyBalance(Number(data?.balance ?? 0));
    };
    fetchBal();
    const ch = supabase
      .channel(`wallet-me-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${user.id}` },
        (payload: any) => {
          const bal = Number((payload.new ?? payload.old)?.balance ?? 0);
          setMyBalance(bal);
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  const myHand: Tile[] = useMemo(() => {
    if (!game || !user) return [];
    const k = getHandKey(game, user.id);
    return (k ? (game[k] as Tile[]) : []) ?? [];
  }, [game, user]);

  // Liste of opponents (1 or 2)
  const opponents: { id: string; name: string; hand: Tile[]; count: number }[] = useMemo(() => {
    if (!game || !user) return [];
    const ids = getPlayerIds(game);
    return ids.filter((id) => id !== user.id).map((id) => {
      const k = getHandKey(game, id) as any;
      const h = (game[k] as Tile[]) ?? [];
      return { id, name: profileNames[id] ?? "Mpilalao", hand: h, count: h.length };
    });
  }, [game, user, profileNames]);

  const myName = profileNames[user?.id ?? ""] ?? "Izaho";
  const myHandKey = getHandKey(game, user?.id ?? "") ?? "player1_hand";
  const oppHandCount = opponents.reduce((s, o) => s + o.count, 0);
  const oppHand: Tile[] = useMemo(() => {
    return opponents.flatMap((o) => o.hand);
  }, [opponents]);
  const isP1Helper = useMemo(() => {
    return game ? game.player1_id === user?.id : false;
  }, [game, user]);

  const board: Placed[] = (game?.board_state as Placed[]) ?? [];
  const isMyTurn = game?.current_turn === user?.id && game?.status === "in_progress";
  const revealUntilMs = game?.reveal_until ? new Date(game.reveal_until).getTime() : 0;
  const isRevealing = revealUntilMs > now;
  // Hita ny vato sisa: mandritra ny reveal_until ARY mandritra ny "résumé"
  // persistent (tour vita / lalao vita), mba ho mazava tsara ho an'ny mpilalao
  // ny vato sisa nataon'ny mpifaninana — fa tsy manjavona aorian'ny 6s.
  const showOppHands = isRevealing || (
    game?.status === "in_progress" &&
    !game?.current_turn &&
    !!(game as any)?.last_reason
  );

  // Faharetan'ny Tour
  const turnStart = game?.turn_started_at ? new Date(game.turn_started_at).getTime() : 0;
  // Raha mbola tsy voarakitra ny turn_started_at (anelanelan'ny tour, reveal,
  // sns.) dia ataovy 0 ny elapsed mba tsy hipoaka ho azy ny auto-play.
  const turnKeyNow = game ? `${game.id}-${game.turn_started_at}-${game.current_turn}` : "";
  if (turnKeyNow && turnAnchorRef.current.key !== turnKeyNow) {
    turnAnchorRef.current = { key: turnKeyNow, at: Date.now() };
  }
  const serverElapsed = turnStart > 0 ? Math.max(0, Math.floor((now - turnStart) / 1000)) : 0;
  const localElapsed = turnStart > 0
    ? Math.max(0, Math.floor((now - turnAnchorRef.current.at) / 1000))
    : 0;
  // Ny kely indrindra no raisina: tsy maintsy lany 15s HITA teto an-toerana vao
  // mandeha automatique — na inona na inona fahasamihafan'ny ora server.
  const elapsed = Math.min(serverElapsed, localElapsed);
  const remaining = turnStart > 0 ? Math.max(0, TURN_TIMEOUT_SEC - elapsed) : TURN_TIMEOUT_SEC;

  // 5s no sisa → vibration amin'ny findain'ny TOMPO-N-TOUR ihany.
  useEffect(() => {
    if (!game || !user || game.status !== "in_progress" || !game.current_turn) return;
    if (game.current_turn !== user.id) return;
    if (remaining !== 5) return;
    const key = `${game.id}-${game.turn_started_at}-${game.current_turn}`;
    if (warnedRef.current === key) return;
    warnedRef.current = key;
    // Tsy misy feo intsony — vibration matanjaka ihany
    try { (navigator as any).vibrate?.([180, 80, 180, 80, 240]); } catch {}
  }, [remaining, game?.id, game?.turn_started_at, game?.current_turn, game?.status, user?.id]);

  const tryPlay = async (idx: number, side?: "left" | "right") => {
    if (!isMyTurn || !game || !user) return;
    const tile = myHand[idx];
    const possible = canPlace(board, tile);
    if (!possible) return;
    let chosenSide: "left" | "right" = side ?? (possible === "either" ? "right" : possible);
    if (possible !== "either" && side && side !== possible) {
      return;
    }
    const expectedCurrentTurn = game.current_turn ?? null;
    const expectedTurnStartedAt = game.turn_started_at ?? null;
    const startedAt = new Date().toISOString();
    const newBoard = place(board, tile, chosenSide);
    const newHand = myHand.filter((_, i) => i !== idx);
    sfx.move();
    // Mihodina FOANA avy amin'ny current_turn marina mankany ANKAVIA — tsy
    // miankina amin'ny user.id (mba tsy hisy "skip" raha misy stale state).
    const oppId = nextTurnId(game, game.current_turn ?? user.id);
    const handKey = getHandKey(game, user.id) as "player1_hand" | "player2_hand" | "player3_hand";
    const remainingOthers: Tile[] = opponents.flatMap((o) => o.hand);
    setOptimistic({
      ...game,
      board_state: newBoard,
      [handKey]: newHand,
      current_turn: newHand.length === 0 ? game.current_turn : oppId,
      turn_started_at: startedAt,
      passes: 0,
      updated_at: new Date().toISOString(),
    });
    setSelected(null);

    if (newHand.length === 0) {
      const { error } = await updateGameState({
        board_state: newBoard,
        [handKey]: newHand,
      } as any, {
        expectedCurrentTurn,
        expectedTurnStartedAt,
      });
      if (error) {
        setOptimistic(null);
        return;
      }
      await supabase.from("game_moves").insert({
        game_id: game.id,
        player_id: user.id,
        piece: { tile, flipped: chosenSide === "left" ? tile[1] !== (ends(board)?.left ?? tile[1]) : tile[0] !== (ends(board)?.right ?? tile[0]) },
        side: chosenSide,
      });
      const points = newHand.length === 0 ? pipsTotal(remainingOthers) : 0;
      await finishRound(user.id, points, tile);
      return;
    }
    const { error } = await updateGameState({
      board_state: newBoard,
      [handKey]: newHand,
      current_turn: oppId,
      turn_started_at: startedAt,
      passes: 0,
    } as any, {
      expectedCurrentTurn,
      expectedTurnStartedAt,
    });
    if (error) {
      setOptimistic(null);
      return;
    }
    await supabase.from("game_moves").insert({
      game_id: game.id,
      player_id: user.id,
      piece: { tile, flipped: chosenSide === "left" ? tile[1] !== (ends(board)?.left ?? tile[1]) : tile[0] !== (ends(board)?.right ?? tile[0]) },
      side: chosenSide,
    });
  };

  const handleTileTap = (idx: number) => {
    if (!isMyTurn) return;
    const tile = myHand[idx];
    const possible = canPlace(board, tile);
    if (!possible) return;
    if (possible === "either" && board.length > 0) {
      const e2 = ends(board);
      // Raha mitovy ny tendro roa, tsy ilaina mifidy lafiny — apetraka avy hatrany.
      if (e2 && e2.left === e2.right) {
        setSelected(null);
        void tryPlay(idx, "right");
        return;
      }
      setSelected(idx);
      return;
    }
    setSelected(null);
    void tryPlay(idx, possible === "left" || possible === "right" ? possible : undefined);
  };

  const clearLongPress = () => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const reorderHand = async (fromIdx: number, toIdx: number) => {
    if (!game || fromIdx === toIdx) return;
    const nextHand = [...myHand];
    const [moved] = nextHand.splice(fromIdx, 1);
    nextHand.splice(toIdx, 0, moved);
    setOptimistic({
      ...game,
      [myHandKey]: nextHand,
      updated_at: new Date().toISOString(),
    });
    await updateGameState({ [myHandKey]: nextHand } as any);
  };

  const handleHandPointerDown = (idx: number, e: React.PointerEvent<HTMLButtonElement>) => {
    pointerTileIndexRef.current = idx;
    longPressTriggeredRef.current = false;
    pressStartXRef.current = e.clientX;
    pressStartYRef.current = e.clientY;
    // Avela handeha amin'ny element hafa ny pointer events (raha tsy izany dia
    // ny button niandohany ihany no mahazo events, ka tsy mahafantatra ny
    // toerana hilatsahan'ny vato).
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch {}
    clearLongPress();
    longPressRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      setSelected(null);
      setDragIndex(idx);
    }, 420);
  };

  const handleHandPointerMove = (_idx: number, e: React.PointerEvent<HTMLButtonElement>) => {
    const dx = Math.abs(e.clientX - pressStartXRef.current);
    const dy = Math.abs(e.clientY - pressStartYRef.current);
    if (!longPressTriggeredRef.current && (dx > 8 || dy > 8)) {
      clearLongPress();
    }
    if (longPressTriggeredRef.current) {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const target = el?.closest?.("[data-hand-index]") as HTMLElement | null;
      if (target) {
        const idx = Number(target.getAttribute("data-hand-index"));
        if (!Number.isNaN(idx)) setDragIndex(idx);
      }
    }
  };

  const handleHandPointerEnter = (idx: number) => {
    if (longPressTriggeredRef.current) {
      setDragIndex(idx);
    }
  };

  const handleHandPointerUp = async (idx: number) => {
    clearLongPress();
    const startIdx = pointerTileIndexRef.current;
    pointerTileIndexRef.current = null;
    if (longPressTriggeredRef.current && startIdx !== null) {
      const dropIdx = dragIndex ?? idx;
      longPressTriggeredRef.current = false;
      setDragIndex(null);
      if (startIdx !== dropIdx) {
        // Tena nisy famindrana toerana → aza alefa ny click.
        suppressClickRef.current = true;
        await reorderHand(startIdx, dropIdx);
      }
      // Raha tsy nisy famindrana (notazonina fotsiny teo amin'ny toerany),
      // avela handeha ny click mba ho voapetraka ihany ny vato.
      return;
    }
    longPressTriggeredRef.current = false;
    setDragIndex(null);
  };

  const handleHandPointerLeave = () => {
    clearLongPress();
  };

  const passTurn = async () => {
    if (!isMyTurn || !game || !user) return;
    if (myHand.length === 0 || hasMove(myHand, board)) return;
    const expectedCurrentTurn = game.current_turn ?? null;
    const expectedTurnStartedAt = game.turn_started_at ?? null;
    const oppId = nextTurnId(game, game.current_turn ?? user.id);
    const pc = Number(game.players_count ?? 2);
    const passes = (game.passes ?? 0) + 1;
    if (passes >= pc) {
      await finishBlocked();
      return;
    }
    const { error } = await updateGameState({
      current_turn: oppId,
      turn_started_at: new Date().toISOString(),
      passes,
    }, {
      expectedCurrentTurn,
      expectedTurnStartedAt,
    });
    if (error) return;
  };

  // Auto-action / Bot — rehefa lany ny 15s, mandeha ho azy ny lalao
  useEffect(() => {
    if (!game || !user) return;
    if (game.status !== "in_progress") return;
    if (!game.current_turn) return;
    if (!game.turn_started_at) return;
    if (isRevealing) return;
    // Aloha ny 15s: TSY MISY auto mihitsy — miandry ny kitika.
    // Anti-skip: ny client an'ny tompon'ny tour IHANY no manao auto. Raha mivoaka izy,
    // ny backend watchdog no milalao/passa légal aorian'ny deadline.
    const isMyTurnHere = game.current_turn === user.id;
    if (!isMyTurnHere) return;
    const botFastPath = botActive;
    // Raha activé ny Bot eo amin'ny compte-ko ARY ahy ilay tour: tsy miandry 15s.
    if (!botFastPath && elapsed < TURN_TIMEOUT_SEC) return;
    const key = `${game.id}-${game.turn_started_at}-${game.current_turn}`;
    if (autoActedRef.current === key) return;
    autoActedRef.current = key;

    (async () => {
      const { data: fresh, error } = await supabase.from("games").select("*").eq("id", game.id).single();
      if (error || !fresh) throw error ?? new Error("game_refresh_failed");
      if (fresh.status !== "in_progress") return;
      const freshStartedAt = fresh.turn_started_at ? new Date(fresh.turn_started_at).getTime() : 0;
      const expectedStartedAt = game.turn_started_at ? new Date(game.turn_started_at).getTime() : 0;
      if (!fresh.current_turn || freshStartedAt !== expectedStartedAt) {
        autoActedRef.current = null;
        return;
      }
      if (!botActive) {
        const freshKey = `${fresh.id}-${fresh.turn_started_at}-${fresh.current_turn}`;
        const localAnchor = turnAnchorRef.current.key === freshKey ? turnAnchorRef.current.at : Date.now();
        const freshElapsedMs = Math.min(
          Math.max(0, Date.now() - freshStartedAt),
          Math.max(0, Date.now() - localAnchor),
        );
        if (freshElapsedMs < TURN_TIMEOUT_SEC * 1000) {
          autoActedRef.current = null;
          return;
        }
      }

      const liveBoard: Placed[] = (fresh.board_state as Placed[]) ?? [];
      const turnId = fresh.current_turn as string;
      const turnKey = getHandKey(fresh, turnId) as "player1_hand" | "player2_hand" | "player3_hand" | null;
      if (!turnKey) {
        autoActedRef.current = null;
        return;
      }
      const turnHand: Tile[] = ((fresh[turnKey] as Tile[]) ?? []) as Tile[];
      const oppId = nextTurnId(fresh, turnId);
      const pc = Number(fresh.players_count ?? 2);

      const oppSizes = getPlayerIds(fresh)
        .filter((id) => id !== turnId)
        .map((id) => {
          const k = getHandKey(fresh, id);
          return k ? ((fresh[k] as Tile[]) ?? []).length : 7;
        });
      const boneyardSize = ((fresh.boneyard as Tile[]) ?? []).length;
      const best = chooseBestBotMove(turnHand, liveBoard, { opponentSizes: oppSizes, boneyardSize });
      if (best) {
        const { index: playableIdx, side: chosenSide } = best;
        const tile = turnHand[playableIdx];
        const newBoard = place(liveBoard, tile, chosenSide);
        const newHand = turnHand.filter((_, i) => i !== playableIdx);
        if (newHand.length === 0) {
          const { error: updateError } = await updateGameState({
            board_state: newBoard,
            [turnKey]: newHand,
          } as any, {
            expectedCurrentTurn: turnId,
            expectedTurnStartedAt: fresh.turn_started_at,
          });
          if (updateError) {
            autoActedRef.current = null;
            return;
          }
          const { error: moveLogError } = await supabase.from("game_moves").insert({
            game_id: game.id,
            player_id: turnId,
            piece: { tile, auto: true },
            side: chosenSide,
          });
          if (moveLogError) {
            console.warn("auto move log failed", moveLogError);
          }
          const otherIds = getPlayerIds(fresh).filter((x) => x !== turnId);
          const otherTiles: Tile[] = otherIds.flatMap((id) => {
            const k = getHandKey(fresh, id) as any;
            return (fresh[k] as Tile[]) ?? [];
          });
          await finishRound(turnId, newHand.length === 0 ? pipsTotal(otherTiles) : 0, tile);
          return;
        }
        const startedAt = new Date().toISOString();
        const { error: updateError } = await updateGameState({
          board_state: newBoard,
          [turnKey]: newHand,
          current_turn: oppId,
          turn_started_at: startedAt,
          passes: 0,
        } as any, {
          expectedCurrentTurn: turnId,
          expectedTurnStartedAt: fresh.turn_started_at,
        });
        if (updateError) {
          autoActedRef.current = null;
          return;
        }
      const { error: moveLogError } = await supabase.from("game_moves").insert({
        game_id: game.id,
        player_id: turnId,
        piece: { tile, auto: true },
        side: chosenSide,
      });
      if (moveLogError) {
        console.warn("auto move log failed", moveLogError);
      }
        return;
      }
      if (hasMove(turnHand, liveBoard)) {
        // Protection anti-skip: raha mbola misy vato azo apetraka, tsy azo
        // ampandalovina mihitsy ilay mpilalao. Ny backend koa manamarina an'io.
        autoActedRef.current = null;
        return;
      }
      const passes = (fresh.passes ?? 0) + 1;
      if (passes >= pc) {
        await finishBlocked();
        return;
      }
      const { error: passError } = await updateGameState({
        current_turn: oppId,
        turn_started_at: new Date().toISOString(),
        passes,
      }, {
        expectedCurrentTurn: turnId,
        expectedTurnStartedAt: fresh.turn_started_at,
      });
      if (passError) autoActedRef.current = null;
    })().catch(() => {
      autoActedRef.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, game?.turn_started_at, game?.status, game?.current_turn, botActive, user?.id]);

  // Tena AZO ANTOKA fa hipoaka rehefa tapitra ny 15s — mametraka setTimeout
  // mifototra mivantana amin'i `turn_started_at`. Mandeha na dia "throttled"
  // aza ny setInterval(now) rehefa background ny tab.
  useEffect(() => {
    if (!game || !user) return;
    if (game.status !== "in_progress") return;
    if (!game.current_turn || !game.turn_started_at) return;
    if (isRevealing) return;
    if (game.current_turn !== user.id) return;
    // Mifototra amin'ny fantsona LOCAL (tsy ny ora server) mba tsy hipoaka mialoha.
    const startMs = Math.max(new Date(game.turn_started_at).getTime(), turnAnchorRef.current.at);
    const deadline = startMs + TURN_TIMEOUT_SEC * 1000;
    const delay = Math.max(0, deadline - Date.now()) + 50; // mafonja kely
    const t = setTimeout(() => {
      // Bump `now` so the existing elapsed-based effect re-runs and fires
      setNow(Date.now());
    }, delay);
    return () => clearTimeout(t);
  }, [game?.turn_started_at, game?.current_turn, game?.status, isRevealing, game?.id, user?.id]);

  // Nudge backend watchdog rehefa mahita 0s ny client rehetra. Tsy milalao ho
  // solon'ny adversaire ny client; manaitra fotsiny ilay serveur izay manana
  // guard anti-skip sy legal-move. Raha maty daholo ny finday, cron 1s no mitohy.
  useEffect(() => {
    if (!game || game.status !== "in_progress") return;
    if (!game.current_turn || !game.turn_started_at) return;
    if (isRevealing || remaining > 0) return;
    const key = `${game.id}-${game.turn_started_at}-${game.current_turn}`;
    if (watchdogNudgeRef.current === key) return;
    watchdogNudgeRef.current = key;
    supabase.functions.invoke("domino-autoplay", { body: { game_id: game.id } }).catch(() => {
      watchdogNudgeRef.current = null;
    });
  }, [remaining, game?.id, game?.turn_started_at, game?.current_turn, game?.status, isRevealing]);

  // SAFETY NET — Raha tafita ny target ny mpilalao iray nefa mihantona
  // ny lalao (current_turn=null, reveal_until lasa) noho ny mpilalao
  // niala mialoha, ny mpilalao rehetra mbola mijery ny écran dia
  // miantso settle_game (idempotent eo amin'ny backend).
  useEffect(() => {
    if (!game || !user) return;
    if (game.status !== "in_progress") return;
    if (game.current_turn) return;
    if (!game.reveal_until) return;
    if (new Date(game.reveal_until).getTime() > now) return;
    const mode = (game.game_mode ?? "d120") as GameMode;
    const pc = Number(game.players_count ?? 2);
    const candidates: Array<{ id: string | null; score: number }> = [
      { id: game.player1_id, score: Number(game.score_p1 ?? 0) },
      { id: game.player2_id, score: Number(game.score_p2 ?? 0) },
      ...(pc === 3 ? [{ id: game.player3_id, score: Number(game.score_p3 ?? 0) }] : []),
    ];
    const winner = candidates
      .filter((c) => c.id && isDominoGameWin(c.score, mode))
      .sort((a, b) => b.score - a.score)[0];
    if (!winner?.id) return;
    const key = `safety-${game.id}-${winner.id}`;
    if (roundEndLockRef.current === key) return;
    roundEndLockRef.current = key;
    supabase.rpc("settle_game", { _game_id: game.id, _winner: winner.id });
  }, [game?.id, game?.status, game?.current_turn, game?.reveal_until, game?.score_p1, game?.score_p2, game?.score_p3, game?.game_mode, game?.players_count, now, user?.id]);

  useEffect(() => {
    if (selected === null) return;
    if (!isMyTurn || !myHand[selected]) {
      setSelected(null);
      return;
    }
    if (canPlace(board, myHand[selected]) !== "either") {
      setSelected(null);
    }
  }, [selected, isMyTurn, myHand, board]);

  if (!game) return <div className="min-h-screen felt-bg flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;

  const e = ends(board);
  const selectedPlacement = selected !== null && myHand[selected] ? canPlace(board, myHand[selected]) : null;
  const canLeft = selectedPlacement === "left" || selectedPlacement === "either";
  const canRight = selectedPlacement === "right" || selectedPlacement === "either";
  const noMove = isMyTurn && !hasMove(myHand, board);
  const gameMode = (game?.game_mode ?? "d120") as GameMode;
  const scoreOf = (uid: string): number => {
    if (!game) return 0;
    if (uid === game.player1_id) return Number(game.score_p1 ?? 0);
    if (uid === game.player2_id) return Number(game.score_p2 ?? 0);
    if (uid === game.player3_id) return Number(game.score_p3 ?? 0);
    return 0;
  };
  const myScore = scoreOf(user?.id ?? "");
  const targetPts = getDominoTarget(gameMode);
  const playersCount = Number(game?.players_count ?? 2);
  const abandonGame = async () => {
    if (!game || !user || isAbandoning) return;
    const oppId = game.player1_id === user.id ? game.player2_id : game.player1_id;
    if (!oppId) {
      // Mbola tsy nisy adversaire — annuler fotsiny
      await supabase.rpc("cancel_waiting_game", { _game_id: game.id });
      nav("/lobby", { replace: true });
      return;
    }

    setIsAbandoning(true);
    sessionStorage.setItem(ABANDONED_GAME_KEY, game.id);
    setOptimistic({
      ...game,
      status: "finished",
      winner_id: oppId,
      current_turn: null,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const { error } = await supabase.rpc("settle_game", { _game_id: game.id, _winner: oppId });
    if (error) {
      sessionStorage.removeItem(ABANDONED_GAME_KEY);
      setOptimistic(null);
      setIsAbandoning(false);
      return toast.error(error.message);
    }

    toast("Resy avy hatrany ianao noho ny abandonné");
    nav("/lobby", { replace: true });
  };

  // Sary kely kokoa amin'ny mobile mba tsy hifanaikitra
  const handTileSize = isMobile ? "md" : "lg";
  const boardTileSize = isMobile ? "sm" : "md";
  const firstBoardTile = board.length === 1 ? board[0] : null;
  const firstBoardA = firstBoardTile ? (firstBoardTile.flipped ? firstBoardTile.tile[1] : firstBoardTile.tile[0]) : null;
  const firstBoardB = firstBoardTile ? (firstBoardTile.flipped ? firstBoardTile.tile[0] : firstBoardTile.tile[1]) : null;
  const turnOrderLabel = getPlayerIds(game)
    .map((pid) => pid === user?.id ? myName : (profileNames[pid] ?? "Mpilalao"))
    .join(" → ");

  return (
    <div
      className="min-h-screen domino-scene-bg flex flex-col"
      style={{ backgroundImage: `url(${dominoSceneBg})` }}
    >
      {/* Permanent Bot toggle — bottom-left, always visible */}
      <button
        type="button"
        onClick={() => setBotActive((v) => !v)}
        className={`fixed bottom-36 left-2 z-50 px-2 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-normal border transition active:scale-95 ${
          botActive
            ? "bg-emerald-500 text-black border-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.75)]"
            : "bg-black/55 text-muted-foreground border-muted-foreground/40 backdrop-blur"
        }`}
        title="Raha activé: mandeha ho azy ny tour-nao tsy miandry 15s"
      >
        {botActive ? "🤖 ON" : "🤖 Bot"}
      </button>
      {ticketBanner && (
        <div className="fixed inset-x-0 top-0 z-50 bg-success text-success-foreground py-3 px-4 text-center font-bold shadow-lg animate-in slide-in-from-top">
          🎫 TICKET Nº{ticketBanner} ACCEPTÉ
        </div>
      )}
      {roundBanner && (
        <div className="fixed inset-x-0 top-0 z-50 bg-primary text-primary-foreground py-3 px-4 text-center font-bold shadow-lg animate-in slide-in-from-top">
          🏁 {roundBanner}
        </div>
      )}
      {(() => {
        // Overlay mazava ho an'ny tetezamita "tour vita → tour vaovao".
        const r: string = (game as any)?.last_reason ?? "";
        const ru = (game as any)?.reveal_until ? new Date((game as any).reveal_until).getTime() : 0;
        // Hiseho mandritra ny reveal ARY mijanona hatrany aorian'ny reveal
        // (résumé) raha mbola in_progress ny lalao sy mbola tsy nanomboka ny
        // tour manaraka (tsy misy current_turn).
        const persistent = !!r && game?.status === "in_progress" && !game?.current_turn;
        const active = persistent;
        if (!active) return null;
        const isGameWin = r.startsWith("MANDRESY NY LALAO");
        const revealing = ru > now;
        const sec = Math.max(1, Math.ceil((ru - now) / 1000));
        const pc = Number(game.players_count ?? 2);
        return (
          // Banderole kely eo ambony — tsy manakana ny vato an-tànana.
          <div className="fixed inset-x-0 top-12 z-[60] flex justify-center px-3 pointer-events-none animate-in fade-in slide-in-from-top">
            <div className="w-auto max-w-[92%] rounded-lg border-2 border-[#ffe27a] bg-[linear-gradient(180deg,#0d3b22,#0a2818)] px-3 py-1.5 text-center shadow-lg pointer-events-auto">
              <div className="flex items-center gap-2 justify-center flex-wrap">
                <span className="text-base leading-none">{isGameWin ? "🏆" : "🏁"}</span>
                <span className="text-[11px] font-extrabold text-[#ffe27a] tracking-wide">
                  {isGameWin ? "LALAO VITA" : "TOUR VITA"}
                </span>
                <span className="text-[11px] text-white font-semibold leading-tight">{r}</span>
                <span className="text-[11px] text-white font-bold">
                  {pc === 3
                    ? `${Number(game.score_p1 ?? 0)}—${Number(game.score_p2 ?? 0)}—${Number(game.score_p3 ?? 0)}`
                    : `${Number(game.score_p1 ?? 0)}—${Number(game.score_p2 ?? 0)}`}
                </span>
                {!isGameWin && revealing && (
                  <span className="text-[10px] text-[#ffe27a]/90 italic">• {sec}s</span>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {/* Header style "Rolland | Tour | Opponent" */}
      <header className="relative px-3 py-2 grid grid-cols-3 items-center gap-2 border-b-2 border-[#d4a52c]/60 bg-[linear-gradient(180deg,#0d3b22_0%,#0a2818_100%)] shadow-[inset_0_-2px_0_rgba(212,165,44,0.25)]">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-[#ffe27a] hover:bg-[#ffffff10]" onClick={() => nav("/lobby", { replace: true })}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          {profilePhotos[user?.id ?? ""] ? (
            <img
              src={profilePhotos[user?.id ?? ""] as string}
              alt={myName}
              onClick={() => setZoomedPhoto(profilePhotos[user?.id ?? ""] as string)}
              className="w-11 h-11 rounded-full object-cover border-2 border-[#ffe27a]/70 shadow cursor-pointer active:scale-95 transition"
            />
          ) : (
            <div className="w-11 h-11 rounded-full bg-[#ffe27a]/20 border-2 border-[#ffe27a]/70 flex items-center justify-center text-sm font-bold text-[#ffe27a]">
              {(myName?.[0] ?? "?").toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className={`truncate text-sm font-extrabold ${game.current_turn === user?.id ? "text-[#ffe27a]" : "text-white/90"}`}>
              {myName}
            </div>
            <div className="text-[10px] text-[#ffe27a]/70 truncate">
              Score {scoreOf(user?.id ?? "")}
              {targetPts ? <span className="opacity-60">/{targetPts}</span> : null}
            </div>
          </div>
        </div>
        <div className="text-center">
          <div className="font-display text-[11px] uppercase tracking-[0.2em] text-[#ffe27a]/80">Tour</div>
          <div className="font-display text-lg font-extrabold gold-text leading-none">
            {game.round_number ?? 1}
          </div>
          {game.status === "in_progress" && game.current_turn && turnStart > 0 && (
            <div className={`mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${remaining <= 5 ? "bg-destructive/30 text-white animate-pulse" : "bg-black/30 text-[#ffe27a]"}`}>
              <Clock className="w-3 h-3" /> {remaining}s
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 min-w-0">
          <div className="min-w-0 text-right">
            <div className={`truncate text-sm font-extrabold ${game.current_turn && opponents.some(o => o.id === game.current_turn) ? "text-[#ffe27a]" : "text-white/90"}`}>
              {opponents[0]?.name ?? "Opponent"}
            </div>
            <div className="text-[10px] text-[#ffe27a]/70 truncate">
              {opponents.length > 1
                ? opponents.map(o => `${scoreOf(o.id)}`).join(" · ")
                : `Score ${scoreOf(opponents[0]?.id ?? "")}`}
            </div>
          </div>
          {opponents[0] && (profilePhotos[opponents[0].id] ? (
            <img
              src={profilePhotos[opponents[0].id] as string}
              alt={opponents[0].name}
              onClick={() => setZoomedPhoto(profilePhotos[opponents[0].id] as string)}
              className="w-11 h-11 rounded-full object-cover border-2 border-[#ffe27a]/70 shadow cursor-pointer active:scale-95 transition"
            />
          ) : (
            <div className="w-11 h-11 rounded-full bg-[#ffe27a]/20 border-2 border-[#ffe27a]/70 flex items-center justify-center text-sm font-bold text-[#ffe27a]">
              {(opponents[0].name?.[0] ?? "?").toUpperCase()}
            </div>
          ))}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-[#ffe27a] hover:bg-[#ffffff10]" onClick={() => nav("/")}>
            <HomeIcon className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Tableau ny score — mazava sy ngeza */}
      {game.status === "in_progress" && (
          <div className="px-3 py-2 bg-[linear-gradient(180deg,#0a2818_0%,#072013_100%)] border-b-2 border-[#d4a52c]/60 shadow-[inset_0_-2px_0_rgba(212,165,44,0.25)]">
          <div className="max-w-md mx-auto">
            <div className="text-center text-[11px] uppercase tracking-[0.3em] text-[#ffe27a] mb-2 font-extrabold drop-shadow">
              SCORE {targetPts ? `(Tanjona ${targetPts})` : ""}
            </div>
            {turnOrderLabel && (
              <div className="-mt-1 mb-2 text-center text-[10px] font-bold text-emerald-200/90 truncate">
                ↻ {turnOrderLabel}
              </div>
            )}
            <div className={`grid ${playersCount === 3 ? "grid-cols-3" : "grid-cols-2"} gap-3`}>
              {getPlayerIds(game).map((pid) => {
                const isMe = pid === user?.id;
                const name = isMe ? myName : (profileNames[pid] ?? "Mpilalao");
                const sc = scoreOf(pid);
                const pct = targetPts ? Math.min(100, Math.round((sc / targetPts) * 100)) : 0;
                const isTurn = game.current_turn === pid;
                return (
                  <div
                    key={pid}
                    className={`rounded-xl px-2 py-1.5 border-2 ${isTurn ? "domino-turn-border bg-[linear-gradient(180deg,rgba(22,163,74,0.24),rgba(0,0,0,0.45))]" : "border-[#d4a52c]/40 bg-[linear-gradient(180deg,rgba(0,0,0,0.55),rgba(0,0,0,0.35))]"}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-extrabold text-white/95 truncate uppercase tracking-wide">{name}</span>
                      <span className="text-3xl font-black gold-text leading-none tabular-nums drop-shadow-[0_2px_6px_rgba(212,165,44,0.6)]">{sc}</span>
                    </div>
                    {targetPts && (
                      <div className="mt-1.5 h-2 bg-black/60 rounded-full overflow-hidden border border-[#d4a52c]/30">
                        <div className="h-full bg-gradient-to-r from-[#d4a52c] via-[#ffe27a] to-[#fff4b8] transition-all shadow-[0_0_8px_rgba(255,226,122,0.6)]" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {isMe && myBalance !== null && (
                      <div className="mt-1.5 flex items-center justify-between text-[10px] font-bold text-emerald-200/95 bg-black/40 rounded-md px-1.5 py-0.5 border border-emerald-500/40">
                        <span className="uppercase tracking-wider opacity-80">Solde</span>
                        <span className="tabular-nums">{fmtAr(myBalance)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {game.status === "in_progress" && (
        <button
          type="button"
          onClick={() => setConfirmAbandon(true)}
          disabled={isAbandoning}
          className="fixed top-2 right-2 z-30 w-8 h-8 rounded-full bg-destructive/75 text-destructive-foreground flex items-center justify-center shadow backdrop-blur active:scale-95 disabled:opacity-50"
          title="Hiala amin'ny lalao"
          aria-label="Hiala amin'ny lalao"
        >
          {isAbandoning ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
        </button>
      )}

      <AlertDialog open={confirmAbandon} onOpenChange={setConfirmAbandon}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>⚠️ Tena hiala amin'ny lalao tokoa?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block font-semibold text-destructive">
                Tandremo: raha hiala ianao izao dia:
              </span>
              <span className="block">• Ho <b>RESY avy hatrany</b> ianao</span>
              <span className="block">• <b>HO VERY ny vola napetrakao</b> rehetra (mise)</span>
              <span className="block">• Ny adversaire no handresy ka hahazo ny gain</span>
              <span className="block pt-1 text-xs italic">
                Mieritrereta tsara alohan'ny hanamafisana.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmAbandon(false); abandonGame(); }}
            >
              OK — Hiala ihany
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!zoomedPhoto} onOpenChange={(o) => !o && setZoomedPhoto(null)}>
        <DialogContent
          className="max-w-[92vw] sm:max-w-md p-0 bg-transparent border-0 shadow-none"
          onClick={() => setZoomedPhoto(null)}
        >
          {zoomedPhoto && (
            <img
              src={zoomedPhoto}
              alt="Profil"
              className="w-full h-auto rounded-xl object-contain animate-scale-in cursor-zoom-out border-4 border-[#ffe27a]/70 shadow-2xl"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* TSIMANANA banner nesorina — tsy mibahana intsony, indikatera kely fotsiny ao amin'ny tanana */}

      {game.status === "waiting" && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="card-felt rounded-2xl p-8 text-center max-w-sm">
            <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary mb-4" />
            <p className="font-display text-lg">Miandry adversaire...</p>
            <p className="text-sm text-muted-foreground mt-2">Ny adversaire afaka miditra avy ao amin'ny Lobby.</p>
            {game.player1_id === user?.id && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={async () => {
                  const { error } = await supabase.rpc("cancel_waiting_game", { _game_id: game.id });
                  if (error) return toast.error(error.message);
                  toast("Nesorina ny mise");
                  nav("/lobby");
                }}
              >
                Annuler ny mise
              </Button>
            )}
          </div>
        </div>
      )}

      {game.status === "in_progress" && (
        <>
          {/* Tanan'ny adversaire — split-screen raha 2 na 3 mpilalao adversaire */}
          <div className={`px-2 pt-2 pb-1 ${opponents.length >= 2 ? "grid grid-cols-2 gap-2" : "flex flex-col items-center"}`}>
            {opponents.map((o) => {
              const isTurn = game.current_turn === o.id;
              const initial = (o.name?.[0] ?? "?").toUpperCase();
              const photo = profilePhotos[o.id];
              return (
                <div
                  key={o.id}
                  className={`domino-hand-mat domino-hand-mat--opponent flex flex-col items-center gap-1 ${
                    isTurn ? "is-turn" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {photo ? (
                      <img
                        src={photo}
                        alt={o.name}
                        onClick={() => setZoomedPhoto(photo)}
                        className={`w-9 h-9 rounded-full object-cover border-2 cursor-pointer active:scale-95 transition ${isTurn ? "border-primary" : "border-primary/30"}`}
                      />
                    ) : (
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${isTurn ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                        {initial}
                      </div>
                    )}
                    <span className={`text-[11px] font-bold ${isTurn ? "gold-text" : "text-foreground/80"}`}>
                      {isTurn ? "▶ " : ""}{o.name}
                      <span className="text-muted-foreground"> ({o.count})</span>
                    </span>
                  </div>
                  {showOppHands && o.hand.length > 0 && (
                    <div className="text-[10px] font-extrabold text-[#ffe27a] uppercase tracking-wider">
                      Vato sisa
                    </div>
                  )}
                  <div
                    className={`flex justify-center flex-wrap gap-1 max-w-full ${
                      showOppHands
                        ? "p-2 rounded-lg bg-black border-2 border-[#ffe27a] shadow-[0_0_28px_-2px_rgba(255,226,122,0.95)] ring-2 ring-[#ffe27a]/60"
                        : ""
                    }`}
                  >
                    {showOppHands
                      ? o.hand.map((t, i) => (
                          <DominoTile
                            key={i}
                            a={t[0]}
                            b={t[1]}
                            size={isMobile ? "sm" : "md"}
                            horizontal={false}
                            variant="white"
                          />
                        ))
                      : Array.from({ length: o.count }).map((_, i) => (
                          <DominoBack key={i} size="xs" />
                        ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Latabatra — felt poker, snake path mihodina amin'ny sisiny */}
          <div className="domino-table-zone relative flex-1 px-1 sm:px-3 py-3 min-h-[340px]">
            {/* Floating side action buttons */}
            <RadioPlayer />
            {id && <GameChat gameId={id} names={profileNames} />}
            {id && game?.status === "in_progress" && (
              <div className="absolute left-1/2 -translate-x-1/2 -top-1 z-30">
                <LudoVoiceChat gameId={id} />
              </div>
            )}

            <div className="felt-board relative w-full h-full min-h-[320px] mx-auto overflow-visible">
              <div className="domino-arena absolute inset-[10px] rounded-[1rem]" aria-hidden="true" />
              <span className="table-leg table-leg--fl" aria-hidden="true" />
              <span className="table-leg table-leg--fr" aria-hidden="true" />
              <span className="table-leg table-leg--bl" aria-hidden="true" />
              <span className="table-leg table-leg--br" aria-hidden="true" />
              {board.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center px-4">
                  {game.player2_id ? (
                    <div className="flex flex-col items-center gap-2 text-center">
                      {/* Big bouncing arrow pointing down to exact drop spot */}
                      <span className="text-4xl text-primary animate-bounce drop-shadow-[0_0_10px_rgba(212,165,44,0.9)]">⬇</span>
                      {/* Exact placeholder where the first tile will land */}
                      <div className="relative flex h-16 w-28 items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/15 shadow-[0_0_32px_rgba(212,165,44,0.5)] animate-pulse">
                        <div className="h-10 w-20 rounded-md border border-primary/70 bg-primary/10" />
                        <span className="absolute inset-0 rounded-lg ring-2 ring-primary/40 animate-ping" />
                      </div>
                      <p className="text-xs text-[#ffe27a] italic font-semibold tracking-wide">
                        {isMyTurn ? "ETO no asiana ny vato voalohany" : "Eto no hapetraky ny adversaire ny vato voalohany"}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-[#ffe27a]/80 italic text-center px-4">
                      Miandry adversaire hiditra hanomboka ny lalao...
                    </p>
                  )}
                </div>
              ) : firstBoardTile && firstBoardA !== null && firstBoardB !== null ? (
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  <div className="domino-first-tile-stage animate-scale-in">
                    <DominoTile
                      a={firstBoardA}
                      b={firstBoardB}
                      size={isMobile ? "xl" : "xl"}
                      horizontal={firstBoardA !== firstBoardB}
                      variant="white"
                      pipColor="black"
                      glow={null}
                      splitEdge
                    />
                  </div>
                </div>
              ) : (
                <div className="absolute inset-[10px]">
                  <SnakeBoard board={board} tileSize={boardTileSize as "sm" | "md"} />
                </div>
              )}

              {selected !== null && isMyTurn && (canLeft || canRight) && (
                <div className="absolute left-1/2 -translate-x-1/2 bottom-2 z-10 flex items-center gap-2 bg-black/40 px-2 py-1 rounded-lg backdrop-blur-sm">
                  <span className="text-[10px] text-[#ffe27a]">Voafidy:</span>
                  <DominoTile
                    a={myHand[selected][0]}
                    b={myHand[selected][1]}
                    size="xs"
                    horizontal={myHand[selected][0] !== myHand[selected][1]}
                    variant="white"
                  />
                  <button
                    type="button"
                    onClick={() => void tryPlay(selected, "left")}
                    disabled={!canLeft}
                    className="px-2 py-1 rounded-md text-[10px] font-bold bg-[#d4a52c] text-[#0a2818] disabled:opacity-40"
                  >
                    Akavia
                  </button>
                  <button
                    type="button"
                    onClick={() => void tryPlay(selected, "right")}
                    disabled={!canRight}
                    className="px-2 py-1 rounded-md text-[10px] font-bold bg-[#d4a52c] text-[#0a2818] disabled:opacity-40"
                  >
                    Akavanana
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Tap-to-play: tsy misy bokotra fanamafisana intsony */}

          {/* Tanako — lehibe sy mazava, mifanesy */}
          <div className="domino-hand-dock px-2 pb-3 pt-1">
            <div className={`domino-hand-mat domino-hand-mat--self ${isMyTurn ? "is-turn" : ""}`}>
            <div className="flex items-center justify-between mb-2 px-1 gap-2">
              <span className={`text-xs font-bold ${isMyTurn ? "gold-text" : "text-muted-foreground"}`}>
                {isMyTurn ? `▶ ${myName} — andiany!` : `${myName} (${myHand.length})`}
              </span>
              {isMyTurn && (
                <div className="flex flex-col items-stretch gap-1">
                  <button
                    type="button"
                    onClick={() => { if (noMove) void passTurn(); }}
                    disabled={!noMove}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-extrabold uppercase tracking-wider border-2 transition active:scale-95 ${
                      noMove
                        ? "bg-destructive text-destructive-foreground border-destructive shadow-[0_0_12px_rgba(239,68,68,0.6)] animate-pulse"
                        : "bg-black/30 text-muted-foreground border-muted-foreground/30 opacity-50 cursor-not-allowed"
                    }`}
                    title={noMove ? "Tsindrio mba handalo any amin'ny adversaire" : "Mbola manana vato azo apetraka ianao"}
                  >
                    {noMove ? "⏭ Pass" : "Pass"}
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-7 gap-1 py-1 px-1 w-full">
              {myHand.map((t, i) => {
                const placeable = canPlace(board, t) !== null;
                const isFlipped = !!flippedHand[i];
                const showA = isFlipped ? t[1] : t[0];
                const showB = isFlipped ? t[0] : t[1];
                return (
                  <div key={i} data-hand-index={i} style={{ touchAction: "none" }}>
                  <DominoTile
                    a={showA}
                    b={showB}
                    size={handTileSize}
                    fluid
                    onPointerDown={(e) => handleHandPointerDown(i, e)}
                    onPointerMove={(e) => handleHandPointerMove(i, e)}
                    onPointerEnter={() => handleHandPointerEnter(i)}
                    onPointerUp={() => void handleHandPointerUp(i)}
                    onPointerLeave={handleHandPointerLeave}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setFlippedHand((prev) => ({ ...prev, [i]: !prev[i] }));
                    }}
                    onDoubleClick={() => {
                      setFlippedHand((prev) => ({ ...prev, [i]: !prev[i] }));
                    }}
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      if (isMyTurn && placeable) handleTileTap(i);
                    }}
                    selected={selected === i || dragIndex === i}
                    disabled={!isMyTurn || !placeable}
                    allowPointerWhenDisabled
                  />
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        </>
      )}

      {(game.status === "finished" || game.status === "blocked" || game.status === "cancelled") && (() => {
        const stake = Number(game.stake ?? 0);
        const pc = Number(game.players_count ?? 2);
        const commissionEach = Math.round(stake * 0.10);
        const pot = (stake - commissionEach) * pc;
        const netGain = pot - stake;
        const iWon = game.winner_id === user?.id;
        const draw = !game.winner_id;
        const winnerName = game.winner_id ? (profileNames[game.winner_id] ?? "Mpandresy") : "";
        const myScoreNow = scoreOf(user?.id ?? "");
        const reasonText: string = (game as any).last_reason ?? "";
        return (
          <DominoResultOverlay
            draw={draw}
            iWon={iWon}
            netGain={netGain}
            pot={pot}
            stake={stake}
            winnerName={winnerName}
            reasonText={reasonText}
            myScore={myScoreNow}
            onDone={() => nav("/lobby", { replace: true })}
          />
        );
      })()}
    </div>
  );
}

function DominoResultOverlay({
  draw, iWon, netGain, pot, stake, winnerName, reasonText, myScore, onDone,
}: {
  draw: boolean; iWon: boolean; netGain: number; pot: number; stake: number;
  winnerName: string; reasonText: string; myScore: number; onDone: () => void;
}) {
  const [count, setCount] = useState(10);
  useEffect(() => {
    sfx.win?.();
    const t = setInterval(() => setCount((c) => Math.max(0, c - 1)), 1000);
    const done = setTimeout(onDone, 10000);
    return () => { clearInterval(t); clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dust = Array.from({ length: 80 }, (_, i) => i);
  const tears = Array.from({ length: 40 }, (_, i) => i);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm overflow-hidden">
      {iWon && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {dust.map((i) => {
            const left = Math.random() * 100;
            const dur = 2.2 + Math.random() * 2.6;
            const delay = Math.random() * 1.5;
            const size = 4 + Math.random() * 6;
            return (
              <span
                key={i}
                className="gold-dust"
                style={{ left: `${left}%`, width: `${size}px`, height: `${size}px`, animationDuration: `${dur}s`, animationDelay: `${delay}s` }}
              />
            );
          })}
        </div>
      )}
      {!iWon && !draw && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {tears.map((i) => {
            const left = Math.random() * 100;
            const dur = 2.4 + Math.random() * 2.2;
            const delay = Math.random() * 2;
            return (
              <span
                key={i}
                className="sad-tear"
                style={{ left: `${left}%`, animationDuration: `${dur}s`, animationDelay: `${delay}s` }}
              />
            );
          })}
        </div>
      )}
      <div className={`${iWon ? "domino-win-pop" : !draw ? "domino-lose-pop" : "domino-win-pop"} relative w-[92%] max-w-md text-center rounded-3xl p-7 border-4 shadow-2xl ${
        draw ? "border-yellow-400 bg-gradient-to-br from-amber-600 to-yellow-800"
        : iWon ? "border-green-300 bg-gradient-to-br from-green-500 via-emerald-500 to-green-700 shadow-[0_0_80px_rgba(34,197,94,0.85)]"
        : "border-red-300 bg-gradient-to-br from-slate-700 via-red-900 to-slate-900 shadow-[0_0_80px_rgba(239,68,68,0.65)]"
      }`}>
        {draw ? (
          <>
            <p className="text-5xl mb-2">🤝</p>
            <p className="font-display text-3xl font-black text-white">Lalao tapaka</p>
          </>
        ) : iWon ? (
          <>
            <p className="text-6xl mb-2">🏆</p>
            <p className="font-display text-4xl font-black text-green-50 domino-win-glow tracking-wide">
              Arabaina nandresy ianao!
            </p>
            <p className="font-display text-xl font-bold text-yellow-100 mt-3">
              Ianao no nahatratra ny isa <b className="text-yellow-200">{myScore}</b>
            </p>
            <div className="mt-4 inline-flex flex-col items-center rounded-2xl bg-black/30 px-5 py-3 border border-yellow-200/40">
              <p className="text-xs text-yellow-100/80">Gain</p>
              <p className="font-display text-3xl font-black text-yellow-200 drop-shadow-lg">+{fmtAr(netGain)}</p>
              <p className="text-[11px] text-yellow-100/70">(Pot azo: {fmtAr(pot)})</p>
            </div>
          </>
        ) : (
          <>
            <p className="text-6xl mb-2 sad-emoji">😢</p>
            <p className="font-display text-3xl font-black text-white sad-title">Resy ianao</p>
            <p className="text-sm text-white/90 mt-2">
              {reasonText
                ? <>Resy ianao satria <b>{reasonText}</b></>
                : winnerName
                  ? <>Resy ianao satria nandresy <b>{winnerName}</b></>
                  : null}
            </p>
            <p className="font-display text-2xl font-black text-yellow-100 mt-3">-{fmtAr(stake)}</p>
            <p className="text-[11px] text-white/80">(very ny mise napetrakao)</p>
          </>
        )}
        <p className="text-[11px] text-white/80 mt-4 italic">Hiverina amin'ny lobby afaka {count}s…</p>
      </div>
    </div>
  );
}
