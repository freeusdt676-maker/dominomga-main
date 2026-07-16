import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Mail, MailOpen } from "lucide-react";

const READ_KEY = "msg_read_ids_v1";

function getRead(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]")); } catch { return new Set(); }
}
function setRead(s: Set<string>) {
  localStorage.setItem(READ_KEY, JSON.stringify(Array.from(s)));
}

export default function MessageInbox() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("id, recipient_id, is_admin_broadcast, sender_id")
        .or(`recipient_id.eq.${user.id},is_admin_broadcast.eq.true`)
        .neq("sender_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      const read = getRead();
      const u = (data ?? []).filter((m) => !read.has(m.id)).length;
      setUnread(u);
    };
    load();
    // Scoped subscription: only events targeting THIS user (admin broadcasts caught via interval poll).
    const ch = supabase
      .channel("inbox-" + user.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `recipient_id=eq.${user.id}` }, () => load())
      .subscribe();
    const itv = setInterval(load, 20000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { supabase.removeChannel(ch); clearInterval(itv); window.removeEventListener("focus", onFocus); };
  }, [user]);

  const onClick = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("chat_messages")
      .select("id")
      .or(`recipient_id.eq.${user.id},is_admin_broadcast.eq.true`)
      .neq("sender_id", user.id);
    const read = getRead();
    (data ?? []).forEach((m: any) => read.add(m.id));
    setRead(read);
    setUnread(0);
    nav("/admin-chat");
  };

  const has = unread > 0;
  return (
    <button
      onClick={onClick}
      aria-label="Messages"
      className="relative w-10 h-10 rounded-full flex items-center justify-center bg-card/40 border border-primary/20 hover:bg-primary/10 transition"
    >
      {has ? <Mail className="w-5 h-5 text-primary animate-pulse" /> : <MailOpen className="w-5 h-5 text-muted-foreground" />}
      {has && (
        <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full min-w-[18px] h-[18px] px-1 text-[10px] flex items-center justify-center font-bold">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
