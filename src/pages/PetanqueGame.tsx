import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky, Environment, Instances, Instance } from "@react-three/drei";
import * as THREE from "three";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Pause, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Ball, Jack, COURT, distance, stepPhysics, computeRoundScore, nextThrower,
  isJackValid, JACK_VALID, detectForfeits,
} from "@/lib/petanqueEngine";
import { useThemeClass } from "@/hooks/use-theme-class";
import { sfx } from "@/lib/sfx";
import LudoVoiceChat from "@/components/LudoVoiceChat";

type GameRow = {
  id: string;
  player1_id: string;
  player2_id: string | null;
  stake: number;
  status: string;
  current_turn: string | null;
  turn_started_at?: string | null;
  winner_id: string | null;
  score_p1: number;
  score_p2: number;
  round_number: number;
  state: {
    balls: Ball[];
    jack: Jack | null;
    phase: "aim" | "rolling" | "settle" | "throw_jack";
    remaining: { p1: number; p2: number };
    lastThrower?: "p1" | "p2";
  };
};

const TARGET_SCORE = 13;
const BALLS_PER_PLAYER = 4;
const FANI_SCORE = 6; // Si un joueur atteint 6 et l'autre est à 0 => victoire (Fani)
const TURN_LIMIT_MS = 20_000;

function resolveWinnerId(game: Pick<GameRow, "player1_id" | "player2_id">, scoreP1: number, scoreP2: number) {
  if (scoreP1 >= TARGET_SCORE) return game.player1_id;
  if (scoreP2 >= TARGET_SCORE) return game.player2_id;
  if (scoreP1 >= FANI_SCORE && scoreP2 === 0) return game.player1_id;
  if (scoreP2 >= FANI_SCORE && scoreP1 === 0) return game.player2_id;
  return null;
}

/* ---------- 3D Scene Components ---------- */

export function Baobab({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* trunk - thick swollen baobab */}
      <mesh position={[0, 2.2, 0]} castShadow>
        <cylinderGeometry args={[0.95, 1.4, 4.5, 12]} />
        <meshStandardMaterial color="#8b6f47" roughness={0.95} />
      </mesh>
      <mesh position={[0, 4.8, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.9, 0.8, 12]} />
        <meshStandardMaterial color="#7a5f3a" roughness={0.95} />
      </mesh>
      {/* foliage clusters */}
      {[[-0.8, 5.5, 0.3], [0.6, 5.7, -0.4], [0, 6.1, 0.2], [-0.3, 5.3, -0.7], [0.9, 5.4, 0.5]].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} castShadow>
          <sphereGeometry args={[0.75, 10, 10]} />
          <meshStandardMaterial color={i % 2 ? "#3d6b34" : "#4a7d3f"} roughness={0.85} />
        </mesh>
      ))}
      {/* twisted branches */}
      <mesh position={[-0.6, 5.2, 0]} rotation={[0, 0, 0.6]} castShadow>
        <cylinderGeometry args={[0.08, 0.15, 1.2, 6]} />
        <meshStandardMaterial color="#6b5234" />
      </mesh>
      <mesh position={[0.7, 5.1, 0.2]} rotation={[0, 0, -0.7]} castShadow>
        <cylinderGeometry args={[0.08, 0.15, 1.1, 6]} />
        <meshStandardMaterial color="#6b5234" />
      </mesh>
    </group>
  );
}

export function MadagascarFlag() {
  const ref = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 170;
    const ctx = c.getContext("2d")!;
    // white band (left)
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 85, 170);
    // red top, green bottom (right)
    ctx.fillStyle = "#fc3d32"; ctx.fillRect(85, 0, 171, 85);
    ctx.fillStyle = "#007e3a"; ctx.fillRect(85, 85, 171, 85);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useFrame((s) => {
    if (!ref.current) return;
    const g = ref.current.geometry as THREE.PlaneGeometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const time = s.clock.elapsedTime;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const wave = Math.sin(x * 2 + time * 3) * 0.15 * Math.max(0, (x + 1.5) / 3);
      pos.setZ(i, wave);
      void y;
    }
    pos.needsUpdate = true;
  });
  return (
    <group position={[0, 6, -14]}>
      <mesh position={[-1.6, 0, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 7, 8]} />
        <meshStandardMaterial color="#6b5234" />
      </mesh>
      <mesh ref={ref} position={[0, 1.5, 0]} castShadow>
        <planeGeometry args={[3, 2, 24, 16]} />
        <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
    </group>
  );
}

export function Aloalo({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1, 0]} castShadow>
        <boxGeometry args={[0.18, 2, 0.18]} />
        <meshStandardMaterial color="#3d2817" />
      </mesh>
      <mesh position={[0, 2.15, 0]} castShadow>
        <boxGeometry args={[0.35, 0.1, 0.35]} />
        <meshStandardMaterial color="#d4a86a" />
      </mesh>
      <mesh position={[0, 2.4, 0]} castShadow>
        <coneGeometry args={[0.22, 0.5, 6]} />
        <meshStandardMaterial color="#6b3a2a" />
      </mesh>
    </group>
  );
}

