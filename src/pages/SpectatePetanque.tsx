import { Suspense, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Radio, Hash, Loader2 } from "lucide-react";
import { Canvas } from "@react-three/fiber";
import { Sky, Environment } from "@react-three/drei";
import * as THREE from "three";
import { type Ball, type Jack } from "@/lib/petanqueEngine";
import {
  Baobab, MadagascarFlag, Aloalo, Court, Crowd, Zebu, BallMesh, CameraRig,
} from "./PetanqueGame";
import SpectatorWinner from "@/components/SpectatorWinner";

type Snap = {
  id: string;
  ticket: string | null;
  status: string;
  state: {
    balls: Ball[];
    jack: Jack | null;
    phase: string;
    remaining: { p1: number; p2: number };
  };
  current_turn: string | null;
  score_p1: number;
  score_p2: number;
  round: number;
  p1_id: string | null;
  p2_id: string | null;
  p1_name: string | null;
  p2_name: string | null;
};

/** 3D top-down view of the pétanque court for spectators — mitovy amin'ny lalao tena izy */
function Court3DSpectator({ balls, jack }: { balls: Ball[]; jack: Jack | null }) {
  return (
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
        {jack && <BallMesh ball={jack as any} isJack />}
        {balls.map((b) => <BallMesh key={b.id} ball={b} />)}
        <Environment preset="park" />
        <fog attach="fog" args={["#bde0ff", 18, 45]} />
      </Suspense>
    </Canvas>
  );
}

export default function SpectatePetanque() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Snap | null>(null);
  const [missing, setMissing] = useState(false);
  const [lastSnap, setLastSnap] = useState<Snap | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = async () => {
      const { data } = await (supabase.rpc as any)("spectator_get", { _game: "petanque", _id: id });
      if (!alive) return;
      if (!data) { setMissing(true); setS(null); return; }
      setMissing(false);
      setS(data as Snap);
      setLastSnap(data as Snap);
    };
    load();
    const t = window.setInterval(load, 1500);
    return () => { alive = false; window.clearInterval(t); };
  }, [id]);

  if (missing && lastSnap) {
    const ranking = [
      { name: lastSnap.p1_name ?? "P1", score: Number(lastSnap.score_p1 ?? 0) },
      { name: lastSnap.p2_name ?? "P2", score: Number(lastSnap.score_p2 ?? 0) },
    ];
    return <SpectatorWinner ranking={ranking} />;
  }

  return (
    <div className="fixed inset-0 bg-black flex flex-col overflow-hidden">
      <header className="relative z-20 flex items-center justify-between p-3 bg-black/70 backdrop-blur border-b border-primary/20">
        <Link to="/" className="flex items-center gap-2 text-sm text-foreground">
          <ArrowLeft className="w-5 h-5" /> <span className="text-base font-bold">Hiverina</span>
        </Link>
        <div className="flex items-center gap-2 text-base">
          <Radio className="w-5 h-5 text-red-500 animate-pulse" />
          <span className="font-extrabold text-red-500 text-lg tracking-widest">LIVE</span>
          <span className="text-muted-foreground">·</span>
          <Hash className="w-4 h-4 text-primary" />
          <span className="font-mono font-extrabold text-base">
            {s?.ticket ?? id?.replace(/-/g, "").slice(-6).toUpperCase()}
          </span>
        </div>
        <div className="w-20 text-right text-xs font-bold text-muted-foreground italic">Spectateur</div>
      </header>

      {missing && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground italic z-10">
          Tsy misy lalao mandeha amin'io tick io intsony
        </div>
      )}
      {!missing && !s && (
        <div className="flex-1 flex items-center justify-center z-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      )}

      {s && (
        <>
          {/* 3D scene plein-écran derrière l'overlay */}
          <div className="absolute inset-0 z-0">
            <Court3DSpectator balls={s.state?.balls ?? []} jack={s.state?.jack ?? null} />
          </div>

          {/* Overlay score haut */}
          <div className="relative z-10 grid grid-cols-2 gap-2 p-3 pointer-events-none">
            {[
              { name: s.p1_name ?? "P1", score: s.score_p1, id: s.p1_id, color: "#dc2626", rem: s.state?.remaining?.p1 ?? 0 },
              { name: s.p2_name ?? "P2", score: s.score_p2, id: s.p2_id, color: "#2563eb", rem: s.state?.remaining?.p2 ?? 0 },
            ].map((p, i) => {
              const active = p.id && s.current_turn === p.id;
              return (
                <div key={i} className={`p-3 rounded-xl border-2 ${active ? "border-primary" : "border-primary/30"} bg-black/70 backdrop-blur`}>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-4 h-4 rounded-full" style={{ background: p.color, boxShadow: `0 0 10px ${p.color}` }} />
                    <span className="text-base font-extrabold truncate flex-1 text-white">{p.name}</span>
                    <span className="font-display text-3xl gold-text">{p.score}</span>
                  </div>
                  <div className="text-xs text-white/70 mt-1 font-bold">Boules sisa: {p.rem}</div>
                </div>
              );
            })}
          </div>

          <div className="relative z-10 mt-auto text-center text-sm text-white/90 font-bold bg-black/60 backdrop-blur py-2">
            Round #{s.round} · phase: {s.state?.phase ?? "—"}
          </div>
        </>
      )}
    </div>
  );
}