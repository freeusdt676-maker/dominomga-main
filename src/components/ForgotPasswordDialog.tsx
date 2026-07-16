import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Copy, X, KeyRound } from "lucide-react";

type Step = "phone" | "name" | "gender" | "pending" | "approved";

export default function ForgotPasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [genderText, setGenderText] = useState("");
  const [reqId, setReqId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pin, setPin] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const pollRef = useRef<number | null>(null);

  const reset = () => {
    setStep("phone"); setPhone(""); setName(""); setGenderText("");
    setReqId(null); setPwd(""); setPin(""); setSecondsLeft(60); setLoading(false);
  };

  const closeAll = () => { reset(); onClose(); };

  // Cooldown ticker
  useEffect(() => {
    if (!cooldownUntil) return;
    const t = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownLeft(left);
      if (left <= 0) { setCooldownUntil(null); window.clearInterval(t); }
    }, 500);
    return () => window.clearInterval(t);
  }, [cooldownUntil]);

  // Polling: pending -> approved/rejected/expired
  useEffect(() => {
    if (!reqId || (step !== "pending" && step !== "approved")) return;
    const poll = async () => {
      const { data } = await supabase.rpc("get_recovery_status" as any, { _request_id: reqId, _phone: phone });
      const d: any = data;
      if (!d) return;
      if (d.status === "approved") {
        setPwd(d.password || ""); setPin(d.pin || "");
        const exp = d.expires_at ? new Date(d.expires_at).getTime() : Date.now() + 60000;
        setSecondsLeft(Math.max(0, Math.ceil((exp - Date.now()) / 1000)));
        setStep("approved");
      } else if (d.status === "rejected") {
        toast.error("Lavina ny fangatahanao. Andramo indray rahampitso.");
        closeAll();
      } else if (d.status === "expired") {
        closeAll();
      }
    };
    poll();
    pollRef.current = window.setInterval(poll, 3000) as any;
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqId, step]);

  // Approved countdown — auto-close after 60s
  useEffect(() => {
    if (step !== "approved") return;
    const t = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { window.clearInterval(t); closeAll(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (!open) return null;

  const submit = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("request_password_recovery" as any, {
      _phone: phone.replace(/\s/g, ""),
      _name: name.trim(),
      _gender: genderText.trim(),
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    const d: any = data;
    if (d?.ok) {
      setReqId(d.request_id);
      setStep("pending");
    } else if (d?.error === "cooldown") {
      const until = d.retry_at ? new Date(d.retry_at).getTime() : Date.now() + 5 * 60_000;
      setCooldownUntil(until);
      toast.error("Diso. Tsy afaka manohy afaka 5 min indray.");
    } else {
      const until = Date.now() + 5 * 60_000;
      setCooldownUntil(until);
      toast.error("Diso. Tsy afaka manohy afaka 5 min indray.");
    }
  };

  const copy = async (v: string) => {
    try { await navigator.clipboard.writeText(v); toast.success("Voakopia"); }
    catch { toast.error("Tsy afaka nikopia"); }
  };

  const phoneOk = /^0(34|38)\d{7}$/.test(phone.replace(/\s/g, ""));
  const norm = (s: string) =>
    s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const genderOk = ["lahy", "vavy", "hafa", "male", "female", "other"].includes(norm(genderText));

  return (
    <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4" onClick={closeAll}>
      <div className="card-felt rounded-2xl p-6 w-full max-w-md relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={closeAll} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
        <h2 className="font-display text-lg font-bold gold-text mb-1 flex items-center gap-2">
          <KeyRound className="w-5 h-5" /> Mot de passe oublié
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Mba hiarovana ny kaontinao dia tsy maintsy mamaly ireto fanontaniana ireto ianao.
        </p>

        {cooldownUntil && cooldownLeft > 0 && (
          <div className="mb-3 text-xs font-bold text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg p-2 text-center">
            Diso · Tsy afaka manohy afaka {Math.floor(cooldownLeft / 60)}min {String(cooldownLeft % 60).padStart(2, "0")}s indray
          </div>
        )}

        {step === "phone" && (
          <div className="space-y-3">
            <div>
              <Label>Numéro téléphone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="034/038 XXXXXXX" inputMode="tel" maxLength={10} />
            </div>
            <Button className="w-full btn-gold" disabled={!phoneOk || !!cooldownLeft}
              onClick={() => setStep("name")}>Manohy</Button>
          </div>
        )}

        {step === "name" && (
          <div className="space-y-3">
            <p className="text-sm">Iza no anaranao tamin'ny inscription?</p>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Anarana feno" />
            <Button className="w-full btn-gold" disabled={name.trim().length < 3}
              onClick={() => setStep("gender")}>Manohy</Button>
          </div>
        )}

        {step === "gender" && (
          <div className="space-y-3">
            <p className="text-sm">Lahy ve sa Vavy? (Soraty amin'ny tànana)</p>
            <Input
              value={genderText}
              onChange={(e) => setGenderText(e.target.value)}
              placeholder="Lahy na Vavy"
              autoCapitalize="words"
            />
            <Button className="w-full btn-gold"
              disabled={loading || !genderOk}
              onClick={submit}>{loading ? "Andraso..." : "Alefa"}</Button>
          </div>
        )}

        {step === "pending" && (
          <div className="text-center py-6">
            <div className="text-green-500 font-extrabold text-lg bg-green-500/10 border border-green-500/40 rounded-lg p-4">
              EFA VOARAY NY FANGATAHANAO · MAHANDRASA KELY AZAFADY
            </div>
            <div className="mt-3 text-xs text-muted-foreground">Aza akatona ity fenêtre ity.</div>
          </div>
        )}

        {step === "approved" && (
          <div className="space-y-3">
            <div className="text-center text-xs text-muted-foreground">
              Hihidy hoazy ity fenêtre ity afaka <b className="text-primary">{secondsLeft}s</b>
            </div>
            <div className="card-felt border border-primary/40 rounded-lg p-3">
              <div className="text-[11px] uppercase text-muted-foreground">Mot de passe</div>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 font-mono text-base font-bold">{pwd || "—"}</code>
                <Button size="sm" variant="outline" onClick={() => copy(pwd)}><Copy className="w-3 h-3" /></Button>
              </div>
            </div>
            <div className="card-felt border border-primary/40 rounded-lg p-3">
              <div className="text-[11px] uppercase text-muted-foreground">PIN</div>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 font-mono text-base font-bold">{pin || "—"}</code>
                <Button size="sm" variant="outline" onClick={() => copy(pin)}><Copy className="w-3 h-3" /></Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}