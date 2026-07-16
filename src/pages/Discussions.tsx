import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send, Trash2, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { sfx } from "@/lib/sfx";

export default function Discussions() {
  const { user, isAdmin } = useAuth();
  const nav = useNavigate();
  const [messages, setMessages] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("lobby_messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(200);
    const list = data ?? [];
    setMessages(list);
    const ids = Array.from(new Set(list.map((m: any) => m.sender_id)));
    if (ids.length) {
      const { data: p } = await supabase
        .from("profiles").select("user_id,mvola_name").in("user_id", ids);
      const map: Record<string, string> = {};
      (p ?? []).forEach((pr: any) => { map[pr.user_id] = pr.mvola_name; });
      setProfiles(map);
    }
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("lobby-msgs")
      .on("postgres_changes", { event: "*", schema: "public", table: "lobby_messages" }, (payload: any) => {
        if (payload.eventType === "INSERT" && payload.new?.sender_id !== user.id) {
          if (lastIdRef.current !== payload.new.id) {
            sfx.notify();
            try { (navigator as any).vibrate?.(80); } catch {}
            lastIdRef.current = payload.new.id;
          }
        }
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const send = async () => {
    if (!text.trim() || !user) return;
    const { error } = await supabase.from("lobby_messages")
      .insert({ sender_id: user.id, content: text.trim() });
    if (error) return toast.error(error.message);
    setText("");
  };

  const remove = async (m: any) => {
    const isMine = m.sender_id === user?.id;
    if (!isMine && !isAdmin) return toast.error("Tsy mahazo mamafa");
    if (!confirm("Hamafa ity hafatra ity?")) return;
    if (isAdmin && !isMine) {
      const { error } = await supabase.rpc("admin_delete_lobby_message", { _msg_id: m.id, _admin_id: user!.id });
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("lobby_messages").delete().eq("id", m.id);
      if (error) return toast.error(error.message);
    }
    toast.success("Voafafa");
    load();
  };

  return (
    <div className="min-h-screen felt-bg flex flex-col">
      <header className="p-4 flex items-center gap-3 border-b border-primary/20">
        <Button variant="ghost" size="icon" onClick={() => nav("/")}><ArrowLeft /></Button>
        <MessagesSquare className="text-primary" />
        <h1 className="font-display text-xl font-bold gold-text">Discussions Mpilalao</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-2 max-w-lg mx-auto w-full">
        {messages.length === 0 && <p className="text-center text-muted-foreground text-sm py-6">Mbola tsy misy hafatra. Manombohy resaka!</p>}
        {messages.map((m) => {
          const mine = m.sender_id === user?.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"} group`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm relative ${mine ? "btn-gold" : "bg-success/20 border border-success/40 text-foreground"}`}>
                {!mine && <p className="text-[10px] font-bold opacity-80 mb-0.5">{profiles[m.sender_id] ?? "Mpilalao"}</p>}
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                <p className="text-[10px] opacity-70 mt-1">{new Date(m.created_at).toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" })}</p>
                {(mine || isAdmin) && (
                  <button
                    onClick={() => remove(m)}
                    aria-label="Suprimer"
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 hover:opacity-100 flex items-center justify-center transition"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="p-3 border-t border-primary/20 flex gap-2 max-w-lg mx-auto w-full">
        <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Hafatra..." />
        <Button onClick={send} className="btn-gold"><Send className="w-4 h-4" /></Button>
      </div>
    </div>
  );
}