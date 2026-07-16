import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { KeyRound, Check, X, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

type Req = {
  id: string; user_id: string | null; phone: string; status: string;
  answers: any; mvola_name: string | null; password_plain: string | null; pin_plain: string | null;
  created_at: string; processed_at: string | null; admin_note: string | null;
};

export default function PasswordRecoveryAdmin() {
  const [items, setItems] = useState<Req[]>([]);
  const [open, setOpen] = useState(true);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = async () => {
    const { data, error } = await supabase.rpc("admin_list_recovery_requests" as any);
    if (error) { toast.error(error.message); return; }
    setItems((data as any[]) || []);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("admin-recovery")
      .on("postgres_changes", { event: "*", schema: "public", table: "password_reset_requests" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const pendingCount = items.filter((i) => i.status === "pending").length;

  const decide = async (id: string, approve: boolean, n?: string) => {
    const { data, error } = await supabase.rpc("admin_decide_recovery" as any,
      { _request_id: id, _approve: approve, _note: n ?? null });
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.ok) {
      toast.success(approve ? "Approuvé" : "Refusé");
      setNoteFor(null); setNote("");
    }
  };

  return (
    <div className="card-felt rounded-2xl p-4 mb-4 border border-primary/30">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          <h3 className="font-bold gold-text">Gestionnaire Mot de Passe</h3>
          {pendingCount > 0 && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600" />
            </span>
          )}
          <span className="text-xs text-muted-foreground">({pendingCount} pending · {items.length} total)</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="mt-3 space-y-2 max-h-[500px] overflow-y-auto">
          {items.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4">Tsy misy demande</div>
          )}
          {items.map((r) => (
            <div key={r.id} className={`rounded-lg p-3 border ${
              r.status === "pending" ? "border-red-500/60 bg-red-500/5" :
              r.status === "approved" ? "border-green-500/40 bg-green-500/5" :
              "border-muted bg-muted/10"
            }`}>
              <div className="flex items-center justify-between text-xs">
                <div className="font-mono">{r.phone}</div>
                <div className={`uppercase font-bold ${
                  r.status === "pending" ? "text-red-500" :
                  r.status === "approved" ? "text-green-500" : "text-muted-foreground"
                }`}>{r.status}</div>
              </div>
              <div className="text-xs mt-1 space-y-0.5">
                <div>• Phone reçu : <b>{r.answers?.phone}</b></div>
                <div>• Nom répondu : <b>{r.answers?.name}</b> {r.mvola_name && <span className="text-muted-foreground">(profil: {r.mvola_name})</span>}</div>
                <div>• Sexe : <b>{r.answers?.gender}</b></div>
                <div>• Jeux : <b>{r.answers?.games}</b></div>
              </div>
              {r.status === "pending" && r.user_id && (
                <div className="mt-2 text-[11px] bg-background/40 rounded p-2">
                  <div>Mot de passe à révéler : <code className="font-mono">{r.password_plain ?? "—"}</code></div>
                  <div>PIN à révéler : <code className="font-mono">{r.pin_plain ?? "—"}</code></div>
                </div>
              )}
              {r.admin_note && <div className="text-[11px] text-muted-foreground mt-1">Note: {r.admin_note}</div>}
              {r.status === "pending" && r.user_id && (
                <div className="flex gap-2 mt-2">
                  <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => decide(r.id, true)}>
                    <Check className="w-3 h-3 mr-1" /> Approuvé
                  </Button>
                  <Button size="sm" variant="destructive" className="flex-1" onClick={() => setNoteFor(r.id)}>
                    <X className="w-3 h-3 mr-1" /> Refusé
                  </Button>
                </div>
              )}
              {noteFor === r.id && (
                <div className="mt-2 space-y-1">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Antony (optionnel)" rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setNoteFor(null); setNote(""); }}>Aoka</Button>
                    <Button size="sm" variant="destructive" onClick={() => decide(r.id, false, note)}>Confirmer refus</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}