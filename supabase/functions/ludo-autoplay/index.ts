// Server-side Ludo watchdog: 10s turn limit. Plays a legal move (or rolls
// & passes) on behalf of any player whose turn has expired, so the game keeps
// moving even if everyone disconnects.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TURN_LIMIT_MS = 10_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Board constants — mirror of client
const ENTRY: Record<number, number> = { 1: 0, 2: 13, 3: 26, 4: 39 };
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

type PawnRec = { seat: number; idx: number; pos: number };

function outerIndex(seat: number, pos: number): number | null {
  if (pos >= 1 && pos <= 51) return (ENTRY[seat] + pos - 1) % 52;
  return null;
}

function legalMoves(pawns: PawnRec[], seat: number, dv: number): number[] {
  const legal: number[] = [];
  pawns.filter((p) => p.seat === seat).forEach((p) => {
    if (p.pos === 0) { if (dv === 6) legal.push(p.idx); }
    else if (p.pos < 57 && p.pos + dv <= 57) legal.push(p.idx);
  });
  return legal;
}

function botChoose(pawns: PawnRec[], seat: number, dv: number): number | null {
  const opts = legalMoves(pawns, seat, dv);
  if (!opts.length) return null;
  let best = -Infinity, choice = opts[0];
  for (const i of opts) {
    const cur = pawns.find((p) => p.seat === seat && p.idx === i)!;
    const nextProg = cur.pos === 0 ? 1 : cur.pos + dv;
    let score = nextProg;
    if (nextProg === 57) score += 100;
    if (cur.pos === 0) score += 25;
    if (nextProg > 51) score += 40;
    if (nextProg <= 51) {
      const target = (ENTRY[seat] + nextProg - 1) % 52;
      if (!SAFE.has(target)) {
        for (const opw of pawns) {
          if (opw.seat === seat) continue;
          const ooi = outerIndex(opw.seat, opw.pos);
          if (ooi === target) score += 90;
        }
      }
    }
    if (score > best) { best = score; choice = i; }
  }
  return choice;
}

function nextSeat(seats: number[], seat: number): number {
  const i = seats.indexOf(seat);
  return seats[(i + 1) % seats.length];
}

function userIdBySeat(g: any, seat: number): string | null {
  const seats: number[] = g.seat_assignment ?? [];
  const orderedUids = [g.player1_id, g.player2_id, g.player3_id, g.player4_id].filter(Boolean);
  const i = seats.indexOf(seat);
  return i >= 0 ? (orderedUids[i] ?? null) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const cutoff = new Date(Date.now() - TURN_LIMIT_MS).toISOString();
  const { data: games, error } = await sb.from("ludo_games")
    .select("*").eq("status", "in_progress")
    .lt("turn_started_at", cutoff).limit(20);
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: corsHeaders });

  const results: any[] = [];
  for (const g of games ?? []) {
    try {
      const seat = Number(g.current_turn_seat);
      const seats: number[] = g.seat_assignment ?? [1, 2, 3, 4];
      const pawns: PawnRec[] = (g.pawns ?? []).slice();
      let dice = Number(g.last_dice ?? 0);
      const cs = Number(g.consecutive_sixes ?? 0);

      if (!g.dice_rolled) {
        dice = 1 + Math.floor(Math.random() * 6);
        const newSix = dice === 6 ? cs + 1 : 0;
        if (newSix >= 3) {
          await sb.rpc("ludo_update_state", {
            _game_id: g.id, _last_dice: dice, _dice_rolled: false, _consecutive_sixes: 0,
            _current_turn_seat: nextSeat(seats, seat), _turn_started_at: new Date().toISOString(),
          });
          results.push({ id: g.id, action: "three-sixes-skip" });
          continue;
        }
        const legal = legalMoves(pawns, seat, dice);
        if (legal.length === 0) {
          if (dice === 6) {
            await sb.rpc("ludo_update_state", {
              _game_id: g.id, _last_dice: dice, _dice_rolled: false,
              _consecutive_sixes: newSix, _turn_started_at: new Date().toISOString(),
            });
            results.push({ id: g.id, action: "no-move-reroll" });
          } else {
            await sb.rpc("ludo_update_state", {
              _game_id: g.id, _last_dice: dice, _dice_rolled: false, _consecutive_sixes: 0,
              _current_turn_seat: nextSeat(seats, seat), _turn_started_at: new Date().toISOString(),
            });
            results.push({ id: g.id, action: "no-move-pass" });
          }
          continue;
        }
        // Roll only — mark rolled so pick can happen next tick
        await sb.rpc("ludo_update_state", {
          _game_id: g.id, _last_dice: dice, _dice_rolled: true, _consecutive_sixes: newSix,
          _turn_started_at: new Date().toISOString(),
        });
        // Continue in same tick to apply move immediately
      }

      // Pick move
      const pick = botChoose(pawns, seat, dice);
      if (pick == null) {
        await sb.rpc("ludo_update_state", {
          _game_id: g.id, _dice_rolled: false, _consecutive_sixes: 0,
          _current_turn_seat: nextSeat(seats, seat), _turn_started_at: new Date().toISOString(),
        });
        results.push({ id: g.id, action: "no-legal-after-roll" });
        continue;
      }
      const pw = pawns.find((p) => p.seat === seat && p.idx === pick)!;
      const startProg = pw.pos;
      pw.pos = startProg === 0 ? 1 : startProg + dice;
      let didCapture = false;
      const didFinish = pw.pos === 57;
      const oi = outerIndex(seat, pw.pos);
      if (oi != null && !SAFE.has(oi)) {
        for (const op of pawns) {
          if (op.seat === seat) continue;
          const ooi = outerIndex(op.seat, op.pos);
          if (ooi === oi) { op.pos = 0; didCapture = true; }
        }
      }
      const iAmWinner = pawns.filter((p) => p.seat === seat).every((x) => x.pos === 57);
      const extra = dice === 6 || didCapture || didFinish;
      await sb.rpc("ludo_update_state", {
        _game_id: g.id, _pawns: pawns,
        _current_turn_seat: extra ? seat : nextSeat(seats, seat),
        _dice_rolled: false, _consecutive_sixes: extra ? cs : 0,
        _turn_started_at: new Date().toISOString(),
      });
      if (iAmWinner) {
        const uid = userIdBySeat(g, seat);
        if (uid) await sb.rpc("ludo_settle", { _game_id: g.id, _winner: uid });
      }
      results.push({ id: g.id, action: "auto-move", seat, dice, pick });
    } catch (e) {
      results.push({ id: g.id, error: String(e) });
    }
  }
  return new Response(JSON.stringify({ ok: true, count: results.length, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});