export function Court() {
  // Tany mena (terre rouge / latérite malgache) — 100% thème malgache
  const sandTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 1024;
    const ctx = c.getContext("2d")!;
    // Base — dégradé tany mena (latérite des Hautes Terres)
    const grad = ctx.createLinearGradient(0, 0, 0, 1024);
    grad.addColorStop(0, "#a8431f");
    grad.addColorStop(0.5, "#bf5430");
    grad.addColorStop(1, "#8f3618");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 1024, 1024);
    // Grains de terre rouge
    for (let i = 0; i < 16000; i++) {
      const x = Math.random() * 1024, y = Math.random() * 1024;
      const sh = Math.random();
      ctx.fillStyle = sh > 0.92 ? "#3a1608" : sh > 0.7 ? "#6b2a13" : sh > 0.4 ? "#a04220" : "#d97a4f";
      const r = Math.random() * 1.5 + 0.3;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Petits cailloux volcaniques
    for (let i = 0; i < 280; i++) {
      const x = Math.random() * 1024, y = Math.random() * 1024;
      const r = Math.random() * 4.5 + 2;
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath(); ctx.arc(x + 1.5, y + 1.5, r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = ["#3a1f12", "#5c2a18", "#2a1208", "#4a1f10"][Math.floor(Math.random()*4)];
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    }
    // Traces de roulement de boule
    ctx.globalAlpha = 0.1;
    for (let i = 0; i < 35; i++) {
      ctx.strokeStyle = "#5a2010";
      ctx.lineWidth = Math.random() * 2 + 0.5;
      ctx.beginPath();
      const y = Math.random() * 1024;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(256, y + (Math.random()-0.5)*40, 768, y + (Math.random()-0.5)*40, 1024, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.5, 4);
    t.anisotropy = 8;
    return t;
  }, []);
  // Bordure tissée façon lamba / rafia
  const lambaTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#f4ead0"; ctx.fillRect(0, 0, 256, 64);
    // bandes lamba — blanc, rouge, vert (drapeau malgache)
    const bands = [
      { c: "#ffffff", h: 14 },
      { c: "#c8321f", h: 18 },
      { c: "#0d7a3a", h: 18 },
      { c: "#ffffff", h: 14 },
    ];
    let y = 0;
    for (const b of bands) { ctx.fillStyle = b.c; ctx.fillRect(0, y, 256, b.h); y += b.h; }
    // motifs zigzag tissés
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1.2;
    for (let i = 0; i < 256; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i + 4, 64); ctx.stroke();
    }
    // petits losanges
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (let x = 8; x < 256; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 32); ctx.lineTo(x + 4, 28); ctx.lineTo(x + 8, 32); ctx.lineTo(x + 4, 36); ctx.closePath();
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 1);
    return t;
  }, []);
  const grassTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#4a7c3a"; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2000; i++) {
      const x = Math.random()*256, y = Math.random()*256;
      ctx.fillStyle = ["#3d6b2d", "#5c8a48", "#6b9a52"][Math.floor(Math.random()*3)];
      ctx.fillRect(x, y, 1, Math.random()*3+1);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(8, 8);
    return t;
  }, []);
  return (
    <group>
      {/* outer grass ground */}
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -0.01, 4]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial map={grassTex} roughness={1} />
      </mesh>
      {/* sand court */}
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, 0.01, 4.7]} receiveShadow>
        <planeGeometry args={[COURT.maxX - COURT.minX + 0.4, COURT.maxZ - COURT.minZ + 0.4]} />
        <meshStandardMaterial map={sandTex} roughness={0.95} />
      </mesh>
      {/* Tsy misy repère cochonnet — libre ny fanipazana */}
      {/* Bordures tissées style lamba malgache */}
      {[
        { p: [COURT.minX - 0.15, 0.1, 4.7], s: [0.2, 0.2, COURT.maxZ - COURT.minZ + 0.6] },
        { p: [COURT.maxX + 0.15, 0.1, 4.7], s: [0.2, 0.2, COURT.maxZ - COURT.minZ + 0.6] },
        { p: [0, 0.1, COURT.minZ - 0.15], s: [COURT.maxX - COURT.minX + 0.6, 0.2, 0.2] },
        { p: [0, 0.1, COURT.maxZ + 0.15], s: [COURT.maxX - COURT.minX + 0.6, 0.2, 0.2] },
      ].map((b, i) => (
        <mesh key={i} position={b.p as [number, number, number]} castShadow receiveShadow>
          <boxGeometry args={b.s as [number, number, number]} />
          <meshStandardMaterial map={lambaTex} roughness={0.85} metalness={0.02} />
        </mesh>
      ))}
      {/* Corner posts — petits piquets pour cadre pro */}
      {[
        [COURT.minX - 0.15, COURT.minZ - 0.15],
        [COURT.maxX + 0.15, COURT.minZ - 0.15],
        [COURT.minX - 0.15, COURT.maxZ + 0.15],
        [COURT.maxX + 0.15, COURT.maxZ + 0.15],
      ].map((p, i) => (
        <mesh key={`post-${i}`} position={[p[0], 0.22, p[1]]} castShadow>
          <cylinderGeometry args={[0.07, 0.09, 0.42, 10]} />
          <meshStandardMaterial color="#3d2814" roughness={0.7} metalness={0.15} />
        </mesh>
      ))}
    </group>
  );
}

export function Crowd() {
  const data = useMemo(() => {
    const arr: { x: number; z: number; color: string; phase: number }[] = [];
    const palette = ["#c44569", "#f7b733", "#4a90e2", "#7ed321", "#9b59b6", "#e67e22"];
    // left side
    for (let i = 0; i < 8; i++) {
      arr.push({ x: -4 - Math.random()*1.5, z: -1 + i*1.6, color: palette[i % palette.length], phase: Math.random()*Math.PI*2 });
    }
    // right side
    for (let i = 0; i < 8; i++) {
      arr.push({ x: 4 + Math.random()*1.5, z: -1 + i*1.6, color: palette[(i+3) % palette.length], phase: Math.random()*Math.PI*2 });
    }
    return arr;
  }, []);
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    refs.current.forEach((g, i) => {
      if (!g) return;
      const d = data[i];
      g.position.y = Math.sin(t * 1.5 + d.phase) * 0.08;
      g.rotation.y = Math.sin(t * 0.8 + d.phase) * 0.15;
    });
  });
  return (
    <>
      {data.map((d, i) => (
        <group key={i} ref={(el) => (refs.current[i] = el)} position={[d.x, 0, d.z]}>
          {/* body */}
          <mesh position={[0, 0.55, 0]} castShadow>
            <cylinderGeometry args={[0.18, 0.22, 1, 8]} />
            <meshStandardMaterial color={d.color} />
          </mesh>
          {/* head */}
          <mesh position={[0, 1.2, 0]} castShadow>
            <sphereGeometry args={[0.18, 10, 10]} />
            <meshStandardMaterial color="#8b5a3c" />
          </mesh>
          {/* hat */}
          <mesh position={[0, 1.42, 0]}>
            <coneGeometry args={[0.25, 0.18, 8]} />
            <meshStandardMaterial color="#d4a86a" />
          </mesh>
        </group>
      ))}
    </>
  );
}

export function Zebu({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.8, 0.5, 0.35]} />
        <meshStandardMaterial color="#3d2817" />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <sphereGeometry args={[0.18, 8, 8]} />
        <meshStandardMaterial color="#5a3a24" />
      </mesh>
      {/* legs */}
      {[[-0.3,0.1,-0.13],[0.3,0.1,-0.13],[-0.3,0.1,0.13],[0.3,0.1,0.13]].map((p,i)=>(
        <mesh key={i} position={p as [number,number,number]}>
          <cylinderGeometry args={[0.05,0.05,0.3,6]} />
          <meshStandardMaterial color="#2d1b0e" />
        </mesh>
      ))}
    </group>
  );
}

