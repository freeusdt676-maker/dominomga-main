import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, Copy, ShieldAlert } from "lucide-react";
import { fmtAr } from "@/lib/constants";
import { toast } from "sonner";
export default function Wallet() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [balance, setBalance] = useState(0);
  const [txs, setTxs] = useState<any[]>([]);
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [pin, setPin] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawPhone, setWithdrawPhone] = useState("");
  const [withdrawName, setWithdrawName] = useState("");
  const [operator, setOperator] = useState<"mvola" | "airtel">("mvola");

  const OPERATORS = {
    mvola:  { label: "MVola",        phone: "0345023006", name: "Jean Rolland",              color: "from-yellow-400 to-orange-500", tag: "💛" },
    airtel: { label: "Airtel Money", phone: "0336470412", name: "JeanRolland Ratovoheriniaina", color: "from-red-500 to-red-700",     tag: "❤️" },
  } as const;
  const OP = OPERATORS[operator];
  const ADMIN_PHONE = OP.phone;
  const ADMIN_NAME = OP.name;

  const copy = async (txt: string, label: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      toast.success(`${label} voakopia ✓`);
    } catch {
      toast.error("Tsy afaka nikopia");
    }
  };

  const load = async () => {
    if (!user) return;
    const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", user.id).single();
    setBalance(Number(w?.balance ?? 0));
    const { data: t } = await supabase.from("transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);
    setTxs(t ?? []);
  };
  useEffect(() => { load(); }, [user]);

  const submitDeposit = async () => {
    const a = Number(amount);
    if (a < 100) return toast.error("Min 100 Ar");
    if (!ref.trim()) return toast.error(`Référence ${OP.label} ilaina`);
    // Block: at most ONE pending deposit/withdrawal per user.
    const { data: pendings } = await supabase
      .from("transactions")
      .select("id, type")
      .eq("user_id", user!.id)
      .eq("status", "pending")
      .in("type", ["deposit", "withdrawal"])
      .limit(1);
    if (pendings && pendings.length > 0) {
      return toast.error("Mbola misy demande tsy mbola voavaha — andraso mialoha");
    }
    const taggedRef = `[${OP.label.toUpperCase()}] ${ref.trim()}`;
    const { error } = await supabase.from("transactions").insert({ user_id: user!.id, type: "deposit", amount: a, mvola_reference: taggedRef, status: "pending" });
    if (error) return toast.error(error.message);
    toast.success("Demande alefa amin'ny admin");
    setAmount(""); setRef(""); load();
  };

  const submitWithdraw = async () => {
    if (!user) return toast.error("Tsy nahita compte");
    // Rate limit: 3 demandes / 10 min
    const { data: rl } = await supabase.rpc("check_rate_limit", { _action: "withdraw_request", _max: 3, _window_seconds: 600 });
    if (rl === false) return toast.error("Be loatra ny demande. Andraso 10 min.");
    const a = Number(withdrawAmount);
    if (a < 1000) return toast.error("Min 1000 Ar");
    if (a > balance) return toast.error("Solde tsy ampy");
    const cleanPhone = withdrawPhone.replace(/\s/g, "");
    if (!/^0\d{9}$/.test(cleanPhone)) return toast.error("Numéro téléphone diso (10 chiffres)");
    // Operator prefix check
    const prefix = cleanPhone.slice(0, 3);
    if (operator === "mvola" && !["034", "038"].includes(prefix))
      return toast.error("Numéro MVola tokony 034/038 XXXXXXX");
    if (operator === "airtel" && !["033", "035"].includes(prefix))
      return toast.error("Numéro Airtel tokony 033/035 XXXXXXX");
    if (!withdrawName.trim()) return toast.error(`Anarana certifié ${OP.label} ilaina`);
    if (!/^\d{4,6}$/.test(pin)) return toast.error("PIN diso");
    // Block: at most ONE pending deposit/withdrawal per user.
    const { data: pendings } = await supabase
      .from("transactions")
      .select("id, type")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .in("type", ["deposit", "withdrawal"])
      .limit(1);
    if (pendings && pendings.length > 0) {
      return toast.error("Mbola misy demande tsy mbola voavaha — andraso mialoha");
    }

    // Verify PIN against profiles.pin_plain (set during signup)
    const { data: prof, error: pErr } = await supabase
      .from("profiles").select("pin_plain").eq("user_id", user.id).maybeSingle();
    if (pErr) return toast.error("Tsy nahita profile: " + pErr.message);
    if (!prof?.pin_plain) return toast.error("Tsy mbola voafaritra ny PIN-nao");
    if (prof.pin_plain !== pin) return toast.error("PIN diso");

    const { error } = await supabase.from("transactions").insert({
      user_id: user.id,
      type: "withdrawal",
      amount: a,
      mvola_phone: cleanPhone,
      mvola_reference: `[${OP.label.toUpperCase()}] ${withdrawName.trim()}`,
      status: "pending",
    });
    if (error) return toast.error("Erreur: " + error.message);
    await supabase.rpc("log_audit", { _action: "withdraw_request", _meta: { amount: a, mvola_phone: cleanPhone } });
    toast.success("Demande retrait alefa");
    setWithdrawAmount(""); setWithdrawPhone(""); setWithdrawName(""); setPin(""); load();
  };

  return (
    <div className="min-h-screen felt-bg">
      <header className="p-4 flex items-center gap-3 border-b border-primary/20">
        <Button variant="ghost" size="icon" onClick={() => nav("/")}><ArrowLeft /></Button>
        <h1 className="font-display text-xl font-bold gold-text">Wallet</h1>
      </header>

      <div className="p-4 max-w-lg mx-auto space-y-4">
        {/* Operator selector */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setOperator("mvola")}
            className={`rounded-2xl p-3 border-2 font-bold text-sm transition ${operator === "mvola" ? "border-yellow-400 bg-gradient-to-br from-yellow-400/20 to-orange-500/20 shadow-lg" : "border-border/40 bg-card/40 opacity-60"}`}
          >
            <div className="text-2xl mb-1">💛</div>
            MVola
          </button>
          <button
            onClick={() => setOperator("airtel")}
            className={`rounded-2xl p-3 border-2 font-bold text-sm transition ${operator === "airtel" ? "border-red-500 bg-gradient-to-br from-red-500/20 to-red-700/20 shadow-lg" : "border-border/40 bg-card/40 opacity-60"}`}
          >
            <div className="text-2xl mb-1">❤️</div>
            Airtel Money
          </button>
        </div>

        {/* Numéro & anarana administratif — BIG en haut */}
        <div className={`card-felt rounded-2xl p-5 space-y-3 border-2 ${operator === "mvola" ? "border-yellow-400/60" : "border-red-500/60"}`}>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground text-center">
            Numéro administratif {OP.label}
          </p>
          <button
            onClick={() => copy(ADMIN_PHONE, "Numéro")}
            className="w-full flex items-center justify-between gap-3 bg-background/40 rounded-xl p-3 border border-primary/30 hover:border-primary transition"
          >
            <p className="font-mono font-extrabold gold-text text-3xl sm:text-4xl tracking-wider">
              {ADMIN_PHONE}
            </p>
            <Copy className="w-5 h-5 text-primary shrink-0" />
          </button>
          <button
            onClick={() => copy(ADMIN_NAME, "Anarana")}
            className="w-full flex items-center justify-between gap-3 bg-background/40 rounded-xl p-3 border border-primary/30 hover:border-primary transition"
          >
            <p className="font-display font-extrabold gold-text text-xl sm:text-2xl">
              {ADMIN_NAME}
            </p>
            <Copy className="w-5 h-5 text-primary shrink-0" />
          </button>
        </div>

        <div className="card-felt rounded-2xl p-5 text-center">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Solde ankehitriny</p>
          <p className="text-2xl sm:text-3xl font-display gold-text font-bold mt-1">{fmtAr(balance)}</p>
        </div>

        <Tabs defaultValue="deposit" className="card-felt rounded-2xl p-4">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="deposit"><ArrowDownToLine className="w-4 h-4 mr-2" />Dépôt</TabsTrigger>
            <TabsTrigger value="withdraw"><ArrowUpFromLine className="w-4 h-4 mr-2" />Retrait</TabsTrigger>
          </TabsList>

          <TabsContent value="deposit" className="space-y-3 mt-4">
            <div className="rounded-xl bg-primary/10 border border-primary/30 p-3 text-xs space-y-2">
              <p className="font-bold gold-text">📥 Famolavolana Dépôt · {OP.label}</p>
              <p>1. Mandefa <b>{OP.label}</b> amin'ny numéro administratif eto ambany.</p>
              <div className="flex items-center justify-between bg-card/60 rounded-lg p-2 border border-primary/20">
                <div>
                  <p className="text-[10px] text-muted-foreground">Numéro téléphone</p>
                  <p className="font-mono font-bold gold-text">{ADMIN_PHONE}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => copy(ADMIN_PHONE, "Numéro")}>
                  <Copy className="w-3 h-3 mr-1" />Copier
                </Button>
              </div>
              <div className="flex items-center justify-between bg-card/60 rounded-lg p-2 border border-primary/20">
                <div>
                  <p className="text-[10px] text-muted-foreground">Anarana certifié {OP.label}</p>
                  <p className="font-bold gold-text">{ADMIN_NAME}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => copy(ADMIN_NAME, "Anarana")}>
                  <Copy className="w-3 h-3 mr-1" />Copier
                </Button>
              </div>
              <p>2. Avereno eto amin'ny formulaire ny montant sy référence {OP.label}.</p>
              <p>3. Ny administratif no hanamarina (mahazo notification ianao).</p>
            </div>
            <div><Label>Montant (Ar)</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100000" /></div>
            <div><Label>Référence transaction {OP.label}</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={operator === "mvola" ? "MP..." : "AM..."} /></div>
            <Button className="w-full btn-gold" onClick={submitDeposit}>Mandefa demande</Button>
          </TabsContent>

          <TabsContent value="withdraw" className="space-y-3 mt-4">
            <div className="rounded-xl bg-primary/10 border border-primary/30 p-3 text-xs">
              <p className="font-bold gold-text mb-1">📤 Famolavolana Retrait · {OP.label}</p>
              <p>Soraty ny numéro téléphone {operator === "mvola" ? "MVola (034/038)" : "Airtel (033/035)"} sy ny anarana certifié {OP.label} handefasana ny vola, dia ampidiro ny PIN-nao.</p>
            </div>
            <div><Label>Montant (Ar)</Label><Input type="number" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder="10000" /></div>
            <div><Label>Numéro {OP.label} (handefasana ny vola)</Label><Input inputMode="tel" value={withdrawPhone} onChange={(e) => setWithdrawPhone(e.target.value)} placeholder={operator === "mvola" ? "034XXXXXXX" : "033XXXXXXX"} /></div>
            <div><Label>Anarana certifié {OP.label}</Label><Input value={withdrawName} onChange={(e) => setWithdrawName(e.target.value)} placeholder="Jean Claude" /></div>
            <div><Label>Code PIN</Label><Input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="1234" /></div>
            <Button className="w-full btn-gold" onClick={submitWithdraw}>Mangataka retrait</Button>
          </TabsContent>
        </Tabs>

        <div className="card-felt rounded-2xl p-4">
          <h3 className="font-display font-bold mb-3">Tantara</h3>
          <div className="space-y-2 max-h-[40vh] overflow-y-auto">
            {txs.map((t) => (
              <div key={t.id} className="flex justify-between items-center text-sm border-b border-border/30 pb-2">
                <div>
                  <p className="font-medium">{labelType(t.type)}</p>
                  <p className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString("fr-FR")}</p>
                </div>
                <div className="text-right">
                  <p className={`font-bold ${["deposit","game_win","refund"].includes(t.type) ? "text-success" : "text-destructive"}`}>
                    {["deposit","game_win","refund"].includes(t.type) ? "+" : "-"}{fmtAr(t.amount)}
                  </p>
                  <p className="text-xs">{labelStatus(t.status)}</p>
                </div>
              </div>
            ))}
            {txs.length === 0 && <p className="text-center text-xs text-muted-foreground py-4">Tsy misy transaction</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function labelType(t: string) {
  return { deposit:"Dépôt", withdrawal:"Retrait", game_win:"Gain", game_loss:"Perte", game_stake:"Mise", refund:"Remboursement" }[t] ?? t;
}
function labelStatus(s: string) {
  return { pending:"⏳ En attente", approved:"✓ Approuvé", rejected:"✗ Refusé", completed:"✓ Vita" }[s] ?? s;
}
