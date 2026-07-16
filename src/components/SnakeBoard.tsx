import { useEffect, useMemo, useRef, useState } from "react";
import { DominoTile } from "./DominoTile";
import type { Placed } from "@/lib/dominoEngine";

const SHORT = { xs: 44, sm: 56, md: 72 } as const;
type Sz = keyof typeof SHORT;

type Item = {
  x: number;
  y: number;
  w: number;
  h: number;
  displayA: number;
  displayB: number;
  horizontal: boolean;
  direction: Direction;
};

type Direction = "right" | "left" | "down";

export function SnakeBoard({ board, tileSize = "sm" }: { board: Placed[]; tileSize?: Sz }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 360, h: 240 });
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!wrapRef.current) return;
      setVp({
        w: Math.max(200, wrapRef.current.clientWidth),
        h: Math.max(160, wrapRef.current.clientHeight),
      });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const unit = SHORT[tileSize];
  const long = unit * 2;
  const pad = 12;
  const availW = Math.max(80, vp.w - pad * 2);
  const availH = Math.max(80, vp.h - pad * 2);
  const horizontalRun = useMemo(() => {
    if (board.length <= 4) return Math.max(1, board.length);
    if (vp.w < 420) return 4;
    if (vp.w < 760) return 5;
    return 6;
  }, [board.length, vp.w]);

  const verticalRun = useMemo(() => {
    if (board.length <= horizontalRun + 1) return 1;
    return board.length >= 16 ? 1 : 2;
  }, [board.length, horizontalRun]);

  const { items, bounds } = useMemo(() => {
    if (board.length === 0) {
      return {
        items: [] as Item[],
        bounds: { minX: 0, minY: 0, maxX: long, maxY: long },
      };
    }

    const directions: Direction[] = [];
    let currentDirection: Direction = "right";
    let remaining = board.length;
    let forward = true;

    while (remaining > 0) {
      const segmentLength = Math.min(
        remaining,
        currentDirection === "down" ? verticalRun : horizontalRun,
      );

      for (let i = 0; i < segmentLength; i += 1) directions.push(currentDirection);
      remaining -= segmentLength;
      if (remaining <= 0) break;

      if (currentDirection === "right" || currentDirection === "left") {
        currentDirection = "down";
      } else {
        forward = !forward;
        currentDirection = forward ? "right" : "left";
      }
    }

    let cursorX = 0;
    let cursorY = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    const laidOut: Item[] = board.map((p, i) => {
      const [aa, bb] = p.tile;
      const a = p.flipped ? bb : aa;
      const b = p.flipped ? aa : bb;
      const direction = directions[i] ?? "right";
      const isDouble = a === b;
      const dirHorizontal = direction === "right" || direction === "left";
      // Doubles are placed perpendicular to the run direction to save space.
      const horizontal = isDouble ? !dirHorizontal : dirHorizontal;
      const displayA = direction === "left" ? b : a;
      const displayB = direction === "left" ? a : b;

      const w = horizontal ? long : unit;
      const h = horizontal ? unit : long;

      const x = direction === "right"
        ? cursorX
        : direction === "left"
          ? cursorX - w
          : cursorX - w / 2;
      const y = direction === "down"
        ? cursorY
        : cursorY - h / 2;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);

      // Advance cursor by the size along the direction axis.
      const advance = isDouble ? unit : long;
      if (direction === "right") cursorX += advance;
      else if (direction === "left") cursorX -= advance;
      else cursorY += advance;

      return { x, y, w, h, displayA, displayB, horizontal, direction };
    });

    return {
      items: laidOut,
      bounds: {
        minX: Number.isFinite(minX) ? minX : 0,
        minY: Number.isFinite(minY) ? minY : 0,
        maxX: Number.isFinite(maxX) ? maxX : long,
        maxY: Number.isFinite(maxY) ? maxY : long,
      },
    };
  }, [board, horizontalRun, long, unit, verticalRun]);

  const boundsW = Math.max(long, bounds.maxX - bounds.minX);
  const boundsH = Math.max(long, bounds.maxY - bounds.minY);
  const scale = Math.min(1, availW / boundsW, availH / boundsH);
  const offsetX = (vp.w - boundsW * scale) / 2;
  const offsetY = (vp.h - boundsH * scale) / 2;

  useEffect(() => {
    const next = new Set<string>();
    for (const p of board) next.add(`${p.tile[0]}-${p.tile[1]}`);
    seenRef.current = next;
  }, [board]);

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full overflow-hidden"
    >
      <div className="absolute inset-0">
        {items.map((it, i) => {
          const isHead = i === 0;
          const isTail = i === items.length - 1;
          const placed = board[i];
          const tileKey = placed ? `${placed.tile[0]}-${placed.tile[1]}` : `i-${i}`;
          const isNew = !seenRef.current.has(tileKey);
          // Masombato mijanona MAINTY foana. Ny SISIN'ny vato ihany no
          // miloko: MENA ny vodiny (voalohany) sy MAITSO ny lohany (farany).
          const edge: "red" | "green" | null = isHead ? "red" : isTail ? "green" : null;
          return (
            <div
              key={tileKey}
              className={`absolute ${isNew ? "animate-scale-in" : ""}`}
              style={{
                left: it.x * scale + offsetX,
                top: it.y * scale + offsetY,
                width: it.w * scale,
                height: it.h * scale,
                transition: "left 280ms ease, top 280ms ease, width 200ms ease, height 200ms ease",
                borderRadius: 6,
                transform: `translate(${-bounds.minX * scale}px, ${-bounds.minY * scale}px)`,
              }}
            >
              <DominoTile
                a={it.displayA}
                b={it.displayB}
                size={tileSize}
                horizontal={it.horizontal}
                variant="white"
                fluid
                pipColor="black"
                glow={null}
                edgeColor={edge}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
