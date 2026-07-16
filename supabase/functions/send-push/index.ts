// DOMINO MGA — Web Push sender (VAPID)
// Body: { audience: "admins" | "user" | "all", user_id?: string, title: string, body: string, url?: string, tag?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import webpush from "https://esm.sh/web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PUB = Deno.env.get("VAPID_PUBLIC_KEY")!;
const PRIV = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUBJECT = "mailto:admin@dominomga.app";

webpush.setVapidDetails(SUBJECT, PUB, PRIV);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json();
    const { audience = "admins", user_id, title, body: text, url, tag } = body ?? {};
    if (!title || !text) {
      return new Response(JSON.stringify({ error: "title/body required" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
    }

    let q = supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth");
    if (audience === "admins") q = q.eq("is_admin", true);
    else if (audience === "user" && user_id) q = q.eq("user_id", user_id);
    else if (audience !== "all") {
      return new Response(JSON.stringify({ error: "bad audience" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
    }
    const { data: subs, error } = await q;
    if (error) throw error;

    const payload = JSON.stringify({ title, body: text, url: url ?? "/", tag });
    const stale: string[] = [];
    let sent = 0;
    await Promise.all((subs ?? []).map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 },
        );
        sent++;
      } catch (e: any) {
        const status = e?.statusCode;
        if (status === 404 || status === 410) stale.push(s.id);
        else console.warn("push err", status, e?.body || e?.message);
      }
    }));

    if (stale.length) {
      await supabase.from("push_subscriptions").delete().in("id", stale);
    }

    return new Response(JSON.stringify({ sent, removed: stale.length, total: subs?.length ?? 0 }), {
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (e: any) {
    console.error("send-push fatal", e);
    return new Response(JSON.stringify({ error: e?.message || "fail" }), { status: 500, headers: { ...cors, "content-type": "application/json" } });
  }
});