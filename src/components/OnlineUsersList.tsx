import { useEffect, useState } from "react";
import { Globe2 } from "lucide-react";
import {
  subscribeOnlineMembers,
  type PresenceMember,
} from "@/hooks/useGlobalPresence";

type Props = { accent?: string };

/**
 * Lisitra mahalaky ny olona REHETRA misokatra ny app amin'izao fotoana izao
 * (en temps réel). Mampiasa ny presence-channel iraisana "app-online-users"
 * — vao mivoaka ny écran ny mpampiasa dia esorina avy hatrany amin'ity liste ity.
 */
export default function OnlineUsersList({ accent = "text-primary" }: Props) {
  const [members, setMembers] = useState<PresenceMember[]>([]);

  useEffect(() => {
    return subscribeOnlineMembers(setMembers);
  }, []);

  return (
    <div className="rounded-2xl p-4 border border-white/10 bg-black/20 backdrop-blur">
      <div className="flex items-center gap-2 mb-2">
        <Globe2 className={`w-4 h-4 ${accent}`} />
        <h3 className={`font-display font-bold ${accent}`}>
          En ligne amin'ny app ({members.length})
        </h3>
      </div>
      {members.length === 0 ? (
        <p className="text-center text-xs text-muted-foreground py-3">
          Tsy mbola misy olona en ligne
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <li
              key={m.user_id}
              className="px-2 py-1 rounded-full text-[11px] font-semibold bg-white/10 border border-white/15"
              title={m.phone || undefined}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle animate-pulse" />
              {m.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}