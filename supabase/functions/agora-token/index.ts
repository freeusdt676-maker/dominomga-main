import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { RtcTokenBuilder, RtcRole } from 'npm:agora-token@2.0.5';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { channelName, uid } = await req.json();
    if (!channelName || typeof channelName !== 'string') {
      return new Response(JSON.stringify({ error: 'channelName required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const appId = Deno.env.get('AGORA_APP_ID');
    const appCert = Deno.env.get('AGORA_APP_CERTIFICATE');
    if (!appId || !appCert) {
      return new Response(JSON.stringify({ error: 'agora_not_configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const numericUid = typeof uid === 'number' ? uid : 0;
    const expireSeconds = 3600 * 6; // 6 hours
    const privilegeExpireTs = Math.floor(Date.now() / 1000) + expireSeconds;
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId, appCert, channelName, numericUid, RtcRole.PUBLISHER, privilegeExpireTs, privilegeExpireTs
    );
    return new Response(JSON.stringify({ token, appId, uid: numericUid, channelName, expiresAt: privilegeExpireTs }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});