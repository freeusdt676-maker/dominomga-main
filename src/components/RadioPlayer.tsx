import { useEffect, useRef, useState } from "react";
import { Music2, Pause } from "lucide-react";
import trackAsset from "@/assets/domino-mga-musique.mp3.asset.json";

const TRACK_TITLE = "Domino mga musique";

export function RadioPlayer() {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const a = new Audio(trackAsset.url);
    a.loop = true;
    a.volume = 0.4;
    a.preload = "none";
    audioRef.current = a;
    const onEnd = () => setPlaying(false);
    a.addEventListener("ended", onEnd);
    return () => {
      a.pause();
      a.removeEventListener("ended", onEnd);
      audioRef.current = null;
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      const start = () => {
        const dur = Number.isFinite(a.duration) && a.duration > 10 ? a.duration : 0;
        if (dur > 0) {
          try {
            a.currentTime = Math.random() * (dur - 5);
          } catch {
            // ignore seek errors
          }
        }
        a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      };
      if (a.readyState >= 1 && Number.isFinite(a.duration) && a.duration > 0) {
        start();
      } else {
        const onMeta = () => {
          a.removeEventListener("loadedmetadata", onMeta);
          start();
        };
        a.addEventListener("loadedmetadata", onMeta);
        a.preload = "metadata";
        a.load();
      }
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="absolute left-1/2 -translate-x-1/2 -bottom-2 z-30 flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-[#d4af37]/60 bg-gradient-to-b from-[#1a0f08]/80 to-[#0b1a10]/80 shadow-[0_2px_6px_rgba(0,0,0,0.4)] backdrop-blur"
      title={playing ? "Ajanono ny hira" : "Henoy ny hira"}
      aria-label={TRACK_TITLE}
    >
      {playing ? (
        <Pause className="w-2.5 h-2.5 text-[#ffe27a]" />
      ) : (
        <Music2 className="w-2.5 h-2.5 text-[#ffe27a]" />
      )}
      <span className={`text-[8px] font-bold tracking-tight text-[#ffe27a] ${playing ? "animate-pulse" : ""}`}>
        {TRACK_TITLE}
      </span>
    </button>
  );
}
