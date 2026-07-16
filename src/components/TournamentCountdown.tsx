import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Trophy } from "lucide-react";

type GT = "domino" | "ludo" | "petanque";
const LABELS: Record<GT, string> = { domino: "Domino", ludo: "Ludo", petanque: "Pétanque" };
const CAPACITY = 8;

type Reg = { nom: string; group_letter?: string | null };
type Item = {
  gt: GT;
  qf_at: string;
  status: string;
  count: number;
  registrations: Reg[];
};

function fmtRemaining(ms: number) {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}J`);
  if (d || h) parts.push(`${h}h`);
  parts.push(`${m}min`);
  parts.push(`${sec}s`);
  return parts.join(" ");
}

function fmtMG(iso: string) {
  const mg = new Date(new Date(iso).getTime() + 3 * 3600_000);
  const days = ["Alahady", "Alatsinainy", "Talata", "Alarobia", "Alakamisy", "Zoma", "Sabotsy"];
  return `${days[mg.getUTCDay()]} ${String(mg.getUTCDate()).padStart(2, "0")}/${String(mg.getUTCMonth() + 1).padStart(2, "0")}/${mg.getUTCFullYear()} • ${String(mg.getUTCHours()).padStart(2, "0")}:${String(mg.getUTCMinutes()).padStart(2, "0")}`;
}

export default function TournamentCountdown() {
  const [items, setItems] = useState<Item[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const load = async () => {
      const gts: GT[] = ["domino", "ludo", "petanque"];
      const results = await Promise.all(
        gts.map(async (gt) => {
          const { data } = await supabase.rpc("tournament_get_current" as any, { _game_type: gt });
          const d = data as any;
          const t = d?.tournament;
          if (!t?.qf_at) return null;
          return {
            gt,
            qf_at: t.qf_at,
            status: t.status,
            count: Number(d?.count ?? (d?.registrations?.length ?? 0)),
            registrations: (d?.registrations ?? []) as Reg[],
          } as Item;
        }),
      );
      setItems(results.filter(Boolean) as any);
    };
    load();
    const itv = setInterval(load, 60_000);
    return () => clearInterval(itv);
  }, []);

  useEffect(() => {
    const itv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(itv);
  }, []);

  const upcoming = items.filter((i) => i.status !== "finished" && i.status !== "cancelled");
  if (upcoming.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {upcoming.map((it) => {
        const ms = new Date(it.qf_at).getTime() - now;
        const live = ms <= 0 || it.status === "running";
        const full = it.count >= CAPACITY;
        const openReg = !live && !full && it.status === "registration";
        const groups: Record<string, string[]> = {};
        it.registrations.forEach((r) => {
          const g = (r.group_letter || "?").toUpperCase();
          (groups[g] = groups[g] || []).push(r.nom);
        });
        const groupKeys = Object.keys(groups).sort();
        return (
          <Link
            to="/tournament"
            key={it.gt}
            className={`block rounded-lg border bg-gradient-to-r from-black/70 via-red-950/40 to-black/70 px-3 py-2 shadow-[0_0_10px_-3px_rgba(239,68,68,0.4)] ${
              live ? "border-red-500/80 animate-pulse" : "border-red-500/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <Trophy className="w-3.5 h-3.5 text-red-300 shrink-0" />
              <p className="text-[9px] tracking-[0.22em] uppercase text-red-200 font-bold truncate flex-1">
                Tornoi du Semaine · {LABELS[it.gt]}
              </p>
              {live ? (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-600 text-white shrink-0">
                  🔴 EN DIRECT
                </span>
              ) : full ? (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-200 shrink-0">
                  Fermé · Feno {CAPACITY}/{CAPACITY}
                </span>
              ) : openReg ? (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-600 text-white shrink-0">
                  Misokatra {it.count}/{CAPACITY}
                </span>
              ) : null}
            </div>

            {!live && (
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-[10px] text-red-200/80 truncate">{fmtMG(it.qf_at)}</p>
                <p className="font-mono text-xs font-bold text-white tabular-nums shrink-0">
                  ⏱ {fmtRemaining(ms)}
                </p>
              </div>
            )}

            {openReg && (
              <p className="mt-0.5 text-[10px] text-emerald-300/90 font-semibold">
                Mbola afaka misoratra anarana
              </p>
            )}

            {it.registrations.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {groupKeys.map((g) => (
                  <p key={g} className="text-[10px] text-red-50/90 leading-tight">
                    <span className="font-bold text-red-200">Groupe {g}:</span>{" "}
                    <span className="text-white/85">{groups[g].join(", ")}</span>
                  </p>
                ))}
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}