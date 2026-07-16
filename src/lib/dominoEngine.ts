// Moteur Domino tsotra: zara 7 piesy isaky ny mpilalao, mametraka raha mifanaraka tendro
export type Tile = [number, number];
export type Placed = { tile: Tile; flipped: boolean };

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

export function buildDeck(): Tile[] {
  const d: Tile[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) d.push([a, b]);
  return d;
}
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function countDoubles(hand: Tile[]): number {
  return hand.reduce((n, [a, b]) => n + (a === b ? 1 : 0), 0);
}

// Lalàna:
//  - 3 double ihany no azo ekena amin'ny vato 7. Raha 4 na mihoatra → averina ny fizarana.
//  - TSY MISY instant win amin'ny double atànana.
const REDEAL_DOUBLES = 4; // 4+ doubles in a 7-tile hand triggers redeal

function dealNeedsRedeal(hands: Tile[][]): boolean {
  return hands.some((h) => countDoubles(h) >= REDEAL_DOUBLES);
}

function shuffleDeckWithSeed(seed?: string): Tile[] {
  const random = seed ? mulberry32(hashSeed(seed)) : Math.random;
  const deck = [...buildDeck()];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function deal(seed?: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const s = seed ? `${seed}#redeal${attempt}` : undefined;
    const deck = shuffleDeckWithSeed(s);
    const p1 = deck.slice(0, 7);
    const p2 = deck.slice(7, 14);
    const boneyard = deck.slice(14);
    if (!dealNeedsRedeal([p1, p2])) return { p1, p2, boneyard };
  }
  const deck = shuffleDeckWithSeed(seed);
  return { p1: deck.slice(0, 7), p2: deck.slice(7, 14), boneyard: deck.slice(14) };
}

export function deal3(seed?: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const s = seed ? `${seed}#redeal${attempt}` : undefined;
    const deck = shuffleDeckWithSeed(s);
    const p1 = deck.slice(0, 7);
    const p2 = deck.slice(7, 14);
    const p3 = deck.slice(14, 21);
    const boneyard = deck.slice(21);
    if (!dealNeedsRedeal([p1, p2, p3])) return { p1, p2, p3, boneyard };
  }
  const deck = shuffleDeckWithSeed(seed);
  return {
    p1: deck.slice(0, 7),
    p2: deck.slice(7, 14),
    p3: deck.slice(14, 21),
    boneyard: deck.slice(21),
  };
}

// Mode-aware opening:
//  - d120: forced double; priority [0,1,2,3] (smallest blank first).
//  - d80:  forced double; priority [6,5,4]   (largest first).
//  - hand: NO forced double — opener (highest-pip player) plays any tile.
// When no qualifying double exists in any hand, we also fall back to free-choice
// opening by the player holding the highest pip tile. `forced` indicates
// whether the returned tile must be played as the opener.
export function chooseOpening(
  hands: Tile[][],
  mode: "d120" | "d80" | "hand",
): { playerIndex: number; tile: Tile; forced: boolean } {
  // Tour rehetra (na d120, d80, na hand): tsy misy double terena.
  // Ny mpilalao manana ny vato lehibe indrindra no manomboka, mametraka izay tiany.
  let best = { playerIndex: 0, tile: hands[0][0], score: -1 };
  for (let i = 0; i < hands.length; i += 1) {
    for (const t of hands[i]) {
      const s = t[0] + t[1];
      if (s > best.score) best = { playerIndex: i, tile: t, score: s };
    }
  }
  return { playerIndex: best.playerIndex, tile: best.tile, forced: false };
}

function tileRank([a, b]: Tile) {
  return a === b ? 100 + a : Math.max(a, b) * 10 + Math.min(a, b);
}

export function chooseStartingPlayer(p1: Tile[], p2: Tile[], player1Id: string, player2Id: string) {
  const bestP1 = p1.reduce((best, tile) => Math.max(best, tileRank(tile)), -1);
  const bestP2 = p2.reduce((best, tile) => Math.max(best, tileRank(tile)), -1);
  return bestP2 > bestP1 ? player2Id : player1Id;
}
export function ends(board: Placed[]): { left: number; right: number } | null {
  if (board.length === 0) return null;
  const first = board[0];
  const last = board[board.length - 1];
  const left = first.flipped ? first.tile[1] : first.tile[0];
  const right = last.flipped ? last.tile[0] : last.tile[1];
  return { left, right };
}
export function canPlace(board: Placed[], tile: Tile): "left" | "right" | "either" | null {
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
export function place(board: Placed[], tile: Tile, side: "left" | "right"): Placed[] {
  const e = ends(board);
  if (!e) return [{ tile, flipped: false }];
  if (side === "left") {
    // ny atsy havia dia tokony hifanaraka amin'ny tendrony havanana an'ny piesy vaovao
    const flipped = tile[1] !== e.left; // raha b !== left, mila avadika mba ny b ho any havanana
    return [{ tile, flipped }, ...board];
  } else {
    const flipped = tile[0] !== e.right;
    return [...board, { tile, flipped }];
  }
}
export function pipsTotal(hand: Tile[]): number {
  return hand.reduce((s, [a, b]) => s + a + b, 0);
}
export function hasMove(hand: Tile[], board: Placed[]): boolean {
  return hand.some((t) => canPlace(board, t) !== null);
}
