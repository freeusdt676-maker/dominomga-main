---
name: Money immutable
description: Wallet balances and admin_wallets must never be deletable; only adjustable via documented RPCs
type: constraint
---
Never add a button or UI control that deletes rows from `wallets` or `admin_wallets`. Money mutations only via existing RPCs: `start_game_deduct`, `settle_game`, `ludo_settle`, `petanque_settle`, `admin_approve_tx`, `admin_reject_tx`, `admin_adjust_player_wallet` (Réclamation admin dépôt/retrait, PIN 2583, creates approved transaction trace), `admin_reset_user_balance` (PIN 2583), `admin_reset_commission` (PIN 2583), and refund flows inside `admin_cancel_*_game`.

`admin_delete_transaction` only deletes `pending` transactions.

`admin_clear_user_history(_user_id, _admin_pin='2583')` CAN delete approved/rejected/completed transaction rows for housekeeping. It must never touch `wallets`, `admin_wallets`, or pending transactions.

Game history rows (games / ludo_games / petanque_games) CAN be deleted via `admin_delete_game`, `admin_delete_ludo_game`, `admin_delete_petanque_game` — but only when status is `finished` or `cancelled` (UI guard in Admin.tsx).

**Why:** Trust + auditability. Wallet balances are the source of truth; never expose destructive paths.
