# Project Memory

## Core
Domino is LOCKED — do not modify game logic, timers, UI, or parameters unless the user explicitly requests a Domino change.
Ludo and Wallet are stable — only touch when explicitly requested.
TURN_TIMEOUT_SEC=10 (Ludo), Pétanque turn=20s, Domino timer=15s, Lobby waiting expiry=2min. LOCKED — do not change.
Ludo + Pétanque server autoplay (pg_cron every 5s → edge functions ludo-autoplay / petanque-autoplay) MUST keep advancing turns when timer expires even if every player left the screen. Do not disable or gate by online presence.
Money is immutable: never add UI to delete wallets/admin_wallets. Mutations only via documented RPCs.
Commission is enforced server-side: round(stake*0.10)*players_count for all 3 games via BEFORE UPDATE triggers.
Wallet+admin+cash_pool total is conserved — only deposits add, withdrawals remove. NEVER add credit paths.
Domino win = target reached (80/120) OR mandeha irery (single-round points ≥ 40 D80 / ≥ 60 D120) OR double-6 out (ending the round by playing [6|6] as the last tile). DATINANDRO REMOVED — do not reintroduce.
Domino anti-skip LOCKED: backend/client watchdog must never pass a player who has any legal tile for the current board.
Domino 3P rotation LOCKED: counter-clockwise P1→P2→P3→P1; only current player's client or backend watchdog may auto-act.
Domino board colors: left/vodiny endpoint red, right/lohany endpoint green, middle tiles black.
Toasts: top-center, 7s duration, richColors (Sonner) — configured in src/App.tsx.

## Memories
- [Domino lock](mem://constraints/domino-locked) — Files frozen unless user prompts a Domino change
- [Money immutable](mem://constraints/money-immutable) — Wallet/admin_wallets rows never deletable
- [Money accounting](mem://constraints/money-accounting) — Invariant: wallet+admin+cash_pool conserved except deposits/withdrawals
- [VAR replay](mem://features/var-replay) — Admin history dialog structure per game type
- [Ludo server auto-play](mem://features/ludo-server-autoplay) — Backend cron auto-plays expired 10s turns even if all players offline
