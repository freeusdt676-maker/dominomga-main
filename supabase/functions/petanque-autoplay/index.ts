// Server-side Pétanque auto-throw: when 20s expire on a turn, the backend
// computes a deterministic throw straight toward the cochonnet, simulates the
// physics (mirror of src/lib/petanqueEngine.ts), then commits the final state.
// Triggered every 5s by pg_cron. Idempotent via fresh row checks.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TURN_LIMIT_MS = 20_000;
const SKEW_MS = 500;
const TARGET_SCORE = 13;
const BALLS_PER_PLAYER = 4;

const COURT = {
  minX: -1.8, maxX: 1.8, minZ: -1.4, maxZ: 10.8,
  ballR: 0.18, jackR: 0.08,
  friction: 0.985, restitution: 0.55,
  minSpeed: 0.05,
};
const JACK_VALID = { minZ: 6.8, maxZ: 10.0, maxAbsX: 1.2 };

type Ball = { id: string; owner: "p1" | "p2"; x: number; z: number; vx: number; vz: number };
type Jack = { x: number; z: number };

function distance(a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function stepPhysics(balls: Ball[], jack: Jack | null, dt: number): boolean {
  let moving = false;
  for (const b of balls) {
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    const f = Math.pow(COURT.friction, dt * 60);
    b.vx *= f; b.vz *= f;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp < COURT.minSpeed) { b.vx = 0; b.vz = 0; } else moving = true;
  }
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], c = balls[j];
      const dx = c.x - a.x, dz = c.z - a.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const min = COURT.ballR * 2;
      if (d > 0 && d < min) {
        const nx = dx / d, nz = dz / d;
        const overlap = (min - d) / 2;
        a.x -= nx * overlap; a.z -= nz * overlap;
        c.x += nx * overlap; c.z += nz * overlap;
        const dvx = c.vx - a.vx, dvz = c.vz - a.vz;
        const dot = dvx * nx + dvz * nz;
        if (dot < 0) {
          const e = COURT.restitution;
          const imp = -(1 + e) * dot / 2;
          a.vx -= imp * nx; a.vz -= imp * nz;
          c.vx += imp * nx; c.vz += imp * nz;
        }
      }
    }
  }
  if (jack) {
    for (const b of balls) {
      const dx = jack.x - b.x, dz = jack.z - b.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const min = COURT.ballR + COURT.jackR;
      if (d > 0 && d < min) {
        const nx = dx / d, nz = dz / d;
        const overlap = (min - d);
        jack.x += nx * overlap; jack.z += nz * overlap;
        const sp = Math.hypot(b.vx, b.vz);
        jack.x += nx * sp * 0.02; jack.z += nz * sp * 0.02;
        b.vx *= 0.7; b.vz *= 0.7;
        if (jack.x < COURT.minX) jack.x = COURT.minX;
        if (jack.x > COURT.maxX) jack.x = COURT.maxX;
        if (jack.z < COURT.minZ) jack.z = COURT.minZ;
        if (jack.z > COURT.maxZ) jack.z = COURT.maxZ;
      }
    }
  }
  return moving;
}

function detectForfeits(balls: Ball[]): string[] {
  const out: string[] = [];
  for (const b of balls) {
    if (b.x < COURT.minX || b.x > COURT.maxX || b.z < COURT.minZ || b.z > COURT.maxZ) {
      out.push(b.id);
    }
  }
  return out;
}

function computeRoundScore(balls: Ball[], jack: Jack): { winner: "p1" | "p2" | null; points: number } {
  if (!jack || balls.length === 0) return { winner: null, points: 0 };
  const withDist = balls.map(b => ({ owner: b.owner, d: distance(b, jack) })).sort((a, b) => a.d - b.d);
  const winner = withDist[0].owner;
  const opp = winner === "p1" ? "p2" : "p1";
  const oppClosest = withDist.find(x => x.owner === opp);
  if (!oppClosest) return { winner, points: withDist.filter(x => x.owner === winner).length };
  const points = withDist.filter(x => x.owner === winner && x.d < oppClosest.d).length;
  return { winner, points: Math.max(1, points) };
}

