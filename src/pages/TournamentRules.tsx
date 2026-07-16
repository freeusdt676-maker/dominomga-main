import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BookOpen } from "lucide-react";

const SECTIONS = [
  { t: "1. INSCRIPTION", b: [
    "Misokatra Alatsinainy 00:00 → mikatona Alahady 13:45 (ora MG)",
    "Mise: 5 000 Ar (alaina amin'ny wallet rehefa CONFIRMER + PIN)",
    "Mila manana 5 000 Ar ao amin'ny solde",
    "Mila manana code PIN voamboatra",
    "8 mpilalao isaky ny tornoi — raha feno = mikatona",
    "ID kara-panondro mitovy = tsy azo soratana indroa (anti-duplicate)",
    "Tsy afaka misoratra raha mbola misy match tornoi tsy vita ianao",
  ]},
  { t: "2. FANDAMINANA ORA (Alahady)", b: [
    "14:00 — Quart de finale (4 lalao)",
    "14:40 — Demi-finale (2 lalao)",
    "15:20 — Petite finale (faharoa)",
    "16:00 — Finale",
    "Alatsinainy 00:00 — manomboka indray ny inscription manaraka",
  ]},
  { t: "3. LALAO", b: [
    "Mafofona AUTOMATIQUE ao anaty table du jeu rehefa tonga ny ora",
    "Tsy mila mipiana bokotra — auto-redirect",
    "Domino → règle 2 mpilalao",
    "Ludo → règle 2 mpilalao (diagonale Blue ↔ Green)",
    "Pétanque → règle 2 mpilalao",
  ]},
  { t: "4. FORFAIT (no-show)", b: [
    "Raha tsy manao move anatin'ny 3 minitra → forfait automatique",
    "Lasa resy → mihintsana avy hatrany amin'ny tornoi",
    "Ny mpilalao iray hafa lasa mpandresy → mandroso",
    "Misy notification mialoha aza an'io",
  ]},
  { t: "5. LOKA (automatique)", b: [
    "🥇 Mpandresy: 30 000 Ar (tafiditra avy hatrany amin'ny solde)",
    "🥈 2ème place: 6 000 Ar",
    "🏛️ Admin (frais d'organisation): 4 000 Ar",
    "Total: 40 000 Ar = 8 × 5 000 Ar (invariant matematika)",
  ]},
  { t: "6. AUTO-CANCEL", b: [
    "Raha latsaky ny 8 mpilalao amin'ny Alahady 13:45 → foanana ho azy",
    "Vola averina amin'ny wallet rehetra (automatique)",
    "ADM koa afaka manafoana raha misy antony manokana",
  ]},
  { t: "7. ANTI-CHEAT & FIAROVANA", b: [
    "Tsy afaka misoratra anarana ianao raha mbola misy match tornoi tsy vita",
    "Account duplicata voasakana (ID kara-panondro mitovy)",
    "Bracket atao avy hatrany amin'ny serveur (tsy azo kitihina)",
    "Audit log isaky ny dingana: register, cancel, forfeit, settle",
    "Tsy misy mahalala ny PIN-nao afa-tsy ianao",
  ]},
  { t: "8. MPIJERY (spectators)", b: [
    "Afaka jerena mivantana ny matchs rehetra (ao amin'ny pejy Tornoi)",
    "Tsy afaka manakana an'iza n'iza ny mpijery",
    "Tsy afaka miditra amin'ny lalao ny mpijery — fijerena fotsiny",
  ]},
  { t: "9. PALMARÈS & TANTARA", b: [
    "Tantara feno azo jerena ao /tournament/history",
    "Classement Top 20 ao /tournament/leaderboard",
    "Mpilalao tsirairay manana isan'ny trono azony (🏆)",
    "Vola loka totaly: tatitra mazava",
  ]},
  { t: "10. ADMINISTRATIF", b: [
    "Force advance — manery hampandeha ny dingana manaraka",
    "Force forfait — manery resy ny mpilalao iray (raha misy tranga manokana)",
    "Famerenana vola — raha misy match tsy tafita",
    "Audit log azo jerena amin'ny pejy admin",
  ]},
];

export default function TournamentRules() {
  const nav = useNavigate();
  return (
    <div className="min-h-screen luxe-bg">
      <header className="px-4 py-3 flex items-center gap-3 hairline-b">
        <Button variant="ghost" size="icon" onClick={() => nav("/tournament")} className="text-[hsl(var(--gold-1))]">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2 flex-1">
          <BookOpen className="w-6 h-6 text-[hsl(var(--gold-1))]" />
          <div>
            <p className="eyebrow">Tornoi</p>
            <h1 className="font-serif-luxe gold-luxe-text text-xl leading-none">Fitsipika Mazava</h1>
          </div>
        </div>
      </header>
      <div className="px-4 py-4 pb-24 max-w-lg mx-auto space-y-3">
        {SECTIONS.map((s) => (
          <div key={s.t} className="luxe-card p-4">
            <h2 className="font-serif-luxe text-base gold-luxe-text mb-2">{s.t}</h2>
            <ul className="text-xs text-muted-foreground space-y-1.5">
              {s.b.map((line, i) => <li key={i}>• {line}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}