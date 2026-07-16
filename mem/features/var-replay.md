---
name: VAR replay in Admin history
description: How the admin VAR replay modal renders each game type
type: feature
---
In Admin.tsx "Historique" tab, clicking a game opens a Dialog showing:
- Domino: full `game_moves` list (tile + side + player + timestamp) rendered with DominoTile
- Ludo: latest `ludo_games` row with `current_turn_seat`, `last_dice`, and full `pawns` JSON (collapsible)
- Pétanque: latest `petanque_games` row with scores, round, and full `state` JSON (balls + jack)
- All three: `verify_game_settlement` RPC result showing expected vs actual commission and pot (green/red)
