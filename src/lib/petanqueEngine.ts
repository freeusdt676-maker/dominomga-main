// Pétanque physics engine — top-down 2D simulation (x/z plane, y=0 ground)
// Court is x∈[-2,2], z∈[-1.5,11]. Throw line at z=-1. Jack typically at z∈[6,9].

export type Ball = {
  id: string;
  owner: "p1" | "p2";
  x: number;
  z: number;
  vx: number;
  vz: number;
};

export type Jack = { x: number; z: number };

export const COURT = {
  minX: -1.8, maxX: 1.8, minZ: -1.4, maxZ: 10.8,
  ballR: 0.18, jackR: 0.08,
  friction: 0.978, restitution: 0.55, wallRestitution: 0.45,
  minSpeed: 0.14,
};

// Ny cochonnet dia ekena raha mbola tafiditra ao anaty COURT — na akaiky
// na lavitra. Ny mpilalao no misafidy hery, ary tsy misy fetra bebe kokoa.
export const JACK_VALID = { minZ: COURT.minZ, maxZ: COURT.maxZ, maxAbsX: COURT.maxX };
export function isJackValid(j: Jack | null): boolean {
  if (!j) return false;
  if (j.x < COURT.minX || j.x > COURT.maxX) return false;
  if (j.z < COURT.minZ || j.z > COURT.maxZ) return false;
  return true;
}

// Detects balls that have rolled OUT of the terrain. They are ejected past the
// edge (no bouncing). A ball is forfeit as soon as its center crosses the
// terrain boundary — it visibly continues out of the court before being removed.
export function detectForfeits(balls: Ball[], jack: Jack | null) {
  const out: string[] = [];
  for (const b of balls) {
    if (b.x < COURT.minX || b.x > COURT.maxX || b.z < COURT.minZ || b.z > COURT.maxZ) {
      out.push(b.id);
    }
  }
  let jackOut = false;
  if (jack) {
    jackOut =
      jack.x < COURT.minX || jack.x > COURT.maxX ||
      jack.z < COURT.minZ || jack.z > COURT.maxZ;
  }
  return { forfeitedIds: out, jackOut };
}

export function distance(a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// Step simulation by dt (seconds). Returns true if anything still moves.
// onCollision is called whenever two balls collide, with the relative impact
// speed (useful for sound volume).
export function stepPhysics(
  balls: Ball[],
  jack: Jack | null,
  dt: number,
  onCollision?: (impact: number) => void,
): boolean {
  let moving = false;
  for (const b of balls) {
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    // friction
    const f = Math.pow(COURT.friction, dt * 60);
    b.vx *= f; b.vz *= f;
    // No wall bouncing: balls touching the edge of the terrain are EJECTED
    // outside (forfeit). They continue rolling past the boundary until
    // friction stops them off-court, where detectForfeits() will remove them.
    // stop slow
    const sp = Math.hypot(b.vx, b.vz);
    if (sp < COURT.minSpeed) { b.vx = 0; b.vz = 0; }
    else moving = true;
  }
  // ball-ball collisions (elastic-ish)
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
          if (onCollision) onCollision(Math.abs(dot));
        }
      }
    }
  }
  // jack can be nudged (lighter mass)
  if (jack) {
    for (const b of balls) {
      const dx = jack.x - b.x, dz = jack.z - b.z;
      const d = Math.sqrt(dx*dx + dz*dz);
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

// Compute round score: side with closest ball gets points = #balls closer than opponent's closest
export function computeRoundScore(balls: Ball[], jack: Jack): { winner: "p1" | "p2" | null; points: number } {
  if (!jack || balls.length === 0) return { winner: null, points: 0 };
  const withDist = balls.map(b => ({ owner: b.owner, d: distance(b, jack) })).sort((a, b) => a.d - b.d);
  const winner = withDist[0].owner;
  const opp = winner === "p1" ? "p2" : "p1";
  const oppClosest = withDist.find(x => x.owner === opp);
  if (!oppClosest) return { winner, points: withDist.filter(x => x.owner === winner).length };
  const points = withDist.filter(x => x.owner === winner && x.d < oppClosest.d).length;
  return { winner, points: Math.max(1, points) };
}

// Determine next thrower in a round given remaining balls and last winner of the previous round
// Standard pétanque: after each throw, the side NOT holding the point throws next, until they hold or run out.
export function nextThrower(
  balls: Ball[],
  jack: Jack | null,
  remaining: { p1: number; p2: number },
  lastThrower: "p1" | "p2"
): "p1" | "p2" | null {
  if (remaining.p1 <= 0 && remaining.p2 <= 0) return null;
  if (!jack) return lastThrower; // shouldn't happen
  // Determine who currently holds the point
  const sorted = balls.map(b => ({ owner: b.owner, d: distance(b, jack) })).sort((a, b) => a.d - b.d);
  const holder = sorted[0]?.owner ?? null;
  // The other side throws next, if they still have balls
  const opp: "p1" | "p2" = holder === "p1" ? "p2" : holder === "p2" ? "p1" : (lastThrower === "p1" ? "p2" : "p1");
  if (remaining[opp] > 0) return opp;
  // otherwise the holder/other side keeps throwing
  const other: "p1" | "p2" = opp === "p1" ? "p2" : "p1";
  if (remaining[other] > 0) return other;
  return null;
}