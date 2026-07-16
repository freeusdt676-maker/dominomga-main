// Edge function: manao hash sy verify PIN amin'ny wallet
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No auth" }), { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return new Response(JSON.stringify({ error: "Invalid" }), { status: 401, headers: corsHeaders });
    const userId = userData.user.id;

    const { action, pin, newPin } = await req.json();
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      return new Response(JSON.stringify({ error: "PIN tsy ara-dalàna (4-6 chiffres)" }), { status: 400, headers: corsHeaders });
    }
    const pinHash = await sha256(pin + userId);

    if (action === "set") {
      // Mametraka PIN voalohany na manova
      const { data: w } = await supabase.from("wallets").select("pin_hash").eq("user_id", userId).single();
      if (w?.pin_hash) {
        // Mila newPin sy pin (ankehitriny) hanovana
        if (!newPin) {
          return new Response(JSON.stringify({ error: "PIN efa nisy. Mila newPin." }), { status: 400, headers: corsHeaders });
        }
        if (w.pin_hash !== pinHash) {
          return new Response(JSON.stringify({ error: "PIN diso" }), { status: 400, headers: corsHeaders });
        }
        const newHash = await sha256(newPin + userId);
        await supabase.from("wallets").update({ pin_hash: newHash }).eq("user_id", userId);
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }
      await supabase.from("wallets").update({ pin_hash: pinHash }).eq("user_id", userId);
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    if (action === "verify") {
      const { data: w } = await supabase.from("wallets").select("pin_hash").eq("user_id", userId).single();
      const ok = w?.pin_hash === pinHash;
      return new Response(JSON.stringify({ ok }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "action tsy fantatra" }), { status: 400, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