export function BallMesh({ ball, isJack }: { ball: Ball | Jack; isJack?: boolean }) {
  const color = isJack ? "#0a0a0a" : (ball as Ball).owner === "p1" ? "#dc2626" : "#2563eb";
  const r = isJack ? COURT.jackR : COURT.ballR;
  const sphereRef = useRef<any>(null);
  const beaconRef = useRef<any>(null);
  const prevRef = useRef<{ x: number; z: number }>({ x: ball.x, z: ball.z });
  useFrame((_, dt) => {
    // Rolling rotation based on actual displacement (works for both players)
    const dx = ball.x - prevRef.current.x;
    const dz = ball.z - prevRef.current.z;
    prevRef.current = { x: ball.x, z: ball.z };
    if (sphereRef.current && (dx !== 0 || dz !== 0)) {
      // axis perpendicular to motion on ground plane
      const angle = Math.sqrt(dx * dx + dz * dz) / r;
      sphereRef.current.rotation.x += dz / r;
      sphereRef.current.rotation.z -= dx / r;
    }
    // Beacon pulse for jack
    if (isJack && beaconRef.current) {
      const t = performance.now() / 400;
      beaconRef.current.scale.y = 1 + Math.sin(t) * 0.15;
    }
  });
  return (
    <group position={[ball.x, 0, ball.z]}>
      {/* shadow disc on the sand */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
        <circleGeometry args={[r * 1.05, 24]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.32} />
      </mesh>
      <mesh ref={sphereRef} position={[0, r, 0]} castShadow>
        <sphereGeometry args={[r, 28, 28]} />
        <meshStandardMaterial color={color} metalness={isJack ? 0.2 : 0.55} roughness={isJack ? 0.4 : 0.22} />
      </mesh>
      {isJack && (
        <>
          {/* Vertical beacon — visible even when other balls hide the jack */}
          <mesh ref={beaconRef} position={[0, 0.9, 0]} renderOrder={999}>
            <cylinderGeometry args={[0.012, 0.012, 1.8, 8]} />
            <meshBasicMaterial color="#ffeb3b" transparent opacity={0.85} depthTest={false} />
          </mesh>
          {/* Floating marker on top */}
          <mesh position={[0, 1.85, 0]} renderOrder={1000}>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshBasicMaterial color="#ffeb3b" depthTest={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

export function CameraRig() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 5.5, -3.5);
    camera.lookAt(0, 0, 5);
  }, [camera]);
  return null;
}

function AimArrow({ angleDeg, force, visible, jack, isJackPhase }: {
  angleDeg: number; force: number; visible: boolean; jack: Jack | null; isJackPhase: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const landingRef = useRef<THREE.Group>(null);

  // Color gradient: green (faible) → amber → rouge (intense)
  const color = useMemo(() => {
    const t = Math.max(0, Math.min(1, force / 100));
    const c = new THREE.Color();
    if (t < 0.5) c.lerpColors(new THREE.Color("#22ff88"), new THREE.Color("#fbbf24"), t / 0.5);
    else c.lerpColors(new THREE.Color("#fbbf24"), new THREE.Color("#ef4444"), (t - 0.5) / 0.5);
    return c;
  }, [force]);
  const hex = `#${color.getHexString()}`;

  // Target & length
  const targetZ = isJackPhase || !jack ? 6.5 : jack.z;
  const baseLen = Math.max(2.2, Math.min(10, targetZ - -1.3));
  const len = baseLen * (0.3 + (force / 100) * 0.85);
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad) * len;
  const dz = Math.cos(rad) * len;

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (ringRef.current) {
      const sc = 1 + Math.sin(t * 3.2) * 0.08;
      ringRef.current.scale.set(sc, sc, sc);
    }
    if (landingRef.current) {
      const sc = 1 + Math.sin(t * 2.4) * 0.12;
      landingRef.current.scale.set(sc, 1, sc);
    }
  });

  if (!visible) return null;

  return (
    <group ref={groupRef} position={[0, 0.06, -1.3]}>
      {/* Anchor ring at thrower's feet */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.26, 0.4, 48]} />
        <meshBasicMaterial color={hex} transparent opacity={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, 0.48, 48]} />
        <meshBasicMaterial color={hex} transparent opacity={0.35} />
      </mesh>

      {/* Single clean arrow shaft on the ground */}
      <mesh position={[dx / 2, 0.01, dz / 2]} rotation={[-Math.PI / 2, 0, -rad]}>
        <planeGeometry args={[0.18, len]} />
        <meshBasicMaterial color={hex} transparent opacity={0.95} depthWrite={false} />
      </mesh>

      {/* Glowing arrowhead at predicted landing */}
      <mesh position={[dx, 0.08, dz]} rotation={[Math.PI / 2, 0, -rad]}>
        <coneGeometry args={[0.32, 0.7, 24]} />
        <meshStandardMaterial color={hex} emissive={hex} emissiveIntensity={1.8} toneMapped={false} />
      </mesh>

      {/* Landing target marker — pulsing ring on the ground */}
      <group ref={landingRef} position={[dx, 0.01, dz]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.32, 0.42, 48]} />
          <meshBasicMaterial color={hex} transparent opacity={0.95} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
          <ringGeometry args={[0.5, 0.56, 48]} />
          <meshBasicMaterial color={hex} transparent opacity={0.35} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
          <circleGeometry args={[0.07, 24]} />
          <meshBasicMaterial color={hex} />
        </mesh>
      </group>
    </group>
  );
}

/* ---------- Main Page ---------- */

