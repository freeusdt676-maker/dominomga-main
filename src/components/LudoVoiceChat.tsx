import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react";
import AgoraRTC, { IAgoraRTCClient, IMicrophoneAudioTrack, IAgoraRTCRemoteUser } from "agora-rtc-sdk-ng";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Voice-only call attached to a game room. All players in the same gameId
// share a channel. Tap to join, tap again to leave.
export default function LudoVoiceChat({ gameId }: { gameId?: string }) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remoteCount, setRemoteCount] = useState(0);
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const micRef = useRef<IMicrophoneAudioTrack | null>(null);

  useEffect(() => () => { void leave(); /* eslint-disable-next-line */ }, []);

  const join = async () => {
    if (!gameId || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("agora-token", {
        body: { channelName: gameId.slice(0, 40), uid: Math.floor(Math.random() * 1e9) },
      });
      if (error || !data?.token) { toast.error("Tsy afaka miantso izao"); setBusy(false); return; }
      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      clientRef.current = client;
      client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === "audio") user.audioTrack?.play();
        setRemoteCount(client.remoteUsers.length);
      });
      client.on("user-unpublished", () => setRemoteCount(client.remoteUsers.length));
      client.on("user-left", () => setRemoteCount(client.remoteUsers.length));
      await client.join(data.appId, data.channelName, data.token, data.uid);
      const mic = await AgoraRTC.createMicrophoneAudioTrack();
      micRef.current = mic;
      await client.publish([mic]);
      setJoined(true);
      toast.success("Antso mandeha 📞");
    } catch (e: any) {
      toast.error(e?.message ?? "Tsy nety ny antso");
    } finally { setBusy(false); }
  };

  const leave = async () => {
    try {
      micRef.current?.stop(); micRef.current?.close(); micRef.current = null;
      await clientRef.current?.leave();
      clientRef.current = null;
    } catch {}
    setJoined(false); setMuted(false); setRemoteCount(0);
  };

  const toggleMute = async () => {
    if (!micRef.current) return;
    const next = !muted;
    await micRef.current.setMuted(next);
    setMuted(next);
  };

  if (!gameId) return null;

  return (
    <div className="flex items-center gap-1.5">
      {joined ? (
        <>
          <button onClick={toggleMute}
                  className={`w-9 h-9 rounded-full flex items-center justify-center shadow-lg ${muted ? "bg-slate-600" : "bg-emerald-600"} text-white`}
                  title={muted ? "Mihafa" : "Mangina"}>
            {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button onClick={leave}
                  className="w-9 h-9 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg animate-pulse"
                  title="Ajanony ny antso">
            <PhoneOff className="w-4 h-4" />
          </button>
          {remoteCount > 0 && (
            <span className="text-[10px] font-bold text-emerald-300">·{remoteCount}</span>
          )}
        </>
      ) : (
        <button onClick={join} disabled={busy}
                className="w-9 h-9 rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white flex items-center justify-center shadow-lg"
                title="Antso mpilalao">
          <Phone className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}