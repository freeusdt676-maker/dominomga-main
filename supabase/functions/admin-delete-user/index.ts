// Edge function: famafana tanteraka ny compte (rejection na manual delete) by admin
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return new Response(JSON.stringify({ error: "no token" }), { status: 401, headers: corsHeaders });

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: ures } = await userClient.auth.getUser();
    const caller = ures?.user;
    if (!caller) return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: corsHeaders });

    const admin = createClient(url, svc);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", caller.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });

    const { user_id, message } = await req.json();
    if (!user_id) return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: corsHeaders });

    // Alefa hafatra fanazavana (raha misy) — atao broadcast mba ho hita amin'ny olona kahay tsy nisy compte intsony
    if (message && String(message).trim()) {
      // Tsy mety alefa amin'ny recipient_id satria hofafana ny user. Tehirizo amin'ny chat_messages misy sender ny admin sy recipient ny user (alohan'ny famafana)
      await admin.from("chat_messages").insert({
        sender_id: caller.id,
        recipient_id: user_id,
        content: `[REFUS INSCRIPTION] ${String(message).trim()}`,
        is_admin_broadcast: false,
      });
    }

    // Famafana ny daty mifandraika
    await admin.from("password_reset_requests").delete().eq("user_id", user_id);
    await admin.from("transactions").delete().eq("user_id", user_id);
    await admin.from("matchmaking_queue").delete().eq("user_id", user_id);
    await admin.from("user_roles").delete().eq("user_id", user_id);
    await admin.from("wallets").delete().eq("user_id", user_id);

    // Alao ny selfie_url mba hofafana ao amin'ny storage
    const { data: prof } = await admin.from("profiles").select("selfie_url, phone").eq("user_id", user_id).maybeSingle();
    if (prof?.selfie_url) {
      try {
        const u = new URL(prof.selfie_url);
        const idx = u.pathname.indexOf("/selfies/");
        if (idx >= 0) {
          const path = u.pathname.substring(idx + "/selfies/".length);
          await admin.storage.from("selfies").remove([path]);
        }
      } catch (_) { /* ignore */ }
    }
    await admin.from("profiles").delete().eq("user_id", user_id);

    // Famafana ny compte auth.users
    const { error: delErr } = await admin.auth.admin.deleteUser(user_id);
    if (delErr) return new Response(JSON.stringify({ error: delErr.message }), { status: 500, headers: corsHeaders });

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});