export default function PetanqueGame() {
  useThemeClass("petanque");
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [g, setG] = useState<GameRow | null>(null);
  const [p1Profile, setP1Profile] = useState<any>(null);
  const [p2Profile, setP2Profile] = useState<any>(null);
  const [angle, setAngle] = useState(0);
  const [force, setForce] = useState(50);
  const [throwing, setThrowing] = useState(false);
  const [simBalls, setSimBalls] = useState<Ball[]>([]);
  const [simJack, setSimJack] = useState<Jack | null>(null);
  const simRef = useRef<{ balls: Ball[]; jack: Jack | null } | null>(null);
  const autoThrowRef = useRef<string | null>(null);
  const channelRef = useRef<any>(null);
  const runThrowRef = useRef<((opts: any) => void) | null>(null);
  const lastClackRef = useRef<number>(0);
  // Drag-to-throw gesture state
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const PULL_MAX = 130; // px — tariny moramora ihany dia 100% hery (sotomina makany aloha)

  // Force portrait + fullscreen feel
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    if (!id || !g || g.status !== "in_progress") return;
    const markAbandoned = () => {
      if (document.visibilityState === "hidden") {
        sessionStorage.setItem("petanque_abandoned_game_id", id);
      }
    };
    const markActive = () => {
      if (document.visibilityState === "visible") {
        sessionStorage.removeItem("petanque_abandoned_game_id");
      }
    };
    document.addEventListener("visibilitychange", markAbandoned);
    window.addEventListener("focus", markActive);
    return () => {
      document.removeEventListener("visibilitychange", markAbandoned);
      window.removeEventListener("focus", markActive);
    };
  }, [id, g?.status]);

  // Load game + polling fallback (au cas où le realtime tarde)
  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const { data } = await supabase.from("petanque_games" as any).select("*").eq("id", id).single();
      if (data) setG(data as unknown as GameRow);
    };
    load();
    const ch = supabase.channel(`pg-${id}`, { config: { broadcast: { self: false } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "petanque_games", filter: `id=eq.${id}` },
        (p: any) => { if (p.new) setG(p.new as GameRow); })
      .on("broadcast", { event: "throw" }, ({ payload }: any) => {
        // Mpilalao iray hafa nanatsipy — replay-na eto mba ho hita ny fikodiadian'ny baolina
        runThrowRef.current?.({ ...payload, commit: false });
      })
      .subscribe();
    channelRef.current = ch;
    // Polling de secours toutes les 2s (essentiel pour le matchmaking si realtime ne livre pas)
    const itv = setInterval(load, 2000);
    return () => { supabase.removeChannel(ch); channelRef.current = null; clearInterval(itv); };
  }, [id]);

  useEffect(() => {
    if (!g) return;
    (async () => {
      const ids = [g.player1_id, g.player2_id].filter(Boolean) as string[];
      const { data } = await supabase.from("profiles").select("user_id, mvola_name, avatar_url").in("user_id", ids);
      const m: Record<string, any> = {};
      (data ?? []).forEach((p: any) => { m[p.user_id] = p; });
      setP1Profile(m[g.player1_id]);
      if (g.player2_id) setP2Profile(m[g.player2_id]);
    })();
  }, [g?.player1_id, g?.player2_id]);

  // Settle: maty 13 OR Fani (6-0)
  useEffect(() => {
    if (!g || g.status !== "in_progress") return;
    const winner = resolveWinnerId(g, g.score_p1, g.score_p2);
    if (!winner) return;

    let cancelled = false;
    (async () => {
      const { error } = await supabase.rpc("petanque_settle" as any, { _game_id: g.id, _winner: winner });
      if (error && !cancelled) {
        toast.error("Nisy olana tamin'ny famaranana ny partie");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [g?.id, g?.score_p1, g?.score_p2, g?.status, g?.player1_id, g?.player2_id]);

  const mySide: "p1" | "p2" | null = !g || !user ? null : user.id === g.player1_id ? "p1" : user.id === g.player2_id ? "p2" : null;
  const phase = g?.state?.phase ?? "aim";
  const isJackPhase = phase === "throw_jack";
  const isMyTurn = !!g && g.current_turn === user?.id && (phase === "aim" || phase === "throw_jack");

  // ---- Visible countdown (ticks every 250ms) ----
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!g || g.status !== "in_progress") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [g?.status]);
  const turnStartMs = g?.turn_started_at ? new Date(g.turn_started_at).getTime() : now;
  const elapsed = Math.max(0, now - turnStartMs);
  const remainingMs = Math.max(0, TURN_LIMIT_MS - elapsed);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const timerPct = Math.max(0, Math.min(1, remainingMs / TURN_LIMIT_MS));

  // Local sync: derive simBalls/simJack from g.state unless we're animating a throw
  useEffect(() => {
    if (throwing) return;
    setSimBalls(g?.state?.balls ?? []);
    setSimJack(g?.state?.jack ?? null);
  }, [g?.state, throwing]);

  const runThrow = (opts: {
    thrower: "p1" | "p2";
    angle: number;
    force: number;
    jackPhase: boolean;
    baseBalls: Ball[];
    baseJack: Jack | null;
    ballId?: string;
    commit: boolean;
  }) => {
    const { thrower, angle: a, force: f, jackPhase, baseBalls, baseJack, ballId, commit } = opts;
    setThrowing(true);
    const rad = (a * Math.PI) / 180;
    // Hery mifanaraka amin'ny pull: arakaraka ny halaviran'ny tariny no
    // ialavan'ny baolina. Pull max (100%) = baolina mandeha mihoatra ny
    // halavan'ny terrain (~12m). Scaling exponentielle kely mba haharanitra
    // ny famindra hery.
    const t = Math.max(0, Math.min(1, f / 100));
    const ballSpeedMax = 26;   // m/s — manakatra ny faran'ny terrain mora
    const ballSpeedMin = 5;
    const jackSpeedMax = 22;  // hery lehibe kokoa — cochonnet mety tonga lavitra
    const jackSpeedMin = 3;
    const curve = Math.pow(t, 1.25); // courbe linéaire ~ exposant léger
    const speed = jackPhase
      ? jackSpeedMin + curve * (jackSpeedMax - jackSpeedMin)
      : ballSpeedMin + curve * (ballSpeedMax - ballSpeedMin);
    const vx = Math.sin(rad) * speed;
    const vz = Math.cos(rad) * speed;
    let balls: Ball[];
    let jack: Jack | null;
    if (jackPhase) {
      balls = [];
      jack = { x: 0, z: -1.3 } as Jack;
      (jack as any).vx = vx; (jack as any).vz = vz;
    } else {
      const newBall: Ball = {
        id: ballId ?? `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        owner: thrower,
        x: 0, z: -1.3, vx, vz,
      };
      balls = [...baseBalls.map(b => ({ ...b, vx: 0, vz: 0 })), newBall];
      jack = baseJack ? { ...baseJack } : null;
    }
    simRef.current = { balls, jack };
    const start = performance.now();
    let last = start;
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const sim = simRef.current!;
      let moving = false;
      if (jackPhase && sim.jack) {
        const j: any = sim.jack;
        j.x += (j.vx ?? 0) * dt;
        j.z += (j.vz ?? 0) * dt;
        const fr = Math.pow(COURT.friction, dt * 60);
        j.vx *= fr; j.vz *= fr;
        if (j.x - COURT.jackR < COURT.minX) { j.x = COURT.minX + COURT.jackR; j.vx = -j.vx * COURT.wallRestitution; }
        if (j.x + COURT.jackR > COURT.maxX) { j.x = COURT.maxX - COURT.jackR; j.vx = -j.vx * COURT.wallRestitution; }
        if (j.z - COURT.jackR < COURT.minZ) { j.z = COURT.minZ + COURT.jackR; j.vz = -j.vz * COURT.wallRestitution; }
        if (j.z + COURT.jackR > COURT.maxZ) { j.z = COURT.maxZ - COURT.jackR; j.vz = -j.vz * COURT.wallRestitution; }
        const sp = Math.hypot(j.vx ?? 0, j.vz ?? 0);
        if (sp < COURT.minSpeed) { j.vx = 0; j.vz = 0; } else moving = true;
      } else {
        moving = stepPhysics(sim.balls, sim.jack, dt, (impact) => {
          const nowT = performance.now();
          if (nowT - lastClackRef.current > 60) {
            lastClackRef.current = nowT;
            try { sfx.clack(Math.min(2, impact / 4)); } catch {}
          }
        });
      }
      setSimBalls([...sim.balls]);
      if (sim.jack) setSimJack({ ...sim.jack });
      if (moving && now - start < 5000) {
        requestAnimationFrame(loop);
      } else {
        // Simulation finished: now (and only now) remove balls that came to
        // rest pressed against a wall (forfeit). Mid-flight balls stay visible.
        const { forfeitedIds } = detectForfeits(sim.balls, null);
        if (forfeitedIds.length) {
          sim.balls = sim.balls.filter((b) => !forfeitedIds.includes(b.id));
          setSimBalls([...sim.balls]);
        }
        if (commit) {
          if (jackPhase && sim.jack) {
            finishJackThrow({ x: sim.jack.x, z: sim.jack.z }, thrower).catch((e) => toast.error(e.message));
          } else {
            finishThrow(sim.balls, sim.jack, thrower).catch((e) => toast.error(e.message));
          }
        } else {
          // Remote replay vita — state ny serveur no hifehy
          setThrowing(false);
        }
      }
    };
    requestAnimationFrame(loop);
  };
  runThrowRef.current = runThrow;

  const doThrow = async (overrideAngle?: number, overrideForce?: number) => {
    if (!g || !user || !mySide || throwing) return;
    const remaining = g.state?.remaining ?? { p1: BALLS_PER_PLAYER, p2: BALLS_PER_PLAYER };
    const jackPhase = g.state?.phase === "throw_jack";
    if (!jackPhase && remaining[mySide] <= 0) return toast.error("Tsy manana baolina intsony");
    const a = overrideAngle ?? angle;
    const f = overrideForce ?? force;
    const ballId = `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const baseBalls = g.state?.balls ?? [];
    const baseJack = g.state?.jack ?? null;
    // Broadcast amin'ny mpifanandrina mba hahitany ny fikodiadian'ny baolina LIVE
    try {
      await channelRef.current?.send({
        type: "broadcast",
        event: "throw",
        payload: { thrower: mySide, angle: a, force: f, jackPhase, baseBalls, baseJack, ballId },
      });
    } catch {}
    runThrow({ thrower: mySide, angle: a, force: f, jackPhase, baseBalls, baseJack, ballId, commit: true });
  };

  // Commit the jack position then keep same player on aim phase for first ball throw
  const finishJackThrow = async (jack: Jack, thrower: "p1" | "p2") => {
    if (!g) return;
    // Validation: jack must land in the valid zone, otherwise re-throw by the same player
    if (!isJackValid(jack)) {
      toast.error("Tsy mety ny boul kely (akaiky/lavitra loatra) — atsipy indray");
      await supabase.rpc("petanque_update_state" as any, {
        _game_id: g.id,
        _state: {
          balls: [],
          jack: null,
          phase: "throw_jack",
          remaining: { p1: BALLS_PER_PLAYER, p2: BALLS_PER_PLAYER },
          lastThrower: thrower,
        },
        _current_turn: thrower === "p1" ? g.player1_id : g.player2_id,
        _turn_started_at: new Date().toISOString(),
        _score_p1: g.score_p1,
        _score_p2: g.score_p2,
        _round_number: g.round_number,
      });
      setThrowing(false);
      return;
    }
    const currentTurnUser = thrower === "p1" ? g.player1_id : g.player2_id;
    await supabase.rpc("petanque_update_state" as any, {
      _game_id: g.id,
      _state: {
        balls: [],
        jack,
        phase: "aim",
        remaining: { p1: BALLS_PER_PLAYER, p2: BALLS_PER_PLAYER },
        lastThrower: thrower,
      },
      _current_turn: currentTurnUser,
      _turn_started_at: new Date().toISOString(),
      _score_p1: g.score_p1,
      _score_p2: g.score_p2,
      _round_number: g.round_number,
    });
    setThrowing(false);
  };

  // ---- 20s auto-throw (robot) — any connected player may trigger after server confirms timeout ----
  useEffect(() => {
    if (!g || !user) return;
    if (g.status !== "in_progress") return;
    if (g.state?.phase !== "aim" && g.state?.phase !== "throw_jack") return;
    if (throwing) return;
    const startMs = g.turn_started_at ? new Date(g.turn_started_at).getTime() : Date.now();
    const key = `${g.id}-${g.turn_started_at ?? "0"}-${g.current_turn}`;
    if (autoThrowRef.current === key) return;
    const delay = Math.max(0, TURN_LIMIT_MS - (Date.now() - startMs));
    const t = setTimeout(() => {
      if (autoThrowRef.current === key) return;
      autoThrowRef.current = key;
      (async () => {
        const { data, error } = await supabase.from("petanque_games" as any).select("*").eq("id", g.id).single();
        if (error || !data) {
          autoThrowRef.current = null;
          return;
        }
        const fresh = data as unknown as GameRow;
        if (fresh.status !== "in_progress" || (fresh.state?.phase !== "aim" && fresh.state?.phase !== "throw_jack")) {
          autoThrowRef.current = null;
          return;
        }
        const freshTurnMs = fresh.turn_started_at ? new Date(fresh.turn_started_at).getTime() : 0;
        if (Date.now() - freshTurnMs < TURN_LIMIT_MS) {
          autoThrowRef.current = null;
          return;
        }
        if (!fresh.current_turn || !user || ![fresh.player1_id, fresh.player2_id].includes(user.id)) {
          autoThrowRef.current = null;
          return;
        }
        const throwSide: "p1" | "p2" | null = fresh.current_turn === fresh.player1_id ? "p1" : fresh.current_turn === fresh.player2_id ? "p2" : null;
        if (!throwSide) {
          autoThrowRef.current = null;
          return;
        }
        // Auto jack-throw if needed
        if (fresh.state?.phase === "throw_jack") {
          // Auto-place jack at ~80% du terrain, centré — zone valide garantie
          const jackX = (Math.random() - 0.5) * 0.6;
          const jackZ = 8.0 + Math.random() * 0.6;
          const currentTurnUser = throwSide === "p1" ? fresh.player1_id : fresh.player2_id;
          await supabase.rpc("petanque_update_state" as any, {
            _game_id: fresh.id,
            _state: {
              balls: [],
              jack: { x: jackX, z: jackZ },
              phase: "aim",
              remaining: { p1: BALLS_PER_PLAYER, p2: BALLS_PER_PLAYER },
              lastThrower: throwSide,
            },
            _current_turn: currentTurnUser,
            _turn_started_at: new Date().toISOString(),
            _score_p1: fresh.score_p1,
            _score_p2: fresh.score_p2,
            _round_number: fresh.round_number,
          });
          toast("⏱ 20s tapitra — nataony automatika ny boul kely");
          return;
        }
        // 20s tapitra: mitsipy MAHITSY mankany amin'ny boul kely (cochonnet).
        // Tsy misy random — fanitsanana automatika hiarovana ny fotoana.
        const jk = fresh.state?.jack ?? { x: 0, z: 8 };
        const dxJ = jk.x - 0;
        const dzJ = jk.z - (-1.3);
        const angleRad = Math.atan2(dxJ, dzJ);
        const ba = Math.round((angleRad * 180) / Math.PI);
        // Hery voakajy mba ho akaiky ny cochonnet (mapping inverse de runThrow)
        const dist = Math.hypot(dxJ, dzJ);
        // speed = 4 + (f/100)*11 ; halavin-dalana ≈ speed / (1 - friction^60) → approx tuning
        const targetSpeed = Math.max(5, Math.min(13, 3.6 + dist * 0.95));
        const bf = Math.round(Math.max(35, Math.min(95, ((targetSpeed - 4) / 11) * 100)));
        const remaining = fresh.state?.remaining ?? { p1: BALLS_PER_PLAYER, p2: BALLS_PER_PLAYER };
        if (remaining[throwSide] <= 0) {
          autoThrowRef.current = null;
          return;
        }
        // Animation + broadcast — hahitan'ny mpilalao roa tonta ny fikodiadia
        const baseBalls = fresh.state?.balls ?? [];
        const baseJack = fresh.state?.jack ? { ...fresh.state.jack } : null;
        const ballId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        try {
          await channelRef.current?.send({
            type: "broadcast",
            event: "throw",
            payload: { thrower: throwSide, angle: ba, force: bf, jackPhase: false, baseBalls, baseJack, ballId },
          });
        } catch {}
        // Mametraka g ho mety amin'ny finishThrow (mampiasa g.state)
        runThrowRef.current?.({ thrower: throwSide, angle: ba, force: bf, jackPhase: false, baseBalls, baseJack, ballId, commit: true });
        toast("⏱ 20s tapitra — baolina nialana automatika");
      })().catch(() => {
        autoThrowRef.current = null;
      });
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.current_turn, g?.turn_started_at, g?.state?.phase, g?.status, throwing, mySide, user?.id]);

  const finishThrow = async (finalBalls: Ball[], finalJack: Jack | null, thrower: "p1" | "p2") => {
    if (!g) return;
    const prevRemaining = g.state?.remaining ?? { p1: BALLS_PER_PLAYER, p2: BALLS_PER_PLAYER };
    const remaining = { ...prevRemaining, [thrower]: Math.max(0, prevRemaining[thrower] - 1) };
    const sanitized = finalBalls.map(b => ({ ...b, vx: 0, vz: 0 }));
    let newScoreP1 = g.score_p1;
    let newScoreP2 = g.score_p2;
    let newRound = g.round_number;
    let newPhase: "aim" | "settle" | "throw_jack" = "aim";
    let nextTurnUser: string | null = null;
    let newBalls = sanitized;
    let newJack = finalJack;
    let newRemaining = remaining;

    if (remaining.p1 <= 0 && remaining.p2 <= 0 && finalJack) {
      // round done — compute score
      const r = computeRoundScore(sanitized, finalJack);
      if (r.winner === "p1") newScoreP1 += r.points;
      if (r.winner === "p2") newScoreP2 += r.points;
      newRound += 1;
      const winnerId = resolveWinnerId(g, newScoreP1, newScoreP2);

      if (winnerId) {
        const finalState = {
          balls: sanitized,
          jack: finalJack,
          phase: "settle" as const,
          remaining,
          lastThrower: thrower,
        };

        const { error: updateError } = await supabase.rpc("petanque_update_state" as any, {
          _game_id: g.id,
          _state: finalState,
          _current_turn: null,
          _turn_started_at: new Date().toISOString(),
          _score_p1: newScoreP1,
          _score_p2: newScoreP2,
          _round_number: newRound,
        });

        if (updateError) {
          setThrowing(false);
          toast.error(updateError.message);
          return;
        }

        const { error: settleError } = await supabase.rpc("petanque_settle" as any, {
          _game_id: g.id,
          _winner: winnerId,
        });

        setThrowing(false);

        if (settleError) {
          toast.error(settleError.message);
          return;
        }

        toast.success("Vita ny partie — misy nahatratra 13");
        return;
      }

      // Reset for next round — winner throws the jack first
      newBalls = [];
      newJack = null;
      newRemaining = { p1: BALLS_PER_PLAYER, p2: BALLS_PER_PLAYER };
      newPhase = "throw_jack";
      // Winner of the round throws the jack to start the next one
      nextTurnUser = r.winner === "p1" ? g.player1_id : g.player2_id;
      // 🎉 Applause + bravo when a side actually scores points
      if (r.points > 0) {
        try { sfx.applause(); } catch {}
      }
      toast.success(`Round ${g.round_number}: +${r.points} ho an'ny ${r.winner === "p1" ? "Mena" : "Manga"}`);
    } else {
      const nx = nextThrower(sanitized, finalJack, remaining, thrower);
      if (nx) nextTurnUser = nx === "p1" ? g.player1_id : g.player2_id;
      else nextTurnUser = thrower === "p1" ? g.player2_id : g.player1_id;
    }

    const newState = {
      balls: newBalls,
      jack: newJack,
      phase: newPhase,
      remaining: newRemaining,
      lastThrower: thrower,
    };
    await supabase.rpc("petanque_update_state" as any, {
      _game_id: g.id,
      _state: newState,
      _current_turn: nextTurnUser,
      _turn_started_at: new Date().toISOString(),
      _score_p1: newScoreP1,
      _score_p2: newScoreP2,
      _round_number: newRound,
    });
    setThrowing(false);
  };

  if (!g) return (
    <div className="min-h-screen flex items-center justify-center bg-emerald-950">
      <Loader2 className="animate-spin text-emerald-300" />
    </div>
  );

  if (g.status === "finished") {
    const winName = g.winner_id === g.player1_id ? p1Profile?.mvola_name : p2Profile?.mvola_name;
    return <FinishedScreen winName={winName} g={g} userId={user?.id} onLeave={() => nav("/petanque")} />;
  }

  if (g.status === "waiting") {
    const isHost = user?.id === g.player1_id;
    const cancel = async () => {
      const { error } = await supabase.rpc("petanque_cancel_waiting" as any, { _game_id: g.id });
      if (error) return toast.error(error.message);
      toast("Nesorina");
      nav("/petanque");
    };
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-5 text-center"
        style={{ background: "linear-gradient(180deg,#0a2e1c 0%,#021008 100%)" }}>
        <Loader2 className="w-10 h-10 animate-spin text-emerald-300" />
        <h2 className="text-2xl font-bold text-emerald-200">Miandry mpifanandrina...</h2>
        <p className="text-emerald-100/80 text-sm">
          Mise: <b>{g.stake} Ar</b> · Pétanque 2P
        </p>
        <p className="text-emerald-100/50 text-xs max-w-xs">
          Hita amin'ny lobby ny mise nataonao. Raha misy mpilalao miditra dia hanomboka avy hatrany.
        </p>
        <div className="flex gap-3 mt-2">
          <Button variant="outline" onClick={() => nav("/petanque")} className="border-emerald-500/40 text-emerald-100">
            <ArrowLeft className="w-4 h-4 mr-1" /> Miverina any amin'ny Lobby
          </Button>
          {isHost && (
            <Button variant="destructive" onClick={cancel}>Annuler ny mise</Button>
          )}
        </div>
      </div>
    );
  }

  const remaining = g.state?.remaining ?? { p1: BALLS_PER_PLAYER, p2: BALLS_PER_PLAYER };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden touch-none select-none">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping }}
        camera={{ fov: 55, near: 0.1, far: 100 }}
      >
        <Suspense fallback={null}>
          <CameraRig />
          <Sky distance={450000} sunPosition={[5, 8, 5]} inclination={0.5} azimuth={0.25} />
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[6, 12, 4]}
            intensity={1.25}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-near={1}
            shadow-camera-far={30}
            shadow-camera-left={-12}
            shadow-camera-right={12}
            shadow-camera-top={12}
            shadow-camera-bottom={-12}
            shadow-bias={-0.0005}
          />
          <hemisphereLight args={["#cfe7ff", "#3a5a3a", 0.45]} />

          <Court />
          <Baobab position={[-5.5, 0, 3]} />
          <Baobab position={[5.5, 0, 3]} />
          <Baobab position={[-7, 0, 8]} />
          <Baobab position={[7, 0, 8]} />
          <MadagascarFlag />
          <Aloalo position={[-2.6, 0, 0]} />
          <Aloalo position={[2.6, 0, 0]} />
          <Aloalo position={[-2.6, 0, 10]} />
          <Aloalo position={[2.6, 0, 10]} />
          <Zebu position={[-4.5, 0, 10]} />
          <Zebu position={[4.2, 0, 10.5]} />
          <Crowd />

          {simJack && <BallMesh ball={simJack} isJack />}
          {simBalls.map((b) => <BallMesh key={b.id} ball={b} />)}

          <AimArrow
            angleDeg={angle}
            force={force}
            visible={isMyTurn && !throwing}
            jack={simJack}
            isJackPhase={isJackPhase}
          />

          <Environment preset="park" />
          <fog attach="fog" args={["#bde0ff", 18, 45]} />
        </Suspense>
      </Canvas>

      {/* Top overlay — solaitra mainty be zaraina roa */}
      <div className="absolute top-0 left-0 right-0 bg-black/90 backdrop-blur-md border-b-2 border-white/15 shadow-2xl pointer-events-auto">
        <div className="flex items-stretch">
          <PlayerHalf
            name={p1Profile?.mvola_name ?? "Mpilalao 1"}
            avatarUrl={p1Profile?.avatar_url}
            score={g.score_p1}
            remaining={remaining.p1}
            color="#dc2626"
            active={g.current_turn === g.player1_id}
            side="left"
          />
          <div className="flex flex-col items-center justify-center px-2 py-2 border-x border-white/15 min-w-[88px]">
            <div className="text-[9px] text-white/60 tracking-widest font-semibold">ROUND {g.round_number}</div>
            <div className="text-3xl font-black text-white leading-none my-0.5">{g.score_p1}<span className="text-white/40 mx-1">:</span>{g.score_p2}</div>
            <div className="text-[9px] text-white/50 font-semibold">MATY {TARGET_SCORE} · FANI {FANI_SCORE}-0</div>
            <button
              onClick={() => nav("/")}
              className="mt-1.5 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center"
              aria-label="Hiala"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
          <PlayerHalf
            name={p2Profile?.mvola_name ?? "Miandry..."}
            avatarUrl={p2Profile?.avatar_url}
            score={g.score_p2}
            remaining={remaining.p2}
            color="#2563eb"
            active={g.current_turn === g.player2_id}
            side="right"
          />
        </div>
        {/* ---- Visible 20s timer bar ---- */}
        <div className="px-2 pb-1.5">
          <div className="flex items-center gap-2">
            <div
              className={`text-[11px] font-black tabular-nums ${
                remainingSec <= 5 ? "text-red-400 animate-pulse" : remainingSec <= 10 ? "text-amber-300" : "text-emerald-300"
              }`}
              style={{ minWidth: 28 }}
            >
              {remainingSec}s
            </div>
            <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-200 ease-linear"
                style={{
                  width: `${timerPct * 100}%`,
                  background:
                    remainingSec <= 5
                      ? "linear-gradient(90deg,#ef4444,#fb7185)"
                      : remainingSec <= 10
                      ? "linear-gradient(90deg,#f59e0b,#fbbf24)"
                      : "linear-gradient(90deg,#10b981,#34d399)",
                }}
              />
            </div>
            <div className="text-[9px] text-white/60 font-semibold uppercase tracking-wider">
              {isMyTurn ? "Anjaranao" : "Mpifanandrina"}
            </div>
          </div>
        </div>
      </div>

      {/* Retour button — sortie sécurisée */}
      <button
        onClick={() => nav("/petanque")}
        className="absolute top-24 left-3 z-30 px-3 h-10 rounded-full bg-black/70 backdrop-blur border border-white/30 flex items-center gap-1.5 text-white text-xs font-bold shadow-xl hover:bg-black/85"
      >
        <ArrowLeft className="w-4 h-4" /> Retour
      </button>

      {/* Voice chat — Agora RTC */}
      {g.status === "in_progress" && (
        <div className="absolute top-24 right-3 z-30">
          <LudoVoiceChat gameId={g.id} />
        </div>
      )}

      {/* Drag-to-throw pad — toy ny mitarika tady */}
      {isMyTurn && !throwing && (
        <div
          className="absolute bottom-0 left-0 right-0 h-[42%] touch-none select-none"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            dragStart.current = { x: e.clientX, y: e.clientY };
            setDrag({ dx: 0, dy: 0 });
          }}
          onPointerMove={(e) => {
            if (!dragStart.current) return;
            const dx = e.clientX - dragStart.current.x;
            const dy = e.clientY - dragStart.current.y;
            setDrag({ dx, dy });
            // Sotomina MIAKATRA (manaraka ny fléchés mankany aloha) — dy < 0 = hery bebe kokoa
            const pull = Math.max(0, Math.min(PULL_MAX, -dy));
            setForce(Math.round(8 + (pull / PULL_MAX) * 92));
            setAngle(Math.max(-35, Math.min(35, -dx / 4)));
          }}
          onPointerUp={() => {
            if (!dragStart.current) { setDrag(null); return; }
            const d = drag;
            dragStart.current = null;
            setDrag(null);
            if (!d) return;
            const pull = Math.max(0, Math.min(PULL_MAX, -d.dy));
            if (pull < 18) return; // tariny kely loatra — tsy alefa
            const f = Math.round(8 + (pull / PULL_MAX) * 92);
            const a = Math.max(-35, Math.min(35, -d.dx / 4));
            void doThrow(a, f);
          }}
          onPointerCancel={() => { dragStart.current = null; setDrag(null); }}
        >
          {/* HUD readout */}
          <div className="absolute top-2 left-0 right-0 flex justify-center pointer-events-none">
            <div className="bg-black/70 backdrop-blur px-4 py-1.5 rounded-full border border-emerald-400/40 flex items-center gap-3 text-xs font-bold">
              <span className="text-emerald-200">Tady: <span className="text-white">{angle}°</span></span>
              <span className="w-px h-3 bg-white/30" />
              <span className="text-emerald-200">Hery: <span className="text-white">{force}%</span></span>
            </div>
          </div>
          {/* Drag handle visual */}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-20 pointer-events-none">
            <div
              className="w-16 h-16 rounded-full shadow-2xl"
              style={{
                background: `radial-gradient(circle at 35% 30%, ${mySide === "p1" ? "#ff6b6b" : "#60a5fa"}, ${mySide === "p1" ? "#991b1b" : "#1e3a8a"})`,
                transform: drag ? `translate(${drag.dx}px, ${-Math.max(0, Math.min(PULL_MAX, -drag.dy))}px)` : "none",
                transition: drag ? "none" : "transform 240ms ease-out",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5), inset -4px -6px 12px rgba(0,0,0,0.35), inset 4px 4px 10px rgba(255,255,255,0.35)",
              }}
            />
            {/* tension line */}
            {drag && (drag.dy < 0) && (
              <svg className="absolute top-8 left-8 overflow-visible pointer-events-none" width="1" height="1">
                <line
                  x1={0} y1={0}
                  x2={drag.dx} y2={-Math.max(0, Math.min(PULL_MAX, -drag.dy))}
                  stroke="rgba(34,255,102,0.9)" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray="6 4"
                />
              </svg>
            )}
          </div>
          {/* Hint */}
          {!drag && (
            <div className="absolute bottom-2 left-0 right-0 text-center pointer-events-none">
              <span className="inline-block px-4 py-2 rounded-full bg-emerald-500/85 text-emerald-950 font-bold text-xs shadow-lg">
                {isJackPhase
                  ? "⚫ Sotomina makany ALOHA ny fléchés hatsipy ny boul kely"
                  : "⬆️ Sotomina makany ALOHA ny fléchés — arakaraka ny halaviny no halaviny ny baolina"}
              </span>
            </div>
          )}
        </div>
      )}

      {throwing && (
        <div className="absolute bottom-24 left-0 right-0 text-center">
          <span className="inline-block px-4 py-2 rounded-full bg-emerald-500/90 text-emerald-950 font-bold text-sm">Mandeha ny baolina...</span>
        </div>
      )}

      {!isMyTurn && !throwing && g.status === "in_progress" && (
        <div className="absolute bottom-24 left-0 right-0 text-center">
          <span className="inline-block px-4 py-2 rounded-full bg-black/60 text-white font-semibold text-sm border border-white/20">
            Andrasana ny mpilalao iray hafa...
          </span>
        </div>
      )}
    </div>
  );
}

