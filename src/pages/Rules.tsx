import { Button } from "@/components/ui/button";
import { ArrowLeft, BookOpen, Gamepad2, ArrowDownCircle, ArrowUpCircle, Smartphone, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Rules() {
  const nav = useNavigate();
  return (
    <div className="min-h-screen felt-bg pb-20">
      <header className="p-4 flex items-center gap-3 border-b border-primary/20 sticky top-0 bg-background/80 backdrop-blur z-10">
        <Button variant="ghost" size="icon" onClick={() => nav("/")}><ArrowLeft /></Button>
        <h1 className="font-display text-xl font-bold gold-text">Règle sy Tutorial</h1>
      </header>

      <div className="p-4 max-w-lg mx-auto">
        <Tabs defaultValue="discipline">
          <TabsList className="grid grid-cols-5 w-full mb-3 h-auto">
            <TabsTrigger value="discipline" className="text-[10px] py-2"><Shield className="w-3 h-3 mr-1"/>Fitsipika</TabsTrigger>
            <TabsTrigger value="rules" className="text-[10px] py-2"><BookOpen className="w-3 h-3 mr-1"/>Règle</TabsTrigger>
            <TabsTrigger value="play" className="text-[10px] py-2"><Gamepad2 className="w-3 h-3 mr-1"/>Lalao</TabsTrigger>
            <TabsTrigger value="depot" className="text-[10px] py-2"><ArrowDownCircle className="w-3 h-3 mr-1"/>Dépôt</TabsTrigger>
            <TabsTrigger value="retrait" className="text-[10px] py-2"><ArrowUpCircle className="w-3 h-3 mr-1"/>Retrait</TabsTrigger>
          </TabsList>

          <TabsContent value="discipline">
            <div className="card-felt rounded-2xl p-5 text-sm space-y-3 leading-relaxed">
              <h2 className="font-display text-lg gold-text flex items-center gap-2"><Shield className="w-5 h-5"/> Fitsipika sy Discipline</h2>
              <p className="text-muted-foreground">Mba ho matotra sy hahatokisana ny app, **tsy maintsy hajaina** ireto fitsipika ireto:</p>
              <ol className="list-decimal pl-5 space-y-2">
                <li><b>Fitondran-tena mendrika</b>: tsy azo atao ny manompa, manaratsy, na maneso mpilalao hafa ao amin'ny chat na lalao.</li>
                <li><b>Fahamatorana eo am-pilalaovana</b>: aza atao mihintsy ny manakorontana ny lalao (manala wifi, mamela mandeha tour, sns) — voasakana avy hatrany ny compte raha tratra.</li>
                <li><b>Famakiana ny règle du jeu</b>: tsy maintsy vakianao tsara ny règle alohan'ny hilalao. Tsy raisina ny fitarainana raha tsy fantatra ny règle.</li>
                <li><b>Anarana sy MVOLA marina</b>: ny anarana sy numéro ampidirinao dia <b>tsy maintsy mifanaraka amin'ny MVOLA</b> anao. Tsy ho voarainareo ny dépôt/retrait raha tsy mifanaraka.</li>
                <li><b>Compte tokana</b>: olona iray = compte iray ihany. Voafafa daholo ny compte raha hita fa misy <b>doublons</b>.</li>
                <li><b>Selfie marina</b>: ilay sary tava alefanao dia tsy maintsy <b>ianao tena izy</b>. Tsy ekena ny sary nalain-tahaka.</li>
                <li><b>18 taona miakatra</b>: voarara ho an'ny zaza latsaky ny 18 taona ny app.</li>
                <li><b>Tsy mamadika</b>: aza miezaka manaikitra ny solde, manodina ny lalao, na manakorontana ny système. Voasakana mandrakizay raha tratra.</li>
                <li><b>Mise sy Gain</b>: ny vola napetraka dia tsy azo averina raha tsy resy/nandresy ny lalao. Ny gain dia mety mandeha amin'ny wallet anao.</li>
                <li><b>Chat madio</b>: ny chat dia ho an'ny resaka mahasoa fotsiny. Ny hafatra ratsy dia hofafan'ny ADMINISTRATIF ary ho voasakana ilay namoaka azy.</li>
                <li><b>Fanajana ny ADMINISTRATIF</b>: ny fanapahan-kevitr'ny ADMINISTRATIF dia farany. Ny fanaratsiana ny Admin = sakana mandrakizay.</li>
              </ol>
              <div className="mvola-banner mt-3 text-xs">
                ⚠️ Manaiky ireo fitsipika ireo daholo ny olona rehetra manao inscription. Raha tsy ekenao, aza misoratra anarana.
              </div>
            </div>
          </TabsContent>

          <TabsContent value="rules">
            <div className="card-felt rounded-2xl p-5 text-sm space-y-3 leading-relaxed">
              <h2 className="font-display text-lg gold-text">Règle du jeu — Domino</h2>
              <ol className="list-decimal pl-5 space-y-2">
                <li>Mametraka mise alohan'ny lalao. Mise: <b>1 000 Ar</b> ka hatramin'ny <b>10 000 Ar</b>.</li>
                <li>Lalao 28 pièces. Pièce iray = roa fizarana (0–6 pwen).</li>
                <li>Mpilalao tsirairay = 7 pièces eo am-piandohana. Ny sisa = pioche.</li>
                <li>Ilay manana ny pièce avo indrindra no manomboka, fa mahazo mametraka <b>na inona na inona</b> pièce.</li>
                <li>Ny tour mihodina <b>miankavia</b> isaky ny tour vaovao.</li>
                <li>Raha tsy misy pièce mety, maka anatin'ny pioche mandra-pahitana ny mety.</li>
                <li>Ny voalohany mahalany ny pièce-ny no <b>nandresy</b>.</li>
                <li>Raha "bloc" (tsy misy mety mametraka), ny manana pwen kely indrindra no resy.</li>
                <li><b>Maty 120</b>: rehefa feno 120 pwen ny pwen-n'ny lalao iray, mipoitra ny mpandresy.</li>
                <li><b>Maty 80</b>: rehefa feno 80 pwen, mipoitra ny mpandresy.</li>
                <li>Tour iray = <b>20 segondra</b> raha ela kokoa, manjary automatique ny coup.</li>
                <li>Ny gain = (Mise − 10% commission) × isan'ny mpilalao.</li>
                <li>Voarara ny milalao amina latabatra maro miaraka.</li>
                <li>Lalao tsy maintsy vita anatin'ny <b>7 andro</b>, raha tsy izany resy automatique.</li>
              </ol>
            </div>
          </TabsContent>

          <TabsContent value="play">
            <div className="card-felt rounded-2xl p-5 text-sm space-y-4 leading-relaxed">
              <h2 className="font-display text-lg gold-text">Tutoriel: Fomba filalaovana</h2>
              <div>
                <h3 className="font-bold text-primary mb-1">1. Mitady mpilalao</h3>
                <p>Tsindrio ny <b>DOMINO</b> ao amin'ny Home → safidio <b>2P na 3P</b> → safidio ny <b>mode</b> (Hand/Maty 80/Maty 120) → safidio ny <b>mise</b> → tsindrio <b>"Mitady adversaire"</b>.</p>
              </div>
              <div>
                <h3 className="font-bold text-primary mb-1">2. Manomboka ny lalao</h3>
                <p>Rehefa hita ny adversaire, hipoitra ny tableau de jeu. Ny pièce-nao dia eo ambany. Ny tour-nao = mavomavo ny indication.</p>
              </div>
              <div>
                <h3 className="font-bold text-primary mb-1">3. Mametraka pièce</h3>
                <p>Tsindrio ny pièce, dia tsindrio ny <b>"Gauche"</b> na <b>"Droite"</b> hametrahana azy. Raha tsy misy mety, tsindrio <b>"Pioche"</b> na <b>"Pass"</b>.</p>
              </div>
              <div>
                <h3 className="font-bold text-primary mb-1">4. Chat anatin'ny lalao</h3>
                <p>Tsindrio ny ikon-message hisokafan'ny chat. Afaka mandefa hafatra haingana amin'ny mpilalao hafa ianao.</p>
              </div>
              <div>
                <h3 className="font-bold text-primary mb-1">5. Vita ny lalao</h3>
                <p>Hipoitra <b>NANDRESY</b> (maitso) na <b>RESY</b> (mena) ka asehoana ny vola azonao na very.</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="depot">
            <div className="card-felt rounded-2xl p-5 text-sm space-y-3 leading-relaxed">
              <h2 className="font-display text-lg gold-text">Tutoriel: Fanaovana Dépôt</h2>
              <ol className="list-decimal pl-5 space-y-2">
                <li>Mandefa vola amin'ny <b>MVOLA</b> mankany amin'ny numéro: <b>0345023006</b> (Jean Rolland).</li>
                <li>Tahirizo ny <b>référence</b> nomen'ny MVOLA anao.</li>
                <li>Sokafy ny app → tsindrio <b>Wallet</b> → onglet <b>Dépôt</b>.</li>
                <li>Soraty ny <b>montant</b>, ny <b>numéro nandefasanao</b>, ary ny <b>référence MVOLA</b>.</li>
                <li>Tsindrio <b>"Mangataka dépôt"</b> → miandry valisoa avy amin'ny ADMINISTRATIF (afaka 5 minitra ka hatramin'ny 1 ora).</li>
                <li>Rehefa voavalida, hihamitombo ny solde-nao automatique.</li>
              </ol>
              <div className="mvola-banner mt-3 text-xs">⚠️ Tsy maintsy mitovy amin'ny anarana certifié MVOLA-nao ny anarana ao amin'ny compte-nao.</div>
            </div>
          </TabsContent>

          <TabsContent value="retrait">
            <div className="card-felt rounded-2xl p-5 text-sm space-y-3 leading-relaxed">
              <h2 className="font-display text-lg gold-text">Tutoriel: Fanaovana Retrait</h2>
              <ol className="list-decimal pl-5 space-y-2">
                <li>Sokafy <b>Wallet</b> → onglet <b>Retrait</b>.</li>
                <li>Soraty ny <b>montant</b> tianao halaina.</li>
                <li>Soraty ny <b>numéro MVOLA</b> handefasana ny vola sy ny <b>anarana certifié</b>.</li>
                <li>Ampidiro ny <b>code PIN 4 chiffres</b> nataonao tamin'ny inscription.</li>
                <li>Tsindrio <b>"Mangataka retrait"</b>.</li>
                <li>Ho alefan'ny ADMINISTRATIF amin'ny MVOLA-nao afaka kelikely ny vola.</li>
              </ol>
              <div className="mvola-banner mt-3 text-xs">⚠️ Mety hisy commission MVOLA kely. Hajaina ny anarana sy numéro marina mba tsy hahavery vola.</div>
              <h3 className="font-display text-primary mt-3">Fampiasana ny app</h3>
              <ul className="list-disc pl-5 space-y-1 text-xs">
                <li><b>Home</b>: ahitana ny solde, lalao, chat, profile.</li>
                <li><b>Discussions</b>: hifampiresahana amin'ny mpilalao hafa.</li>
                <li><b>Chat Admin</b>: hifandraisana mivantana amin'ny ADMINISTRATIF.</li>
                <li><b>Profile</b>: ahitana ny historique sy score.</li>
                <li>Mba <b>hampidirana ny app</b> ao amin'ny finday: tsindrio "Ajouter à l'écran d'accueil" ao amin'ny navigateur.</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
