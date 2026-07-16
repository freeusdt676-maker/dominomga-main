import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { phoneToEmail } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import logo from "@/assets/logo.png";
import logoDomino from "@/assets/logo-domino.png";
import logoPetanque from "@/assets/logo-petanque.png";
import { Camera, Shield, X } from "lucide-react";
import { ADMIN_CODE, ADMIN_CODE_ALT } from "@/lib/constants";
import { Link } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import LiveSpectatorButton from "@/components/LiveSpectatorButton";
import ForgotPasswordDialog from "@/components/ForgotPasswordDialog";

export default function Auth() {
  const nav = useNavigate();
  const [tab, setTab] = useState("login");

  // login
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  // signup
  const [sName, setSName] = useState("");
  const [sBirth, setSBirth] = useState("");
  const [sGender, setSGender] = useState<"male"|"female"|"other">("male");
  const [sPhone, setSPhone] = useState("");
  const [sPwd, setSPwd] = useState("");
  const [sPwd2, setSPwd2] = useState("");
  const [sPin, setSPin] = useState("");
  const [sPin2, setSPin2] = useState("");
  const [sSelfie, setSSelfie] = useState<string | null>(null);
  const [acceptRules, setAcceptRules] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [loading, setLoading] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);

  const handleAdminAccess = () => {
    const c = adminCode.trim();
    if (c === ADMIN_CODE || c === ADMIN_CODE_ALT) {
      sessionStorage.setItem("admin_code_ok", "1");
      toast.success("Code marina");
      setAdminOpen(false);
      setAdminCode("");
      nav("/admin");
    } else {
      toast.error("Code diso");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const cleanPhone = phone.trim().replace(/\s/g, "");
    const cleanPwd = password.trim();
    // Anti-brute-force: jereo aloha raha mihidy
    const { data: lockData } = await supabase.rpc("check_login_lockout", { _phone: cleanPhone });
    if (lockData && typeof lockData === "object" && (lockData as any).locked) {
      setLoading(false);
      return toast.error("Voasakana 15 min noho ny fanandramana diso be loatra. Andraso.");
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: phoneToEmail(cleanPhone), password: cleanPwd });
    setLoading(false);
    if (error) {
      await supabase.rpc("record_login_attempt", { _phone: cleanPhone, _success: false });
      if (error.message?.toLowerCase().includes("not confirmed")) {
        return toast.error("Mbola eo am-panamarinana ny mombamomba anao ny Admin.");
      }
      return toast.error("Numéro na mot de passe diso");
    }
    await supabase.rpc("record_login_attempt", { _phone: cleanPhone, _success: true });
    // Mijery raha pending
    if (data.user) {
      const { data: prof } = await supabase.from("profiles").select("account_status").eq("user_id", data.user.id).maybeSingle();
      if (prof?.account_status === "pending") {
        await supabase.auth.signOut();
        return toast.error("Mbola eo am-panamarinana ny mombamomba anao ny Admin.");
      }
      if (prof?.account_status === "blocked") {
        await supabase.auth.signOut();
        return toast.error("Voasakana ny kaontinao. Mifandraisa amin'ny Admin.");
      }
    }
    toast.success("Tonga soa!");
    nav("/");
  };

  // Camera lifecycle
  useEffect(() => {
    if (!camOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e: any) {
        toast.error("Tsy nahazo fahazoan'ny camera. Avelao ny accès.");
        setCamOpen(false);
      }
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [camOpen]);

  const captureSelfie = () => {
    const v = videoRef.current;
    if (!v) return;
    const size = Math.min(v.videoWidth, v.videoHeight) || 480;
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const sx = (v.videoWidth - size) / 2;
    const sy = (v.videoHeight - size) / 2;
    // miroir mba mitovy amin'ny preview
    ctx.translate(size, 0); ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, size, size, 0, 0, size, size);
    const data = c.toDataURL("image/jpeg", 0.85);
    setSSelfie(data);
    setCamOpen(false);
  };

  const ageOK = (iso: string) => {
    if (!iso) return false;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age >= 18;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhoneIn = sPhone.replace(/\s/g, "");
    if (!/^0(33|34|35|38)\d{7}$/.test(cleanPhoneIn))
      return toast.error("Numéro téléphone diso (Yas/MVola: 034/038 · Airtel: 033/035 — XXXXXXX)");
    if (sName.trim().length < 3) return toast.error("Anarana certifié Mobile Money tsy ampy");
    if (!sBirth || !ageOK(sBirth)) return toast.error("Daty nahaterahana tsy mety na tsy ampy 18 taona");
    if (sPwd.length < 6) return toast.error("Mot de passe ≥ 6 caractères");
    if (sPwd !== sPwd2) return toast.error("Mot de passe tsy mitovy");
    if (!/^\d{4}$/.test(sPin)) return toast.error("PIN: 4 chiffres");
    if (sPin !== sPin2) return toast.error("PIN tsy mitovy");
    if (!sSelfie) return toast.error("Maka sary selfie aloha azafady");
    if (!acceptRules) return toast.error("Tsy maintsy ekenao ny fitsipika sy règle du jeu");

    setLoading(true);
    const cleanPhone = cleanPhoneIn;
    try {
      // Mampiasa ny edge function signup-kyc mba hampidirina ny selfie + auto-confirm
      const { data, error } = await supabase.functions.invoke("signup-kyc", {
        body: {
          email: phoneToEmail(cleanPhone),
          password: sPwd.trim(),
          mvola_name: sName.trim(),
          phone: cleanPhone,
          birth_date: sBirth,
          gender: sGender,
          selfie_base64: sSelfie,
          pin: sPin,
        },
      });
      setLoading(false);
      const errMsg = (data as any)?.error || (error as any)?.message;
      if (errMsg) return toast.error(errMsg);
      toast.success("Inscription vita! Miandry validation amin'ny ADMINISTRATIF.");
      setTab("login");
      setSName(""); setSBirth(""); setSPhone(""); setSPwd(""); setSPwd2("");
      setSPin(""); setSPin2(""); setSSelfie(null);
      setAcceptRules(false);
    } catch (err: any) {
      setLoading(false);
      toast.error(String(err?.message ?? err));
    }
  };

  return (
    <div className="min-h-screen felt-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <img src={logo} alt="DOMINO MGA" className="w-20 h-20 mb-2" />
          <h1 className="text-3xl font-display font-bold gold-text">DOMINO MGA</h1>
          <p className="text-[11px] tracking-[0.3em] uppercase text-muted-foreground mt-1">Domino · Pétanque</p>
          <div className="flex items-center justify-center gap-4 mt-4">
            <img src={logoDomino} alt="Domino" className="w-14 h-14 drop-shadow-[0_2px_8px_rgba(212,175,55,0.4)]" loading="lazy" />
            <img src={logoPetanque} alt="Pétanque" className="w-14 h-14 drop-shadow-[0_2px_8px_rgba(212,175,55,0.4)]" loading="lazy" />
          </div>
        </div>

        <div className="card-felt rounded-2xl p-6">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid grid-cols-2 w-full mb-4">
              <TabsTrigger value="login">Connexion</TabsTrigger>
              <TabsTrigger value="signup">Inscription</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-3">
                <div>
                  <Label>Numéro téléphone</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="033 / 034 / 035 / 038 XXXXXXX" inputMode="tel" />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    💛 <b>Yas/MVola</b>: 034 · 038 &nbsp;·&nbsp; ❤️ <b>Airtel</b>: 033 · 035
                  </p>
                </div>
                <div>
                  <Label>Mot de passe</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" disabled={loading} className="w-full btn-gold">Hiditra</Button>
                <p className="text-xs text-muted-foreground text-center">
                  Hadinoanao ny mot de passe? Mifandraisa amin'ny ADMINISTRATIF aorian'ny fidirana.
                </p>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <div className="mvola-banner mb-3 text-sm">
                💛❤️ INSCRIPTION MVola / Airtel Money — Fenoy daholo ireto mba ho ankatoavin'ny ADMINISTRATIF
              </div>
              <form onSubmit={handleSignup} className="space-y-3">
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wide">Numéro téléphone</Label>
                  <Input value={sPhone} onChange={(e) => setSPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="033/034/035/038 XXXXXXX" inputMode="tel" maxLength={10} />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    💛 <b>Yas/MVola</b>: 034 · 038 &nbsp;·&nbsp; ❤️ <b>Airtel Money</b>: 033 · 035
                  </p>
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wide">Anarana certifié Mobile Money</Label>
                  <Input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Jean Claude" />
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wide">Daty nahaterahana (YYYY/MM/JJ)</Label>
                  <Input type="date" value={sBirth} onChange={(e) => setSBirth(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wide">Sexe (LAHY/VAVY/HAFA)</Label>
                  <Select value={sGender} onValueChange={(v: any) => setSGender(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">LAHY</SelectItem>
                      <SelectItem value="female">VAVY</SelectItem>
                      <SelectItem value="other">HAFA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wide">Mot de passe</Label>
                  <Input type="password" value={sPwd} onChange={(e) => setSPwd(e.target.value)} placeholder="DE4erStv." />
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wide">Confirmer mot de passe</Label>
                  <Input type="password" value={sPwd2} onChange={(e) => setSPwd2(e.target.value)} placeholder="DE4erStv." />
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wide">PIN</Label>
                  <Input type="password" inputMode="numeric" maxLength={4} value={sPin}
                    onChange={(e) => setSPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" />
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wide">Confirmer PIN</Label>
                  <Input type="password" inputMode="numeric" maxLength={4} value={sPin2}
                    onChange={(e) => setSPin2(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" />
                </div>
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wide">Selfie (sary tava)</Label>
                  {sSelfie ? (
                    <div className="relative inline-block mt-1">
                      <img src={sSelfie} alt="selfie" className="w-32 h-32 rounded-xl object-cover border-2 border-[#f7971e]" />
                      <button type="button" onClick={() => setSSelfie(null)}
                        className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-1">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <Button type="button" onClick={() => setCamOpen(true)} className="w-full btn-mvola mt-1">
                      <Camera className="w-4 h-4 mr-2" /> MAKA SARY
                    </Button>
                  )}
                </div>
                <Button type="submit" disabled={loading} className="w-full btn-mvola text-base py-6">
                  {loading ? "Andraso..." : "HISORATRA ANARANA"}
                </Button>
                <div className="flex items-start gap-2 pt-2 border-t border-primary/10">
                  <Checkbox id="accept" checked={acceptRules} onCheckedChange={(v) => setAcceptRules(!!v)} className="mt-1" />
                  <label htmlFor="accept" className="text-xs leading-relaxed cursor-pointer">
                    Manaiky aho ny <Link to="/rules" target="_blank" className="text-primary underline font-bold">Fitsipika sy Règle du jeu</Link>: fitondran-tena mendrika, fahamatorana, anarana MVOLA marina, 18 taona+, compte tokana, fanajana ny ADMINISTRATIF.
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground text-center mt-2">
                  Aorian'ny fanindriana, miandry validation amin'ny ADMINISTRATIF. Raha misy diso na banga, tsy ho tafiditra ny compte.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Camera modal */}
      {camOpen && (
        <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4" onClick={() => setCamOpen(false)}>
          <div className="bg-card rounded-2xl p-4 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold mb-2 mvola-gradient-text text-center">MAKA SARY TAVA</h3>
            <video ref={videoRef} className="w-full rounded-xl bg-black" style={{ transform: "scaleX(-1)" }} playsInline muted />
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Button variant="outline" onClick={() => setCamOpen(false)}>Aoka</Button>
              <Button className="btn-mvola" onClick={captureSelfie}><Camera className="w-4 h-4 mr-2" /> Maka</Button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setAdminOpen(true)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl btn-gold shadow-2xl font-display font-bold text-sm"
        aria-label="ADMINISTRATIF"
      >
        <Shield className="w-4 h-4" />
        ADMINISTRATIF
      </button>

      <LiveSpectatorButton position="auth" />

      <button
        type="button"
        onClick={() => setForgotOpen(true)}
        className="fixed bottom-20 right-4 z-50 px-3 py-2 rounded-xl bg-card/90 border border-primary/40 text-primary text-xs font-bold shadow-xl hover:bg-card"
        aria-label="Mot de passe oublié"
      >
        🔑 Mot de passe oublié
      </button>
      <ForgotPasswordDialog open={forgotOpen} onClose={() => setForgotOpen(false)} />

      {adminOpen && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setAdminOpen(false)}>
          <div className="card-felt rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg font-bold gold-text mb-3 flex items-center gap-2">
              <Shield className="w-5 h-5" /> Code ADMINISTRATIF
            </h2>
            <Input
              type="password"
              value={adminCode}
              onChange={(e) => setAdminCode(e.target.value)}
              placeholder="Code..."
              onKeyDown={(e) => e.key === "Enter" && handleAdminAccess()}
              autoFocus
            />
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Button variant="outline" onClick={() => { setAdminOpen(false); setAdminCode(""); }}>Hiala</Button>
              <Button className="btn-gold" onClick={handleAdminAccess}>Hiditra</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