function nextThrower(
  balls: Ball[], jack: Jack | null,
  remaining: { p1: number; p2: number },
  lastThrower: "p1" | "p2",
): "p1" | "p2" | null {
  if (remaining.p1 <= 0 && remaining.p2 <= 0) return null;
  if (!jack) return lastThrower;
  const sorted = balls.map(b => ({ owner: b.owner, d: distance(b, jack) })).sort((a, b) => a.d - b.d);
  const holder = sorted[0]?.owner ?? null;
  const opp: "p1" | "p2" = holder === "p1" ? "p2" : holder === "p2" ? "p1" : (lastThrower === "p1" ? "p2" : "p1");
  if (remaining[opp] > 0) return opp;
  const other: "p1" | "p2" = opp === "p1" ? "p2" : "p1";
  if (remaining[other] > 0) return other;
  return null;
}

function simulateThrow(
  baseBalls: Ball[], baseJack: Jack | null,
  thrower: "p1" | "p2", angleDeg: number, force: number,
): { balls: Ball[]; jack: Jack | null } {
  const rad = (angleDeg * Math.PI) / 180;
  const speed = 4 + (force / 100) * 11;
  const vx = Math.sin(rad) * speed;
  const vz = Math.cos(rad) * speed;
  const ballId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const newBall: Ball = { id: ballId, owner: thrower, x: 0, z: -1.3, vx, vz };
  const balls: Ball[] = [...baseBalls.map(b => ({ ...b, vx: 0, vz: 0 })), newBall];
  const jack: Jack | null = baseJack ? { ...baseJack } : null;
  // Run simulation with fixed dt=1/60 up to ~8s (480 steps).
  const dt = 1 / 60;
  for (let i = 0; i < 480; i++) {
    const moving = stepPhysics(balls, jack, dt);
    if (!moving) break;
  }
  const out = detectForfeits(balls);
  return { balls: balls.filter(b => !out.includes(b.id)), jack };
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: games, error } = await supabase
    .from("petanque_games")
    .select("*")
    .eq("status", "in_progress")
    .limit(50);
  if (error) {
    console.error("scan error", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  const nowMs = Date.now();
  let advanced = 0;

  for (const g of games ?? []) {
    try {
      const phase = g.state?.phase;
      if (phase !== "aim" && phase !== "throw_jack") continue;
      const turnStartMs = g.turn_started_at
        ? new Date(g.turn_started_at).getTime()
        : (g.updated_at ? new Date(g.updated_at).getTime() : 0);
      if (!turnStartMs) continue;
      if (nowMs - turnStartMs < TURN_LIMIT_MS - SKEW_MS) continue;

      const throwSide: "p1" | "p2" | null =
        g.current_turn === g.player1_id ? "p1" :
        g.current_turn === g.player2_id ? "p2" : null;
      if (!throwSide) continue;
      const throwerUid = throwSide === "p1" ? g.player1_id : g.player2_id;

      if (phase === "throw_jack") {
        const jackX = (Math.random() - 0.5) * 0.6;
        const jackZ = 8.0 + Math.random() * 0.6;
        const { error: rpcErr } = await supabase.rpc("petanque_update_state", {
          _game_id: g.id,
          _state: {
            balls: [],
            jack: { x: jackX, z: jackZ },
            phase: "aim",
            remaining: { p1: BALLS_PER_PLAYER, p2: BALLS_PER_PLAYER },
            lastThrower: throwSide,
          },
          _current_turn: throwerUid,
          _turn_started_at: new Date().toISOString(),
          _score_p1: g.score_p1,
          _score_p2: g.score_p2,
          _round_number: g.round_number,
        });
        if (rpcErr) throw rpcErr;
        advanced += 1;
        continue;
      }

      // aim phase: throw straight toward the jack
      const jk = g.state?.jack ?? { x: 0, z: 8 };
      const dxJ = jk.x - 0;
      const dzJ = jk.z - (-1.3);
      const angleRad = Math.atan2(dxJ, dzJ);
      const angleDeg = Math.round((angleRad * 180) / Math.PI);
      const dist = Math.hypot(dxJ, dzJ);
      const targetSpeed = Math.max(5, Math.min(13, 3.6 + dist * 0.95));
      const force = Math.round(Math.max(35, Math.min(95, ((targetSpeed - 4) / 11) * 100)));

      const prevRemaining = g.state?.remaining ?? { p1: BALLS_PER_PLAYER, p2: BALLS_PER_PLAYER };
      if (prevRemaining[throwSide] <= 0) continue;

      const baseBalls: Ball[] = Array.isArray(g.state?.balls) ? g.state.balls : [];
      const baseJack: Jack | null = g.state?.jack ?? null;
      const sim = simulateThrow(baseBalls, baseJack, throwSide, angleDeg, force);
      const sanitized = sim.balls.map(b => ({ ...b, vx: 0, vz: 0 }));
      const finalJack = sim.jack;
      const remaining = { ...prevRemaining, [throwSide]: Math.max(0, prevRemaining[throwSide] - 1) };

      let newScoreP1 = g.score_p1;
      let newScoreP2 = g.score_p2;
      let newRound = g.round_number;
      let newPhase: "aim" | "settle" | "throw_jack" = "aim";
      let nextTurnUser: string | null = null;
      let newBalls = sanitized;
      let newJack: Jack | null = finalJack;
      let newRemaining = remaining;

      if (remaining.p1 <= 0 && remaining.p2 <= 0 && finalJack) {
        const r = computeRoundScore(sanitized, finalJack);
        if (r.winner === "p1") newScoreP1 += r.points;
        if (r.winner === "p2") newScoreP2 += r.points;
        newRound += 1;
        const winnerId =
          newScoreP1 >= TARGET_SCORE ? g.player1_id :
          newScoreP2 >= TARGET_SCORE ? g.player2_id : null;

        if (winnerId) {
          const finalState = {
            balls: sanitized, jack: finalJack, phase: "settle" as const,
            remaining, lastThrower: throwSide,
          };
          const { error: updErr } = await supabase.rpc("petanque_update_state", {
            _game_id: g.id, _state: finalState, _current_turn: null,
            _turn_started_at: new Date().toISOString(),
            _score_p1: newScoreP1, _score_p2: newScoreP2, _round_number: newRound,
          });
          if (updErr) throw updErr;
          const { error: settleErr } = await supabase.rpc("petanque_settle", {
            _game_id: g.id, _winner: winnerId,
          });
          if (settleErr) throw settleErr;
          advanced += 1;
          continue;
        }

        // Next round — round winner throws the jack
        newBalls = [];
        newJack = null;
        newRemaining = { p1: BALLS_PER_PLAYER, p2: BALLS_PER_PLAYER };
        newPhase = "throw_jack";
        nextTurnUser = r.winner === "p1" ? g.player1_id : (r.winner === "p2" ? g.player2_id : throwerUid);
      } else {
        const nx = nextThrower(sanitized, finalJack, remaining, throwSide);
        const chosen: "p1" | "p2" = nx ?? (throwSide === "p1" ? "p2" : "p1");
        nextTurnUser = chosen === "p1" ? g.player1_id : g.player2_id;
      }

      const newState = {
        balls: newBalls, jack: newJack, phase: newPhase,
        remaining: newRemaining, lastThrower: throwSide,
      };
      const { error: upd2Err } = await supabase.rpc("petanque_update_state", {
        _game_id: g.id, _state: newState, _current_turn: nextTurnUser,
        _turn_started_at: new Date().toISOString(),
        _score_p1: newScoreP1, _score_p2: newScoreP2, _round_number: newRound,
      });
      if (upd2Err) throw upd2Err;
      advanced += 1;
    } catch (e) {
      console.error(`petanque autoplay failed for game ${g.id}`, e);
    }
  }

  return new Response(JSON.stringify({ ok: true, scanned: games?.length ?? 0, advanced }), {
    headers: { "Content-Type": "application/json" },
  });
});