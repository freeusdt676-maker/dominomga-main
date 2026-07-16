import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type PresenceMember = { user_id: string; name: string; phone: string };

type Listener = (members: PresenceMember[]) => void;
const listeners = new Set<Listener>();
let currentMembers: PresenceMember[] = [];

export function getOnlineMembers(): PresenceMember[] {
  return currentMembers;
}

export function subscribeOnlineMembers(fn: Listener): () => void {
  listeners.add(fn);
  fn(currentMembers);
  return () => { listeners.delete(fn); };
}

function setMembers(next: PresenceMember[]) {
  currentMembers = next;
  listeners.forEach((l) => l(next));
}

/**
 * Hampandrenesina ny presence-channel manerana ny app raha vao misy
 * mpampiasa miditra ny app. Tsy mitana presence raha mivoaka ny écran
 * (visibilitychange) na rehefa mihidy ny app.
 */
export function useGlobalPresence(user: User | null) {
  useEffect(() => {
    if (!user) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    let meta = { name: "Mpilalao", phone: "" as string };

    const sync = () => {
      if (!channel) return;
      const state = channel.presenceState() as Record<
        string,
        Array<{ name?: string; phone?: string }>
      >;
      const list: PresenceMember[] = Object.entries(state).map(([uid, metas]) => ({
        user_id: uid,
        name: (metas?.[0]?.name as string) || "Mpilalao",
        phone: (metas?.[0]?.phone as string) || "",
      }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setMembers(list);
    };

    const join = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("mvola_name, phone")
        .eq("user_id", user.id)
        .maybeSingle();
      meta = {
        name: (data?.mvola_name as string) || "Mpilalao",
        phone: (data?.phone as string) || "",
      };
      if (cancelled) return;
      channel = supabase.channel("app-online-users", {
        config: { presence: { key: user.id } },
      });
      channel
        .on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel!.track({ ...meta, ts: Date.now() });
        }
      });
    };

    const leave = async () => {
      if (channel) {
        try { await channel.untrack(); } catch {}
        supabase.removeChannel(channel);
        channel = null;
        setMembers([]);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (!channel) join();
      } else {
        leave();
      }
    };

    join();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", leave);
    window.addEventListener("beforeunload", leave);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("beforeunload", leave);
      leave();
    };
  }, [user]);
}