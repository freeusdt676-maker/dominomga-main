import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Hook ho an'ny notifications administratif.
 * - Mangataka autorisation amin'ny finday (Notification API)
 * - Realtime amin'ny tables: games, ludo_games, petanque_games (pilalao vaovao),
 *   profile_change_requests (fanovana profil), transactions (dépôt/retrait),
 *   password_reset_requests (mot de passe).
 * - Mampiseho notification mipoitra avy any ambony + feo mafy be.
 */

type NotifKind =
  | "GAME"
  | "PROFIL"
  | "DEPOT"
  | "RETRAIT"
  | "MOT_DE_PASSE";

const KIND_LABEL: Record<NotifKind, string> = {
  GAME: "🎲 LALAO VAOVAO",
  PROFIL: "👤 FANOVANA PROFIL",
  DEPOT: "💰 DÉPÔT",
  RETRAIT: "💸 RETRAIT",
  MOT_DE_PASSE: "🔐 MOT DE PASSE",
};

// Feo notification mafy be — Web Audio API (3 bip mahery)
function playLoudBeep() {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 1.0; // mafy be
    gain.connect(ctx.destination);
    const notes = [880, 1320, 1760];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.9, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
      osc.connect(g).connect(gain);
      osc.start(start);
      osc.stop(start + 0.18);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {}
}

function showNotif(kind: NotifKind, body: string) {
  const title = `ADMINISTRATIF DOMINO MGA · ${KIND_LABEL[kind]}`;
  // Feo mafy
  playLoudBeep();
  // Toast in-app (mipoitra ambony)
  toast.success(title, { description: body, duration: 9000 });
  // Notification système (mipoitra avy any ambony ny finday)
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: `dmga-${kind}-${Date.now()}`,
        requireInteraction: false,
        silent: false,
      } as NotificationOptions);
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {}
  }
}

export function requestAdminNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

export function useAdminNotifications(enabled: boolean) {
  const mountedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!enabled) return;
    // Mangataka autorisation eo no eo
    requestAdminNotificationPermission();
    // "Unlock" ny audio context amin'ny click voalohany (mobile policy)
    const unlock = () => {
      try {
        const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
        if (Ctx) {
          const c = new Ctx();
          c.resume().finally(() => c.close().catch(() => {}));
        }
      } catch {}
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });

    mountedAtRef.current = Date.now();
    const isFresh = (createdAt?: string | null) => {
      if (!createdAt) return true;
      return new Date(createdAt).getTime() >= mountedAtRef.current - 2000;
    };

    const channel = supabase
      .channel("admin-notifications")
      // Lalao vaovao (domino)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "games" }, (payload) => {
        const row: any = payload.new;
        if (!isFresh(row?.created_at)) return;
        showNotif("GAME", `Domino · mise ${row?.bet_amount ?? "?"} Ar`);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ludo_games" }, (payload) => {
        const row: any = payload.new;
        if (!isFresh(row?.created_at)) return;
        showNotif("GAME", `Ludo · mise ${row?.bet_amount ?? "?"} Ar`);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "petanque_games" }, (payload) => {
        const row: any = payload.new;
        if (!isFresh(row?.created_at)) return;
        showNotif("GAME", `Pétanque · mise ${row?.bet_amount ?? "?"} Ar`);
      })
      // Profil — demande fanovana
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "profile_change_requests" }, (payload) => {
        const row: any = payload.new;
        if (!isFresh(row?.created_at)) return;
        showNotif("PROFIL", `Misy demande fanovana profil vaovao mila valide`);
      })
      // Transactions
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions" }, (payload) => {
        const row: any = payload.new;
        if (!isFresh(row?.created_at)) return;
        if (row?.status !== "pending") return;
        if (row?.type === "deposit") {
          showNotif("DEPOT", `Dépôt ${row?.amount ?? "?"} Ar mila valide`);
        } else if (row?.type === "withdrawal") {
          showNotif("RETRAIT", `Retrait ${row?.amount ?? "?"} Ar mila valide`);
        }
      })
      // Mot de passe oublié
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "password_reset_requests" }, (payload) => {
        const row: any = payload.new;
        if (!isFresh(row?.created_at)) return;
        showNotif("MOT_DE_PASSE", `Demande mot de passe oublié vaovao mila gestionnaire`);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, [enabled]);
}