function PlayerHalf({ name, avatarUrl, score, remaining, color, active, side }: {
  name: string; avatarUrl?: string | null; score: number; remaining: number; color: string; active: boolean; side: "left" | "right";
}) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase();
  const thrown = Math.max(0, BALLS_PER_PLAYER - remaining);
  // Tabilao kely: 4 boules — efa natsipy (matt) sy mbola an-tanana (mamiratra)
  const boules = (
    <div className={`flex items-center gap-1.5 ${side === "right" ? "flex-row-reverse" : ""}`}>
      <div className={`flex gap-0.5 ${side === "right" ? "flex-row-reverse" : ""}`}>
        {Array.from({ length: BALLS_PER_PLAYER }).map((_, i) => {
          const inHand = i < remaining;
          return (
            <div
              key={i}
              className="w-2.5 h-2.5 rounded-full"
              style={{
                background: inHand
                  ? `radial-gradient(circle at 35% 30%, ${color}, #0a0a0a 85%)`
                  : "rgba(255,255,255,0.08)",
                border: inHand ? "1px solid rgba(255,255,255,0.35)" : "1px dashed rgba(255,255,255,0.25)",
                boxShadow: inHand ? `0 0 4px ${color}80` : "none",
              }}
            />
          );
        })}
      </div>
      <span className="text-[9px] font-bold text-white/70 tabular-nums">
        {thrown}/<span className="text-white">{BALLS_PER_PLAYER}</span>
      </span>
    </div>
  );
  const avatar = (
    <div
      className={`relative w-12 h-12 rounded-full shrink-0 overflow-hidden border-2 ${
        active ? "border-emerald-300 shadow-md shadow-emerald-300/40" : "border-white/25"
      }`}
      style={{ background: `radial-gradient(circle at 30% 30%, ${color}dd, ${color}55)` }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white font-black text-lg">{initial}</div>
      )}
      {active && <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />}
    </div>
  );
  return (
    <div className={`flex-1 px-2.5 py-2 flex items-center gap-2 ${side === "right" ? "flex-row-reverse text-right" : "text-left"}`}>
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-white/90 font-bold truncate">{name}</div>
        <div className="text-2xl font-black text-white leading-none">{score}</div>
        <div className="mt-1">{boules}</div>
      </div>
    </div>
  );
}

