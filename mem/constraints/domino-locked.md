---
name: Domino locked
description: Domino game is frozen — no changes without explicit user prompt
type: constraint
---
The Domino game is considered finished and stable. Do NOT modify any Domino-related code, parameters, timers, animations, UI, or engine logic unless the user explicitly asks for a Domino change in a prompt.

Frozen files (do not edit unless explicitly requested):
- src/pages/Game.tsx (Domino game page)
- src/pages/Lobby.tsx (Domino lobby)
- src/lib/dominoEngine.ts
- src/components/DominoTile.tsx
- Domino-related sections of src/index.css (felt board, domino arena, sad/win animations, button active feedback)

Frozen parameters (do not change without explicit prompt):
- Domino turn timeout: 15s
- Lobby waiting room expiry: 2 minutes
- Auto-place behavior at 15s timeout

**Why:** The user confirmed Domino is "tena tsara be" (perfect) and asked for an explicit lock so nothing changes automatically. Any drift breaks the validated UX.

**How to apply:** If a user request would require touching Domino code as a side effect (refactors, cross-cutting cleanup, security sweeps, design system changes), either skip the Domino portion or ask the user before proceeding.

## Explicit revisions (2026-05-29)
- Removed "Maty atànana" mode (`hand`) from Lobby + Game. Only `d120` and `d80` remain selectable; legacy `hand` rows fall back to 120-target behaviour.
- Removed "maty atànana" as an instant-win reason in `finishRound`. Blocked endgame still resolves by lowest pipsTotal via `finishBlocked` (no mode renaming).
- Turn rotation is **contraire montre / mankany ANKAVIA** as understood from the live table order (3P: P1 → P2 → P3 → P1). Explicitly corrected by user on 2026-07-04. Opener rotates round-robin per round (round N opener = ids[(N-1) % count]) — direction unchanged.

## Domino WIN conditions (LOCKED — 2026-06-03, FINAL)
Four conditions make a player WIN THE GAME (settle_game):
1. **Target reached**: score ≥ target (D120 → 120, D80 → 80).
2. **Datinandro**: at deal time, a player's hand pip total equals today's day-of-month (1–31). Triggers instant settle_game; all hands are written to DB so spectators/opponents can verify. A center-screen overlay announces the winner.
3. **Mandeha irery**: in a single round, a player earns points ≥ 60 (D120) or ≥ 40 (D80). Triggers instant settle_game. Winner score is forced to target for history.
4. **Double 6 out**: a player ENDS the round by placing the [6|6] as their LAST tile (empties their hand with double-6). Triggers instant settle_game. Winner score is forced to target for history. NOT triggered if double-6 is played mid-round with tiles still in hand.

ALL of these are removed and MUST NOT be reintroduced — even partially, even as an opt-in:
- ❌ Double 6 instant win
- ❌ "5+ double atànana" deal-time instant win
- ❌ Auto-play branch that settles when tile = [6,6]
- ❌ "Maty atànana" / running out of tiles instant win
- ❌ Blocage instant win
- ❌ Endgame vote / continue-stop flow after target

Running out of tiles, blocage and "mitovy vato" only end the ROUND and may add points. They only win the GAME if the resulting score crosses the target.

History label `last_reason` MUST be prefixed `MANDRESY NY LALAO — …`. Target wins use `… tonga {target}`; datinandro wins use `… DATINANDRO {day} • {name} tonga datinandro`; mandeha irery uses `… MANDEHA IRERY • {name} nahazo +{points} amin'ny tour iray ({threshold}+)`; double-6 out uses `… DOUBLE 6 • {name} namarana ny tour tamin'ny [6|6]`. Profile.tsx `parseReason` order: datinandro → mandeha irery → double-6 out → tonga.

**Why:** The user repeatedly demanded that ONLY the target wins ("ny akoatrizay tsimisy"). Any re-introduction of bonus win conditions is a regression. If a future task asks for a new win category, push back and ask for explicit confirmation that this lock is being intentionally lifted.

## Anti-skip invariant (2026-06-28)
Never advance/pass a Domino turn while the current player has at least one legal tile for the board ends. This applies to:
- manual pass
- 15s client autoplay
- background watchdog / cron autoplay
- any future admin or repair scripts

The backend must be the final guard: pass-only updates must raise/block when `domino_hand_has_move(current_player_hand, board_state)` is true. If a player is offline but has a legal tile, autoplay should place a legal tile, not skip them.

**Why:** The user repeatedly saw 3P matches where one player with playable tiles was skipped while only the other two played.

## 3P turn ownership invariant (2026-07-03)
For Domino 3P, the turn order is permanently **contraire montre / makany ANKAVIA** in the live table order: P1 → P2 → P3 → P1. Round openers still rotate fairly by round number: Round 1=P1, Round 2=P2, Round 3=P3, then repeat.

Only the client logged in as `current_turn` may perform local timeout/bot auto-action. Other players' clients must never auto-play or auto-pass on behalf of that player; if that player leaves/offline, the backend watchdog is the only fallback.

The database must reject any update that advances `current_turn` to anything other than `domino_next_turn_id(old_game, old.current_turn)`, and must reject pass-only turn advances while the old current player has a legal move.

**Why:** Customers reported 3P games where A and B kept playing while C was skipped. Cross-client auto-action can race against stale views and make the skip look permanent.

## Board endpoint colors (2026-07-10)
Do not color every placed domino red. Only the left/vodiny endpoint tile is red, only the right/lohany endpoint tile is green, and all middle tiles keep black pips.

## 15s autoplay/vibration invariant (2026-07-10)
Domino turn deadline is 15s. At 0s the backend watchdog must auto-play a legal tile or pass if no legal tile exists, even when every player leaves or loses data. The 5s remaining vibration must run only on the device of the current-turn player, never on opponents' devices.