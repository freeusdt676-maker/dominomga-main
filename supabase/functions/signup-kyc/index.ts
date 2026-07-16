// Edge function: manao inscription auto-confirmed mba tsy hila email verification
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { email, password, mvola_name, phone, birth_date, gender, selfie_base64, pin } = await req.json();

    if (!email || !password || !mvola_name || !phone || !pin) {
      return new Response(JSON.stringify({ error: "Mila daty rehetra" }), { status: 400, headers: corsHeaders });
    }
    if (!/^\d{4,6}$/.test(pin)) {
      return new Response(JSON.stringify({ error: "PIN tsy ara-dalàna" }), { status: 400, headers: corsHeaders });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Upload selfie raha misy
    let selfie_url: string | null = null;
    if (selfie_base64) {
      const m = selfie_base64.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
      if (m) {
        const mime = m[1];
        const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
        const ext = mime.split("/")[1].replace("jpeg","jpg");
        const path = `${phone}-${Date.now()}.${ext}`;
        const up = await admin.storage.from("selfies").upload(path, bytes, { contentType: mime, upsert: true });
        if (!up.error) {
          const { data: pub } = admin.storage.from("selfies").getPublicUrl(path);
          selfie_url = pub.publicUrl;
        }
      }
    }

    // Create user (auto-confirmed)
    const { data: created, error: cerr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        mvola_name,
        phone,
        birth_date: birth_date || null,
        gender: gender || null,
        selfie_url,
        password_plain: password,
        pin_plain: pin,
      },
    });
    if (cerr || !created.user) {
      const msg = cerr?.message ?? "Hadisoana";
      const friendly = msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered")
        ? "Efa misy compte amin'io numéro io"
        : msg;
      return new Response(JSON.stringify({ error: friendly }), { status: 400, headers: corsHeaders });
    }

    // Hash PIN dia tehirizo ao amin'ny wallet
    const pinHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin + created.user.id));
    const pinHash = Array.from(new Uint8Array(pinHashBuf)).map((b)=>b.toString(16).padStart(2,"0")).join("");
    await admin.from("wallets").update({ pin_hash: pinHash }).eq("user_id", created.user.id);

    return new Response(JSON.stringify({ ok: true, user_id: created.user.id }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});