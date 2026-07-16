import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Req = {
  id: string;
  user_id: string;
  status: string;
  proposed_mvola_name: string | null;
  proposed_phone: string | null;
  proposed_password: string | null;
  proposed_pin: string | null;
  proposed_selfie_url: string | null;
  created_at: string;
};

export default function PendingProfileApprovals({ onChange }: { onChange?: () => void }) {
  const [items, setItems] = useState<Req[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: reqs } = await supabase
      .from("profile_change_requests" as any)
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    const list = (reqs ?? []) as any as Req[];
    setItems(list);
    const uids = Array.from(new Set(list.map((r) => r.user_id)));
    if (uids.length) {
      const { data: ps } = await supabase.from("profiles").select("*").in("user_id", uids);
      const map: Record<string, any> = {};
      (ps ?? []).forEach((p: any) => { map[p.user_id] = p; });
      setProfiles(map);
    }
    setLoading(false);
    onChange?.();
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("pcr-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "profile_change_requests" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const approve = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.rpc("admin_approve_profile_change" as any, { _req_id: id });
    setBusy(null);
    if (error) toast.error(error.message); else { toast.success("Nankatoavina"); load(); }
  };
  const reject = async (id: string) => {
    const reason = window.prompt("Antony tsy fankatoavana (azo ovaina):") ?? "";
    setBusy(id);
    const { error } = await supabase.rpc("admin_reject_profile_change" as any, { _req_id: id, _reason: reason });
    setBusy(null);
    if (error) toast.error(error.message); else { toast.info("Tsy nekena"); load(); }
  };

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!items.length) return <p className="text-center text-xs text-muted-foreground py-6">Tsy misy fangatahana miandry.</p>;

  return (
    <div className="space-y-3">
      {items.map((r) => {
        const cur = profiles[r.user_id] ?? {};
        const Field = ({ label, current, proposed }: { label: string; current: any; proposed: any }) => {
          if (proposed == null || proposed === "") return null;
          return (
            <div className="grid grid-cols-2 gap-2 text-[11px] py-1 border-b border-border/30">
              <div>
                <p className="text-muted-foreground">{label} (taloha)</p>
                <p className="font-medium break-all">{current ?? "—"}</p>
              </div>
              <div>
                <p className="text-yellow-300">{label} (vaovao)</p>
                <p className="font-bold break-all">{proposed}</p>
              </div>
            </div>
          );
        };
        return (
          <div key={r.id} className="card-felt rounded-xl p-3 border-l-4 border-yellow-500">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-black/40 border border-border/40 flex items-center justify-center">
                {cur.avatar_url ? <img src={cur.avatar_url} alt="" className="w-full h-full object-cover" /> : <span>👤</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{cur.mvola_name ?? r.user_id.slice(0, 8)}</p>
                <p className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
              </div>
            </div>

            <Field label="Nom" current={cur.mvola_name} proposed={r.proposed_mvola_name} />
            <Field label="Téléphone" current={cur.phone} proposed={r.proposed_phone} />
            <Field label="Password" current={cur.password_plain ? "••••••" : "—"} proposed={r.proposed_password ? "••••••" : null} />
            <Field label="PIN" current={cur.pin_plain ? "••••" : "—"} proposed={r.proposed_pin ? "••••" : null} />
            {r.proposed_selfie_url && (
              <div className="grid grid-cols-2 gap-2 text-[11px] py-2">
                <div>
                  <p className="text-muted-foreground mb-1">Selfie taloha</p>
                  {cur.avatar_url ? <img src={cur.avatar_url} alt="" className="w-24 h-24 rounded-lg object-cover" /> : <span>—</span>}
                </div>
                <div>
                  <p className="text-yellow-300 mb-1">Selfie vaovao</p>
                  <img src={r.proposed_selfie_url} alt="" className="w-24 h-24 rounded-lg object-cover border border-yellow-500" />
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={() => approve(r.id)} disabled={busy === r.id} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                <Check className="w-3.5 h-3.5 mr-1" /> Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={() => reject(r.id)} disabled={busy === r.id} className="flex-1">
                <X className="w-3.5 h-3.5 mr-1" /> Reject
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}