function FinishedScreen({ winName, g, userId, onLeave }: {
  winName: string | undefined; g: GameRow; userId: string | undefined; onLeave: () => void;
}) {
  const isWinner = !!userId && g.winner_id === userId;
  const gain = Math.round(g.stake * 1.8); // (stake - 10%) * 2
  useEffect(() => {
    try { sfx.win(); } catch {}
    try { sfx.applause(); } catch {}
    const t = setTimeout(onLeave, 6000);
    return () => clearTimeout(t);
  }, []);
  // 24 fireworks particles
  const particles = Array.from({ length: 24 }).map((_, i) => ({
    left: `${10 + Math.random() * 80}%`,
    top: `${10 + Math.random() * 60}%`,
    delay: `${(i % 6) * 0.25}s`,
    color: ["#fde047", "#f97316", "#ef4444", "#22d3ee", "#a78bfa", "#34d399"][i % 6],
  }));
  return (
    <div className="fixed inset-0 overflow-hidden bg-gradient-to-b from-emerald-900 via-emerald-950 to-black flex flex-col items-center justify-center p-6 gap-4 text-center">
      <style>{`
        @keyframes pet-firework { 0%{transform:translate(-50%,-50%) scale(0);opacity:1} 60%{opacity:1} 100%{transform:translate(-50%,-50%) scale(8);opacity:0} }
        @keyframes pet-fall { 0%{transform:translateY(-30px);opacity:0} 20%{opacity:1} 100%{transform:translateY(110vh);opacity:0} }
        @keyframes pet-pop { 0%{transform:scale(0)} 60%{transform:scale(1.15)} 100%{transform:scale(1)} }
      `}</style>
      {/* Fireworks bursts */}
      {particles.map((p, i) => (
        <span key={i} className="absolute pointer-events-none rounded-full"
          style={{
            left: p.left, top: p.top, width: 14, height: 14, background: p.color,
            boxShadow: `0 0 24px 6px ${p.color}`,
            animation: `pet-firework 1.8s ${p.delay} ease-out infinite`,
          }}
        />
      ))}
      {/* Confetti rain */}
      {Array.from({ length: 30 }).map((_, i) => (
        <span key={`c${i}`} className="absolute pointer-events-none"
          style={{
            left: `${Math.random() * 100}%`, top: -20,
            width: 8, height: 14,
            background: ["#fde047", "#f97316", "#ef4444", "#22d3ee", "#a78bfa", "#34d399"][i % 6],
            transform: `rotate(${Math.random() * 360}deg)`,
            animation: `pet-fall ${2 + Math.random() * 2}s ${Math.random() * 1.5}s linear infinite`,
          }}
        />
      ))}
      <div className="relative z-10 flex flex-col items-center gap-3" style={{ animation: "pet-pop 600ms cubic-bezier(.2,1.3,.4,1) both" }}>
        <div className="text-6xl">{isWinner ? "🏆" : "🎯"}</div>
        <h2 className="text-4xl font-black text-emerald-200 drop-shadow-lg">
          {isWinner ? "Nandresy ianao!" : "Vita ny lalao"}
        </h2>
        <p className="text-emerald-100 text-lg">
          {isWinner ? "Arahabaina!" : <>Nandresy: <b>{winName ?? "?"}</b></>}
        </p>
        <div className="text-emerald-200/80 text-base font-bold">
          {g.score_p1} — {g.score_p2}
        </div>
        {isWinner && (
          <div className="mt-2 px-6 py-4 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-600 text-amber-950 font-black shadow-2xl border-2 border-amber-200">
            <div className="text-xs uppercase tracking-wider opacity-80">Gain</div>
            <div className="text-3xl">+{gain.toLocaleString()} Ar</div>
            <div className="text-[10px] mt-1 opacity-80">Tafiditra ao amin'ny wallet</div>
          </div>
        )}
        <p className="text-emerald-300/60 text-xs mt-3">Hiverina any amin'ny lobby…</p>
        <Button onClick={onLeave} className="mt-1 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold">
          Miverina izao
        </Button>
      </div>
    </div>
  );
}