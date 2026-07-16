import { supabase } from "@/integrations/supabase/client";

// Public VAPID key — safe to embed in client.
const VAPID_PUBLIC_KEY =
  "BAc2eggU4Q2nko9c9_4Vy-n_1gotHSLFARzTpIGM4X8Pt47aJMP6JZfHdi0lxqax0fqDqkyJ6AmL9owS5VdLtZ4";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

function bufToB64(buf: ArrayBuffer | null) {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

let registering = false;

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function ensurePushSubscription(opts: { isAdmin?: boolean } = {}) {
  if (!isPushSupported()) return;
  if (registering) return;
  registering = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Permission
    if (Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch {}
    }
    if (Notification.permission !== "granted") return;

    // Register SW
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;

    // Subscribe (reuse existing if any)
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });
    }

    const endpoint = sub.endpoint;
    const p256dh = bufToB64(sub.getKey("p256dh"));
    const authKey = bufToB64(sub.getKey("auth"));

    await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth: authKey,
        is_admin: !!opts.isAdmin,
        user_agent: navigator.userAgent.slice(0, 200),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );
  } catch (e) {
    console.warn("[push] subscription failed", e);
  } finally {
    registering = false;
  }
}

export async function unsubscribePush() {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    }
  } catch {}
}