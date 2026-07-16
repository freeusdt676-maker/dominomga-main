import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, ShieldAlert, Activity, AlertTriangle, Users, LogIn } from "lucide-react";
import { toast } from "sonner";
export default function AdminSecurity() {
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const codeOk = typeof window !== "undefined" && sessionStorage.getItem("admin_code_ok") === "1";
  const allowed = isAdmin || codeOk;
  const [alerts, setAlerts] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [logins, setLogins] = useState<any[]>([]);
  const [dupes, setDupes] = useState<any[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = async () => {
    const [{ data: a }, { data: l }, { data: la }, { data: d }] = await Promise.all([
      supabase.from("fraud_alerts").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("login_attempts").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.rpc("admin_list_phone_duplicates"),
    ]);
    setAlerts(a ?? []);
    setLogs(l ?? []);
    setLogins(la ?? []);
    setDupes((d as any[]) ?? []);
    const ids = new Set<string>();
    (a ?? []).forEach((x: any) => x.user_id && ids.add(x.user_id));
    (l ?? []).forEach((x: any) => x.user_id && ids.add(x.user_id));
    if (ids.size) {
      const { data: ps } = await supabase.from("profiles").select("user_id, mvola_name, phone").in("user_id", Array.from(ids));
      const m: Record<string, string> = {};
      (ps ?? []).forEach((p: any) => { m[p.user_id] = `${p.mvola_name} (${p.phone})`; });
      setNames(m);
    }
  };

  useEffect(() => {
    if (!allowed) return;
    load();
    const ch = supabase.channel("admin-sec")
      .on("postgres_changes", { event: "*", schema: "public", table: "fraud_alerts" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [allowed]);

  const resolve = async (id: string) => {
    const { error } = await supabase.rpc("admin_resolve_fraud_alert", { _id: id });
    if (error) return toast.error(error.message);
    toast.success("Voavaha");
    load();
  };

  const block = async (uid: string) => {
    const { error } = await supabase.from("profiles").update({ account_status: "blocked" }).eq("user_id", uid);
    if (error) return toast.error(error.message);
    toast.success("Voasakana");
  };

  if (!allowed) {
    return <div className="min-h-screen luxe-bg flex items-center justify-center text-muted-foreground">Forbidden</div>;
  }

  const unresolved = alerts.filter(a => !a.resolved);

  return (
    <div className="min-h-screen luxe-bg pb-20">
      <header className="p-4 flex items-center gap-3 hairline-b">
        <Button variant="ghost" size="icon" onClick={() => nav("/admin")}><ArrowLeft /></Button>
        <h1 className="font-serif-luxe gold-luxe-text text-xl flex items-center gap-2">
          <ShieldAlert className="w-5 h-5" /> Fiarovana & Détection fraude
        </h1>
      </header>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="grid grid-cols-4 gap-2">
          <div className="luxe-card p-3 text-center">
            <AlertTriangle className="w-4 h-4 mx-auto text-destructive" />
            <p className="text-2xl font-bold mt-1">{unresolved.length}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Alerte</p>
          </div>
          <div className="luxe-card p-3 text-center">
            <Activity className="w-4 h-4 mx-auto text-[hsl(var(--gold-1))]" />
            <p className="text-2xl font-bold mt-1">{logs.length}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Audit</p>
          </div>
          <div className="luxe-card p-3 text-center">
            <LogIn className="w-4 h-4 mx-auto text-[hsl(var(--gold-1))]" />
            <p className="text-2xl font-bold mt-1">{logins.filter(l=>!l.success).length}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Fails</p>
          </div>
          <div className="luxe-card p-3 text-center">
            <Users className="w-4 h-4 mx-auto text-destructive" />
            <p className="text-2xl font-bold mt-1">{dupes.length}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Doublon</p>
          </div>
        </div>

        <Tabs defaultValue="alerts">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="alerts">Alertes</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
            <TabsTrigger value="logins">Logins</TabsTrigger>
            <TabsTrigger value="dupes">Doublons</TabsTrigger>
          </TabsList>

          <TabsContent value="alerts" className="space-y-2 mt-3">
            {alerts.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Tsy misy alerte.</p>}
            {alerts.map(a => (
              <div key={a.id} className={`luxe-card p-3 ${a.resolved ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${a.severity === "high" ? "bg-destructive/20 text-destructive" : "bg-amber-500/20 text-amber-500"}`}>{a.severity}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">{a.kind}</span>
                    </div>
                    <p className="text-sm font-medium mt-1">{a.message}</p>
                    <p className="text-[11px] text-muted-foreground">{names[a.user_id] ?? a.user_id?.slice(0,8)} · {new Date(a.created_at).toLocaleString("fr-FR")}</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    {!a.resolved && <Button size="sm" variant="outline" onClick={() => resolve(a.id)}>OK</Button>}
                    {a.user_id && <Button size="sm" variant="destructive" onClick={() => block(a.user_id)}>Block</Button>}
                  </div>
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="audit" className="space-y-1 mt-3">
            {logs.map(l => (
              <div key={l.id} className="luxe-card p-2 flex items-center justify-between text-xs">
                <span><b className="text-[hsl(var(--gold-1))]">{l.action}</b> · {names[l.user_id] ?? l.user_id?.slice(0,8)}</span>
                <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString("fr-FR")}</span>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="logins" className="space-y-1 mt-3">
            {logins.map(l => (
              <div key={l.id} className={`luxe-card p-2 flex items-center justify-between text-xs ${!l.success ? "border-destructive/40" : ""}`}>
                <span>{l.success ? "✓" : "✗"} <b>{l.phone}</b></span>
                <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString("fr-FR")}</span>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="dupes" className="space-y-2 mt-3">
            {dupes.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Tsy misy doublon numéro.</p>}
            {dupes.map((d: any, i: number) => (
              <div key={i} className="luxe-card p-3">
                <p className="font-bold gold-luxe-text">{d.phone} <span className="text-xs text-muted-foreground">({d.count} comptes)</span></p>
                <p className="text-[11px] text-muted-foreground font-mono break-all mt-1">{(d.user_ids ?? []).join(", ")}</p>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}