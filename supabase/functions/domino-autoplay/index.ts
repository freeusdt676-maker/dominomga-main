// Server-side Domino watchdog: prevents permanent hangs.
// Every 1s (via pg_cron), it plays a legal tile after the 15s deadline,
// passes ONLY when no legal tile exists, and advances expired reveal phases.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HANG_THRESHOLD_MS = 15_000;
const REVEAL_MS = 5_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getPlayerIds(g: any): string[] {
  const pc = Number(g?.players_count ?? 2);
  return pc === 3
    ? [g.player1_id, g.player2_id, g.player3_id].filter(Boolean)
    : [g.player1_id, g.player2_id].filter(Boolean);
}

function nextTurnId(g: any, current: string): string {
  const ids = getPlayerIds(g);
  const i = ids.indexOf(current);
  if (i < 0) return ids[0];
  // Fihodinana CONTRAIRE MONTRE / mankany ANKAVIA. 3P: P1 → P3 → P2 → P1.
  const n = ids.length;
  return ids[(i - 1 + n) % n];
}

type Tile = [number, number];
type Placed = { tile: Tile; flipped?: boolean };

function hashSeed(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDeck(): Tile[] {
  const d: Tile[] = [];
  for (let a = 0; a <= 6; a += 1) for (let b = a; b <= 6; b += 1) d.push([a, b]);
  return d;
}

function countDoubles(hand: Tile[]) {
  return hand.reduce((n, [a, b]) => n + (a === b ? 1 : 0), 0);
}

function shuffleDeckWithSeed(seed: string): Tile[] {
  const random = mulberry32(hashSeed(seed));
  const deck = buildDeck();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function dealHands(seed: string, pc: number): { hands: Tile[][]; boneyard: Tile[] } {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const deck = shuffleDeckWithSeed(`${seed}#redeal${attempt}`);
    const hands = pc === 3
      ? [deck.slice(0, 7), deck.slice(7, 14), deck.slice(14, 21)]
      : [deck.slice(0, 7), deck.slice(7, 14)];
    if (!hands.some((h) => countDoubles(h) >= 4)) {
      return { hands, boneyard: pc === 3 ? deck.slice(21) : deck.slice(14) };
    }
  }
  const deck = shuffleDeckWithSeed(seed);
  return pc === 3
    ? { hands: [deck.slice(0, 7), deck.slice(7, 14), deck.slice(14, 21)], boneyard: deck.slice(21) }
    : { hands: [deck.slice(0, 7), deck.slice(7, 14)], boneyard: deck.slice(14) };
}

function ends(board: Placed[]): { left: number; right: number } | null {
  if (!board.length) return null;
  const first = board[0];
  const last = board[board.length - 1];
  return {
    left: first.flipped ? first.tile[1] : first.tile[0],
    right: last.flipped ? last.tile[0] : last.tile[1],
  };
}

function canPlaceSide(board: Placed[], tile: Tile): "left" | "right" | "either" | null {
  const e = ends(board);
  if (!e) return "either";
  const [a, b] = tile;
  const onLeft = a === e.left || b === e.left;
  const onRight = a === e.right || b === e.right;
  if (onLeft && onRight) return "either";
  if (onLeft) return "left";
  if (onRight) return "right";
  return null;
}

function canPlace(board: Placed[], tile: Tile): boolean {
  return canPlaceSide(board, tile) !== null;
}

function place(board: Placed[], tile: Tile, side: "left" | "right"): Placed[] {
  const e = ends(board);
  if (!e) return [{ tile, flipped: false }];
  if (side === "left") return [{ tile, flipped: tile[1] !== e.left }, ...board];
  return [...board, { tile, flipped: tile[0] !== e.right }];
}

function handHasMove(hand: Tile[], board: Placed[]): boolean {
  return hand.some((tile) => canPlace(board, tile));
}

function getHand(g: any, playerId: string): Tile[] {
  if (playerId === g.player1_id) return (g.player1_hand ?? []) as Tile[];
  if (playerId === g.player2_id) return (g.player2_hand ?? []) as Tile[];
  if (playerId === g.player3_id) return (g.player3_hand ?? []) as Tile[];
  return [];
}

function getHandKey(g: any, playerId: string): "player1_hand" | "player2_hand" | "player3_hand" | null {
  if (playerId === g.player1_id) return "player1_hand";
  if (playerId === g.player2_id) return "player2_hand";
  if (playerId === g.player3_id) return "player3_hand";
  return null;
}

function pipsTotal(hand: Tile[]): number {
  return hand.reduce((s, [a, b]) => s + a + b, 0);
}

function countSuit(h: Tile[], v: number) {
  return h.reduce((n, [a, b]) => n + (a === v ? 1 : 0) + (b === v ? 1 : 0), 0);
}
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
// GRAND-MAÎTRE Domino bot — fair info (hand + board + opponent sizes only).
function chooseBestBotMove(
  hand: Tile[],
  board: Placed[],
  opts: { opponentSizes?: number[] } = {},
): { index: number; side: "left" | "right" } | null {
  type Cand = { index: number; side: "left" | "right"; score: number };
  const cands: Cand[] = [];
  const unseen = computeUnseenTiles(hand, board);
  const unseenSuit = (v: number) => countSuit(unseen, v);
  const oppSizes = opts.opponentSizes ?? [];
  const oppMin = oppSizes.length ? Math.min(...oppSizes) : 7;
  const endgameOpp = oppMin <= 3;
  const criticalOpp = oppMin <= 2;
  for (let i = 0; i < hand.length; i += 1) {
    const tile = hand[i];
    const can = canPlaceSide(board, tile);
    if (!can) continue;
    const sides: ("left" | "right")[] = can === "either" ? ["left", "right"] : [can];
    for (const side of sides) {
      const nb = place(board, tile, side);
      const remaining = hand.filter((_, k) => k !== i);
      const pipsRem = pipsTotal(remaining);
      const [a, b] = tile;
      const isDouble = a === b;
      let score = 0;
      if (remaining.length === 0) {
        score += 1_000_000;
        if (a === 6 && b === 6) score += 500;
        cands.push({ index: i, side, score });
        continue;
      }
      const dumpWeight = criticalOpp ? 8 : endgameOpp ? 5 : 3;
      score += (a + b) * dumpWeight;
      score -= pipsRem * 0.35;
      if (isDouble) {
        const suitAfter = countSuit(remaining, a);
        if (suitAfter <= 1) score += 12 + a * 1.5;
        else score -= 3 + a * 0.5;
      }
      const e = ends(nb);
      if (e) {
        const myLeft = countSuit(remaining, e.left);
        const myRight = countSuit(remaining, e.right);
        const uL = unseenSuit(e.left);
        const uR = unseenSuit(e.right);
        score += myLeft * 5 + myRight * 5;
        const blockL = Math.max(0, 8 - uL);
        const blockR = Math.max(0, 8 - uR);
        const blockMul = criticalOpp ? 3.5 : endgameOpp ? 2 : 1;
        score += (blockL + blockR) * blockMul;
        if (e.left === e.right) {
          if (myLeft >= 2) score += 25 + myLeft * 4;
          else if (myLeft === 1) score += 8;
          else score -= 25;
        }
        if (myLeft === 0 && e.left !== e.right) score -= 5;
        if (myRight === 0 && e.left !== e.right) score -= 5;
        if (endgameOpp) {
          if (uL <= 2) score += 15;
          if (uR <= 2) score += 15;
        }
      }
      cands.push({ index: i, side, score });
    }
  }
  cands.sort((x, y) => y.score - x.score);
  return cands[0] ?? null;
}

function targetFor(mode: string | null | undefined) {
  return mode === "d80" ? 80 : 120;
}

function soloThreshold(mode: string | null | undefined) {
  return mode === "d80" ? 40 : 60;
}

function scoreFor(g: any, playerId: string) {
  if (playerId === g.player1_id) return Number(g.score_p1 ?? 0);
  if (playerId === g.player2_id) return Number(g.score_p2 ?? 0);
  if (playerId === g.player3_id) return Number(g.score_p3 ?? 0);
  return 0;
}

function scorePayload(g: any, winnerId: string, points: number) {
  const add = (id: string | null | undefined, base: number) => Number(base ?? 0) + (id === winnerId ? points : 0);
  const payload: Record<string, number> = {
    score_p1: add(g.player1_id, g.score_p1),
    score_p2: add(g.player2_id, g.score_p2),
  };
  if (Number(g.players_count ?? 2) === 3) payload.score_p3 = add(g.player3_id, g.score_p3);
  return payload;
}

function winnerScoreFromPayload(g: any, winnerId: string, scores: Record<string, number>) {
  if (winnerId === g.player1_id) return scores.score_p1;
  if (winnerId === g.player2_id) return scores.score_p2;
  return scores.score_p3 ?? 0;
}

function opponentScores(g: any, winnerId: string) {
  return getPlayerIds(g).filter((id) => id !== winnerId).map((id) => scoreFor(g, id));
}

function playerLabel(g: any, playerId: string) {
  if (playerId === g.player1_id) return "P1";
  if (playerId === g.player2_id) return "P2";
  if (playerId === g.player3_id) return "P3";
  return "Mpilalao";
}

async function startNextRound(supabase: any, g: any) {
  const pc = Number(g.players_count ?? 2);
  const nextRound = Number(g.round_number ?? 1) + 1;
  const { hands, boneyard } = dealHands(`${g.ticket_number || g.id}-r${nextRound}`, pc);
  const ids = getPlayerIds(g);
  const nextId = ids[(nextRound - 1) % ids.length];
  const updateNext: Record<string, unknown> = {
    round_number: nextRound,
    player1_hand: hands[0],
    player2_hand: hands[1],
    boneyard,
    board_state: [],
    current_turn: nextId,
    turn_started_at: new Date().toISOString(),
    passes: 0,
    reveal_until: null,
    last_reason: null,
  };
  if (pc === 3) updateNext.player3_hand = hands[2];
  const { error } = await supabase.from("games").update(updateNext).eq("id", g.id).eq("status", "in_progress");
  if (error) throw error;
}

async function finishRoundOnServer(
  supabase: any,
  g: any,
  winnerId: string,
  pointsRaw: number,
  lastTile: Tile | null,
  board: Placed[],
  handKey?: "player1_hand" | "player2_hand" | "player3_hand" | null,
  newHand?: Tile[],
  reasonOverride?: string,
) {
  const points = Math.max(0, Number(pointsRaw) || 0);
  const target = targetFor(g.game_mode);
  const scores = scorePayload(g, winnerId, points);
  const winnerScore = winnerScoreFromPayload(g, winnerId, scores);
  const targetReached = winnerScore >= target;
  const soloWin = winnerScore >= soloThreshold(g.game_mode) && opponentScores(g, winnerId).every((s) => Number(s ?? 0) === 0);
  const doubleSixOut = !!lastTile && lastTile[0] === 6 && lastTile[1] === 6 && points > 0;
  const instantWin = targetReached || soloWin || doubleSixOut;
  const winnerName = playerLabel(g, winnerId);
  const reason = doubleSixOut && !targetReached && !soloWin
    ? `MANDRESY NY LALAO — DOUBLE 6 • ${winnerName} namarana ny tour tamin'ny [6|6]`
    : soloWin && !targetReached
      ? `MANDRESY NY LALAO — MANDEHA IRERY • ${winnerName} tonga ${winnerScore} (${soloThreshold(g.game_mode)}+)`
      : targetReached
        ? `MANDRESY NY LALAO — ${winnerName} tonga ${target}`
        : (reasonOverride ?? (points > 0 ? `Tour vita — ${winnerName} nahazo +${points} isa` : `Tour vita — ${winnerName}`));

  if ((soloWin || doubleSixOut) && !targetReached) {
    if (winnerId === g.player1_id) scores.score_p1 = target;
    else if (winnerId === g.player2_id) scores.score_p2 = target;
    else scores.score_p3 = target;
  }

  const payload: Record<string, unknown> = {
    ...scores,
    board_state: board,
    reveal_until: new Date(Date.now() + REVEAL_MS).toISOString(),
    last_reason: reason,
    current_turn: null,
    turn_started_at: null,
    passes: 0,
  };
  if (handKey && newHand) payload[handKey] = newHand;
  const { error } = await supabase.from("games").update(payload).eq("id", g.id).eq("status", "in_progress");
  if (error) throw error;
  return { instantWin };
}

async function finishBlockedOnServer(supabase: any, g: any, board: Placed[]) {
  const pc = Number(g.players_count ?? 2);
  const totals = getPlayerIds(g).map((id) => ({ id, p: pipsTotal(getHand(g, id)) })).sort((a, b) => a.p - b.p);
  if (totals.length < pc) return;
  if (totals[0].p === totals[1].p) {
    await startNextRound(supabase, g);
    return;
  }
  const winner = totals[0];
  const points = totals.slice(1).reduce((s, x) => s + x.p, 0) - winner.p;
  await finishRoundOnServer(
    supabase,
    g,
    winner.id,
    points,
    null,
    board,
    null,
    undefined,
    `Blocage: ${playerLabel(g, winner.id)} nahazo +${points} isa (vato kely indrindra)`,
  );
}

async function handleExpiredReveal(supabase: any, g: any) {
  const target = targetFor(g.game_mode);
  const hasWinner = getPlayerIds(g).some((id) => scoreFor(g, id) >= target)
    || String(g.last_reason ?? "").startsWith("MANDRESY NY LALAO");
  if (hasWinner) {
    const winner = getPlayerIds(g).sort((a, b) => scoreFor(g, b) - scoreFor(g, a))[0];
    if (winner) await supabase.rpc("settle_game", { _game_id: g.id, _winner: winner });
    return;
  }
  await startNextRound(supabase, g);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoffMs = Date.now() - HANG_THRESHOLD_MS;
  const { data: games, error } = await supabase
    .from("games")
    .select("id, ticket_number, game_mode, players_count, player1_id, player2_id, player3_id, current_turn, turn_started_at, status, passes, board_state, player1_hand, player2_hand, player3_hand, boneyard, score_p1, score_p2, score_p3, round_number, reveal_until, last_reason")
    .eq("status", "in_progress")
    .limit(100);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let advanced = 0;
  let protectedTurns = 0;
  let played = 0;
  let roundsFinished = 0;
  let revealsAdvanced = 0;
  for (const g of games ?? []) {
    const revealMs = g.reveal_until ? new Date(g.reveal_until).getTime() : 0;
    if (!g.current_turn) {
      if (revealMs > 0 && revealMs <= Date.now()) {
        await handleExpiredReveal(supabase, g);
        revealsAdvanced += 1;
      }
      continue;
    }
    if (!g.turn_started_at || new Date(g.turn_started_at).getTime() > cutoffMs) continue;
    const board = ((g as any).board_state ?? []) as Placed[];
    const hand = getHand(g, g.current_turn as string);
    const handKey = getHandKey(g, g.current_turn as string);
    const oppSizes = getPlayerIds(g)
      .filter((id) => id !== g.current_turn)
      .map((id) => getHand(g, id).length);
    const best = chooseBestBotMove(hand, board, { opponentSizes: oppSizes });
    if (best && handKey) {
      const tile = hand[best.index];
      const newBoard = place(board, tile, best.side);
      const newHand = hand.filter((_, i) => i !== best.index);
      if (newHand.length === 0) {
        const otherTiles = getPlayerIds(g).filter((id) => id !== g.current_turn).flatMap((id) => getHand(g, id));
        await finishRoundOnServer(supabase, g, g.current_turn as string, pipsTotal(otherTiles), tile, newBoard, handKey, newHand);
        roundsFinished += 1;
        continue;
      }
      const nextId = nextTurnId(g, g.current_turn as string);
      const { error: upErr, count } = await supabase
        .from("games")
        .update({
          board_state: newBoard,
          [handKey]: newHand,
          current_turn: nextId,
          turn_started_at: new Date().toISOString(),
          passes: 0,
        }, { count: "exact" })
        .eq("id", g.id)
        .eq("turn_started_at", g.turn_started_at)
        .eq("status", "in_progress");
      if (!upErr && (count ?? 0) > 0) played += 1;
      continue;
    }
    if (handHasMove(hand, board)) {
      protectedTurns += 1;
      continue;
    }
    const nextId = nextTurnId(g, g.current_turn as string);
    if (!nextId || nextId === g.current_turn) continue;
    const passes = ((g as any).passes ?? 0) + 1;
    if (passes >= Number(g.players_count ?? 2)) {
      await finishBlockedOnServer(supabase, g, board);
      roundsFinished += 1;
      continue;
    }
    const { error: upErr, count } = await supabase
      .from("games")
      .update({
        current_turn: nextId,
        turn_started_at: new Date().toISOString(),
        passes,
      }, { count: "exact" })
      .eq("id", g.id)
      .eq("turn_started_at", g.turn_started_at)
      .eq("status", "in_progress");
    if (!upErr && (count ?? 0) > 0) advanced += 1;
  }

  return new Response(JSON.stringify({ scanned: games?.length ?? 0, played, advanced, roundsFinished, revealsAdvanced, protectedTurns }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
