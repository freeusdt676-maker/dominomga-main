export type DominoGameMode = "d120" | "d80" | "hand";

export const DOMINO_TARGET_BY_MODE: Record<DominoGameMode, number> = {
  d120: 120,
  d80: 80,
  hand: 120,
};

export type DominoTileLike = [number, number] | readonly [number, number];

export function getDominoTarget(mode?: string | null): number {
  if (mode === "d80") return DOMINO_TARGET_BY_MODE.d80;
  return DOMINO_TARGET_BY_MODE.d120;
}

export function isDominoGameWin(score: number, mode?: string | null): boolean {
  return Number(score ?? 0) >= getDominoTarget(mode);
}

export function getDominoSoloThreshold(mode?: string | null): number {
  return mode === "d80" ? 40 : 60;
}

export function areDominoOpponentScoresZero(
  opponentScores: Array<number | string | null | undefined>,
): boolean {
  return opponentScores.every((score) => Number(score ?? 0) === 0);
}

export function isDominoSoloWin(
  score: number,
  mode?: string | null,
  opponentScores: Array<number | string | null | undefined> = [],
): boolean {
  return Number(score ?? 0) >= getDominoSoloThreshold(mode)
    && areDominoOpponentScoresZero(opponentScores);
}

export function isDominoDoubleSixOut(lastTile?: DominoTileLike | null, points = 0): boolean {
  return !!lastTile
    && lastTile[0] === 6
    && lastTile[1] === 6
    && Number(points ?? 0) > 0;
}

export function getDominoRoundReason(params: {
  winnerName: string;
  mode?: string | null;
  winnerScore: number;
  points: number;
  reasonOverride?: string;
}): string {
  const { winnerName, mode, winnerScore, points, reasonOverride } = params;
  const target = getDominoTarget(mode);

  if (isDominoGameWin(winnerScore, mode)) {
    return `MANDRESY NY LALAO — ${winnerName} tonga ${target}`;
  }

  if (reasonOverride) return reasonOverride;
  if (points > 0) return `Tour vita — ${winnerName} nahazo +${points} isa`;
  return `Tour vita — ${winnerName}`;
}