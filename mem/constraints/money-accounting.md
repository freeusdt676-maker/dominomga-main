---
name: Money accounting invariant
description: How the wallet/admin/cash_pool accounting works and why total cannot grow
type: constraint
---
**Invariant:** `SUM(wallets) + SUM(admin_wallets) + SUM(cash_pool of in_progress games)` is conserved EXCEPT for:
- `+amount` on every **approved deposit** (transactions.type='deposit', status='approved')
- `-amount` on every **approved withdrawal** (transactions.type='withdrawal', status='approved')

The three game RPCs (`start_game_deduct`, `ludo_start_deduct`, `petanque_start_deduct`) do exactly:
- `wallets -= n*stake`
- `admin_wallets += commission_each*n`
- `cash_pool += (stake - commission_each)*n`
- Net delta = 0 ✓

The three settle RPCs (`settle_game`, `ludo_settle`, `petanque_settle`) do exactly:
- `wallets[winner] += cash_pool`
- `cash_pool = 0`
- Net delta = 0 ✓

The cancel RPCs (`admin_cancel_*_game`) do exactly:
- `wallets += n*stake` (full stake refunded to each player)
- `admin_wallets -= commission`
- `cash_pool = 0`
- Net delta = 0 ✓ (because pre-deduct state is restored)

**Therefore the total system money NEVER grows during gameplay.** It only:
- decreases for `SUM(wallets)` alone (player-only view) by exactly `commission` each finished game
- stays flat as a whole system

**Never** add code paths that:
- credit wallets without a matching debit
- refund more than the original stake
- refund cash_pool AND stake (double refund)
- create deposit/refund transactions during cleanup of waiting games (no stake was taken)

`expire_stale_waiting_games` MUST NOT issue refunds — it only deletes waiting rows where no stake was ever deducted (status='waiting' → commission=0).

**Admin display** uses `admin_total_player_balance` = `SUM(wallets) excluding admins`. This number naturally **decreases** by `commission` each game, and **increases** only when deposits are approved.

**Why:** The user repeatedly perceived the total "growing" during games. Verified by `read_query`: the math is correct and totals are stable. Any deviation (new refund path, new credit path) is a regression and breaks user trust. Always cross-check by querying `SUM(wallets) + SUM(admin_wallets) + SUM(cash_pool WHERE status='in_progress')` before and after the change.
