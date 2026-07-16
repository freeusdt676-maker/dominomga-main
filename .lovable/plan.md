# Ludo online — mifandray amin'ny lobby sy wallet (tsy misy Bot itsony)

Mba hitovizany amin'ny fomba fiasan'ny **Domino** ankehitriny (Lobby → mise → table → autoplay → règlement wallet), hovaiko ho tena **multiplayer en ligne** ny Ludo.

## 1) Backend (Lovable Cloud)

Table vaovao **`ludo_games`** :
- `id`, `stake`, `players_count` (2/3/4), `status` (`waiting`|`in_progress`|`settled`|`abandoned`)
- `player1_id..player4_id`, `turn_idx`, `turn_started_at`, `dice`, `dice_rolled_at`
- `state jsonb` (positions ny 16 pion + rotation)
- `winner_id`, `created_at`, `updated_at`

RPCs :
- `ludo_create_game(_stake, _players_count)` — mandray ny mise avy amin'ny wallet ary manao insert `waiting`.
- `ludo_join_and_start(_game_id)` — mandray mise, mameno seat, mihodina ho `in_progress` rehefa feno.
- `ludo_cancel_waiting(_game_id)` — refund raha waiting.
- `ludo_roll_dice(_game_id)` — server-side fair RNG (1..6), stamp `dice_rolled_at`.
- `ludo_move_pawn(_game_id, _pawn_idx)` — mihaja ny lalàna Ludo, mikapoka, miditra home, bonus turn amin'ny 6/capture/home.
- `ludo_settle(_game_id, _winner_id)` — mizara `stake * players_count * 0.9` amin'ny mpandresy, `game_win/game_loss/game_stake` transactions.

GRANT + RLS mitovy amin'ny `games` (mpilalao ihany no mahita/mamoaka action).

## 2) Edge function **`ludo-autoplay`** + pg_cron 2s

- Raha `dice` null nefa `turn_started_at` > 10s → server mikodia dés ary manao mouvement stratejika mahakasika ny pion (mitovy heuristic amin'ny bot ao amin'ny code ankehitriny), na `passTurn` raha tsy misy legal move.
- Miasa ihany koa raha mivoaka finday na tapaka data ilay pilalao.

## 3) Lobby Ludo

Pejy vaovao **`/ludo-lobby`** (mitovy structure amin'ny `Lobby.tsx` Domino):
- Fisafidianana 2P/3P/4P sy mise (`STAKE_LEVELS`).
- Lisitry ny mpilalao vonona (grouped by mise).
- `OnlineUsersList` + `LobbyPresence`.
- Bokotra "Hanohy" raha misy `ludo_games` mandeha.
- Route `/ludo` no table du jeu ; navigasiona mankany avy amin'ny lobby.

## 4) Table du jeu `/ludo/:id`

Manolo ny `src/pages/Ludo.tsx` ankehitriny :
- Mamaky `ludo_games` sy manaraka realtime subscribe.
- Ny SVG board, pion, dés efa misy — averina ampiasaina, fa ny `state` avy amin'ny DB no drainer.
- Rehefa tour ny mpilalao : bokotra dés + safidiana pion → RPC.
- Timer 10s hita, vibration raha 3s sisa (ho an'ilay tompon'ny compte ihany).
- Fanesorana ny lojika Bot rehetra sy ny `isBot` + `botChoose` local.
- Radio player + Chat (efa misy) — averina ampiasaina fa asongadina amin'ny channel supabase.

## 5) Home page

Bokotra "Ludo" mankany amin'ny `/ludo-lobby` fa tsy `/ludo` mivantana intsony.

## 6) Wallet

Mitovy amin'ny Domino :
- Mise = `game_stake` (débit avy hatrany ao amin'ny `ludo_create_game` / `ludo_join_and_start`).
- Gain = 90% ny cagnotte (10% commission), 10% refund raha `cancel_waiting`.
- Volan'olona tsy voakitika (mifanaraka amin'ny memory `money-immutable`).

## Fisafidianana teknika

- 4P azo atao ao amin'ny lobby (fa tsy 4 bots itsony).
- Autoplay 10s server-side, tsy miankina amin'ny tab manokatra.
- Fair dice via `gen_random_bytes` server-side.
- Tsy misy fanovana ny Domino, Pétanque, Wallet ; tsy asiako lalàna vaovao ny volanolona.

Manaiky ve ianao, sa misy tianao ovaina amin'ny liste (ohatra: tsy tia 4P, na tia mode "quick" 2P ihany) ?
