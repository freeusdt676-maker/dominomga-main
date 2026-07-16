
-- ============================================================
-- ESCROW / CASH_POOL ENFORCEMENT — money conservation guarantee
-- ============================================================

-- 1) cash_pool columns
ALTER TABLE public.games          ADD COLUMN IF NOT EXISTS cash_pool numeric NOT NULL DEFAULT 0;
ALTER TABLE public.ludo_games     ADD COLUMN IF NOT EXISTS cash_pool numeric NOT NULL DEFAULT 0;
ALTER TABLE public.petanque_games ADD COLUMN IF NOT EXISTS cash_pool numeric NOT NULL DEFAULT 0;

-- 2) wallet immutability guard
-- Mark RPC-driven money mutations with a session-local flag.
CREATE OR REPLACE FUNCTION public.allow_wallet_mutation()
RETURNS void LANGUAGE sql SET search_path TO 'public' AS $$
  SELECT set_config('app.wallet_mutation_allowed', '1', true);
$$;

CREATE OR REPLACE FUNCTION public.enforce_wallet_balance_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE allowed text;
BEGIN
  -- Allow if a SECURITY DEFINER RPC has set the flag in this transaction
  allowed := current_setting('app.wallet_mutation_allowed', true);
  IF allowed = '1' THEN RETURN NEW; END IF;
  -- Admin role bypasses (e.g., manual fixes)
  IF public.has_role(auth.uid(), 'admin') THEN RETURN NEW; END IF;
  -- Otherwise: no direct balance change allowed
  IF NEW.balance IS DISTINCT FROM OLD.balance THEN
    RAISE EXCEPTION 'wallet_balance_change_forbidden: use an RPC';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_wallet_balance_guard ON public.wallets;
CREATE TRIGGER trg_enforce_wallet_balance_guard
BEFORE UPDATE ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.enforce_wallet_balance_guard();

-- 3) DOMINO start_deduct — set cash_pool
CREATE OR REPLACE FUNCTION public.start_game_deduct(_game_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE g RECORD; commission_each NUMERIC; admin_user UUID; bal NUMERIC; pcount int; total_commission NUMERIC; pot NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('start_deduct:'||_game_id::text, 0));
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'Game not found'; END IF;
  IF g.status <> 'in_progress' THEN RAISE EXCEPTION 'Game not in_progress'; END IF;
  IF g.commission > 0 THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  pcount := COALESCE(g.players_count, 2);
  IF pcount = 2 AND g.player2_id IS NULL THEN RAISE EXCEPTION 'No opponent'; END IF;
  IF pcount = 3 AND (g.player2_id IS NULL OR g.player3_id IS NULL) THEN RAISE EXCEPTION 'No opponents'; END IF;
  commission_each := round(g.stake * 0.10);
  total_commission := commission_each * pcount;
  pot := (g.stake - commission_each) * pcount;

  SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player1_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Tsy ampy ny solde-nao'; END IF;
  UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player1_id;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (g.player1_id,'game_stake',g.stake,'completed',g.id);

  SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player2_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Tsy ampy ny solde-nao'; END IF;
  UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player2_id;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (g.player2_id,'game_stake',g.stake,'completed',g.id);

  IF pcount = 3 THEN
    SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player3_id FOR UPDATE;
    IF bal < g.stake THEN RAISE EXCEPTION 'Tsy ampy ny solde-nao'; END IF;
    UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player3_id;
    INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (g.player3_id,'game_stake',g.stake,'completed',g.id);
  END IF;

  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id, balance) VALUES (admin_user, total_commission)
    ON CONFLICT (admin_id) DO UPDATE SET balance = admin_wallets.balance + EXCLUDED.balance, updated_at = now();
  END IF;

  UPDATE public.games SET commission = total_commission, cash_pool = pot WHERE id = g.id;
  RETURN jsonb_build_object('ok', true, 'commission_total', total_commission, 'cash_pool', pot);
END $function$;

-- 4) DOMINO settle — pay strictly from cash_pool
CREATE OR REPLACE FUNCTION public.settle_game(_game_id uuid, _winner uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE g RECORD; pot NUMERIC; caller uuid := auth.uid();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('settle:'||_game_id::text, 0));
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status = 'finished' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF _winner <> g.player1_id AND _winner <> g.player2_id
     AND _winner <> COALESCE(g.player3_id,'00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'invalid_winner';
  END IF;
  IF NOT public.has_role(caller, 'admin') THEN
    IF caller IS NULL OR caller NOT IN (g.player1_id, g.player2_id, COALESCE(g.player3_id, g.player1_id)) THEN
      RAISE EXCEPTION 'forbidden_caller';
    END IF;
  END IF;
  pot := g.cash_pool;
  IF pot <= 0 THEN RAISE EXCEPTION 'empty_cash_pool'; END IF;
  UPDATE public.wallets SET balance = balance + pot, updated_at = now() WHERE user_id = _winner;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id)
    VALUES (_winner,'game_win',pot,'completed',g.id);
  UPDATE public.games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=g.id;
  RETURN jsonb_build_object('ok', true, 'pot', pot);
END $function$;

-- 5) LUDO start_deduct
CREATE OR REPLACE FUNCTION public.ludo_start_deduct(_game_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE g RECORD; commission_each numeric; total_commission numeric; admin_user uuid; bal numeric; pids uuid[]; pid uuid; n int; pot numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ludo_start_deduct:'||_game_id::text, 0));
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status <> 'in_progress' THEN RAISE EXCEPTION 'not_in_progress'; END IF;
  IF g.commission > 0 THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  n := g.players_count;
  pids := ARRAY[g.player1_id, g.player2_id, g.player3_id, g.player4_id]::uuid[];
  commission_each := round(g.stake * 0.10);
  total_commission := commission_each * n;
  pot := (g.stake - commission_each) * n;
  FOR i IN 1..n LOOP
    pid := pids[i];
    IF pid IS NULL THEN RAISE EXCEPTION 'missing_player'; END IF;
    SELECT balance INTO bal FROM public.wallets WHERE user_id=pid FOR UPDATE;
    IF bal < g.stake THEN RAISE EXCEPTION 'Tsy ampy ny solde-nao'; END IF;
    UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=pid;
    INSERT INTO public.transactions(user_id,type,amount,status) VALUES (pid,'game_stake',g.stake,'completed');
  END LOOP;
  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id,balance) VALUES (admin_user,total_commission)
    ON CONFLICT (admin_id) DO UPDATE SET balance=admin_wallets.balance+EXCLUDED.balance, updated_at=now();
  END IF;
  UPDATE public.ludo_games SET commission=total_commission, cash_pool=pot WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'commission',total_commission,'cash_pool',pot);
END $function$;

-- 6) LUDO settle
CREATE OR REPLACE FUNCTION public.ludo_settle(_game_id uuid, _winner uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE g RECORD; pot numeric; caller uuid := auth.uid();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ludo_settle:'||_game_id::text, 0));
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status='finished' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF _winner NOT IN (g.player1_id, g.player2_id, g.player3_id, g.player4_id) THEN
    RAISE EXCEPTION 'invalid_winner'; END IF;
  IF NOT public.has_role(caller, 'admin') THEN
    IF caller IS NULL OR caller NOT IN (g.player1_id, g.player2_id, COALESCE(g.player3_id,g.player1_id), COALESCE(g.player4_id,g.player1_id)) THEN
      RAISE EXCEPTION 'forbidden_caller';
    END IF;
  END IF;
  pot := g.cash_pool;
  IF pot <= 0 THEN RAISE EXCEPTION 'empty_cash_pool'; END IF;
  UPDATE public.wallets SET balance=balance+pot, updated_at=now() WHERE user_id=_winner;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (_winner,'game_win',pot,'completed');
  UPDATE public.ludo_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'pot',pot);
END $function$;

-- 7) PETANQUE start_deduct
CREATE OR REPLACE FUNCTION public.petanque_start_deduct(_game_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE g RECORD; commission_each numeric; total_commission numeric; admin_user uuid; bal numeric; pot numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_start_deduct:'||_game_id::text, 0));
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status <> 'in_progress' THEN RAISE EXCEPTION 'not_in_progress'; END IF;
  IF g.commission > 0 THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF g.player2_id IS NULL THEN RAISE EXCEPTION 'no_opponent'; END IF;
  commission_each := round(g.stake * 0.10);
  total_commission := commission_each * 2;
  pot := (g.stake - commission_each) * 2;

  SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player1_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Tsy ampy ny solde-nao'; END IF;
  UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player1_id;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (g.player1_id,'game_stake',g.stake,'completed');

  SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player2_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Tsy ampy ny solde-nao'; END IF;
  UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player2_id;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (g.player2_id,'game_stake',g.stake,'completed');

  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id,balance) VALUES (admin_user,total_commission)
    ON CONFLICT (admin_id) DO UPDATE SET balance=admin_wallets.balance+EXCLUDED.balance, updated_at=now();
  END IF;
  UPDATE public.petanque_games SET commission=total_commission, cash_pool=pot WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'commission',total_commission,'cash_pool',pot);
END $function$;

-- 8) PETANQUE settle
CREATE OR REPLACE FUNCTION public.petanque_settle(_game_id uuid, _winner uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE g RECORD; pot numeric; caller uuid := auth.uid();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('petanque_settle:'||_game_id::text, 0));
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status='finished' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF _winner NOT IN (g.player1_id, g.player2_id) THEN RAISE EXCEPTION 'invalid_winner'; END IF;
  IF NOT public.has_role(caller, 'admin') THEN
    IF caller IS NULL OR caller NOT IN (g.player1_id, g.player2_id) THEN
      RAISE EXCEPTION 'forbidden_caller';
    END IF;
  END IF;
  pot := g.cash_pool;
  IF pot <= 0 THEN RAISE EXCEPTION 'empty_cash_pool'; END IF;
  UPDATE public.wallets SET balance=balance+pot, updated_at=now() WHERE user_id=_winner;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (_winner,'game_win',pot,'completed');
  UPDATE public.petanque_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'pot',pot);
END $function$;

-- 9) Cancel functions: refund from cash_pool (zero it) — wrap with allow_wallet_mutation
CREATE OR REPLACE FUNCTION public.admin_cancel_domino_game(_game_id uuid, _admin_id uuid, _pin text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE g RECORD; pids uuid[]; pid uuid; refunded_count integer := 0; admin_user uuid; refund_amount numeric;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status IN ('finished', 'cancelled') THEN RAISE EXCEPTION 'already_closed'; END IF;
  pids := ARRAY[g.player1_id, g.player2_id, g.player3_id]::uuid[];
  refund_amount := COALESCE(g.stake, 0);
  FOREACH pid IN ARRAY pids LOOP
    CONTINUE WHEN pid IS NULL;
    IF COALESCE(g.commission, 0) > 0 THEN
      UPDATE public.wallets SET balance=balance+refund_amount, updated_at=now() WHERE user_id=pid;
      INSERT INTO public.transactions(user_id, type, amount, status, game_id, admin_note, processed_at, processed_by)
      VALUES (pid, 'deposit', refund_amount, 'approved', g.id, 'Annulation admin - remboursement mise', now(), _admin_id);
      refunded_count := refunded_count + 1;
    END IF;
  END LOOP;
  IF COALESCE(g.commission, 0) > 0 THEN
    SELECT user_id INTO admin_user FROM public.user_roles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1;
    IF admin_user IS NOT NULL THEN
      UPDATE public.admin_wallets SET balance = GREATEST(0, balance - COALESCE(g.commission, 0)), updated_at = now()
      WHERE admin_id = admin_user;
    END IF;
  END IF;
  UPDATE public.games SET status='cancelled', winner_id=NULL, finished_at=now(), updated_at=now(),
    reveal_until=NULL, endgame_votes=NULL, cash_pool=0 WHERE id = g.id;
  RETURN jsonb_build_object('ok', true, 'refunded_players', refunded_count);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_cancel_ludo_game(_game_id uuid, _admin_id uuid, _pin text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE g RECORD; pids uuid[]; pid uuid; refunded_count integer := 0; admin_user uuid; refund_amount numeric;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.ludo_games WHERE id = _game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status IN ('finished', 'cancelled') THEN RAISE EXCEPTION 'already_closed'; END IF;
  pids := ARRAY[g.player1_id, g.player2_id, g.player3_id, g.player4_id]::uuid[];
  refund_amount := COALESCE(g.stake, 0);
  FOREACH pid IN ARRAY pids LOOP
    CONTINUE WHEN pid IS NULL;
    IF COALESCE(g.commission, 0) > 0 THEN
      UPDATE public.wallets SET balance=balance+refund_amount, updated_at=now() WHERE user_id=pid;
      INSERT INTO public.transactions(user_id, type, amount, status, admin_note, processed_at, processed_by)
      VALUES (pid, 'deposit', refund_amount, 'approved', 'Annulation admin - remboursement mise Ludo', now(), _admin_id);
      refunded_count := refunded_count + 1;
    END IF;
  END LOOP;
  IF COALESCE(g.commission, 0) > 0 THEN
    SELECT user_id INTO admin_user FROM public.user_roles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1;
    IF admin_user IS NOT NULL THEN
      UPDATE public.admin_wallets SET balance = GREATEST(0, balance - COALESCE(g.commission, 0)), updated_at = now()
      WHERE admin_id = admin_user;
    END IF;
  END IF;
  UPDATE public.ludo_games SET status='cancelled', winner_id=NULL, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id = g.id;
  RETURN jsonb_build_object('ok', true, 'refunded_players', refunded_count);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_cancel_petanque_game(_game_id uuid, _admin_id uuid, _pin text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE g RECORD; pids uuid[]; pid uuid; refunded_count int := 0; admin_user uuid; refund_amount numeric;
BEGIN
  IF NOT public.has_role(_admin_id,'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status IN ('finished','cancelled') THEN RAISE EXCEPTION 'already_closed'; END IF;
  pids := ARRAY[g.player1_id, g.player2_id]::uuid[];
  refund_amount := COALESCE(g.stake, 0);
  FOREACH pid IN ARRAY pids LOOP
    CONTINUE WHEN pid IS NULL;
    IF COALESCE(g.commission,0) > 0 THEN
      UPDATE public.wallets SET balance=balance+refund_amount, updated_at=now() WHERE user_id=pid;
      INSERT INTO public.transactions(user_id,type,amount,status,admin_note,processed_at,processed_by)
        VALUES (pid,'deposit',refund_amount,'approved','Annulation admin - remboursement Pétanque',now(),_admin_id);
      refunded_count := refunded_count + 1;
    END IF;
  END LOOP;
  IF COALESCE(g.commission,0) > 0 THEN
    SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
    IF admin_user IS NOT NULL THEN
      UPDATE public.admin_wallets SET balance=GREATEST(0, balance - COALESCE(g.commission,0)), updated_at=now() WHERE admin_id=admin_user;
    END IF;
  END IF;
  UPDATE public.petanque_games SET status='cancelled', winner_id=NULL, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=g.id;
  RETURN jsonb_build_object('ok',true,'refunded_players',refunded_count);
END $function$;

-- 10) expire_stale_waiting_games: wrap with allow_wallet_mutation (refunds 3P)
CREATE OR REPLACE FUNCTION public.expire_stale_waiting_games()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c1 int := 0; c2 int := 0; c3 int := 0; c4 int := 0; c5 int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM public.allow_wallet_mutation();
  WITH d AS (DELETE FROM public.games WHERE status='waiting' AND player2_id IS NULL AND created_at < now()-interval '2 minutes' RETURNING 1) SELECT count(*) INTO c1 FROM d;
  WITH d AS (DELETE FROM public.ludo_games WHERE status='waiting' AND player2_id IS NULL AND created_at < now()-interval '2 minutes' RETURNING 1) SELECT count(*) INTO c2 FROM d;
  WITH d AS (DELETE FROM public.petanque_games WHERE status='waiting' AND player2_id IS NULL AND created_at < now()-interval '2 minutes' RETURNING 1) SELECT count(*) INTO c3 FROM d;
  WITH stale AS (SELECT id, player1_id, player2_id, stake FROM public.games WHERE players_count=3 AND status='waiting' AND player3_id IS NULL AND created_at < now()-interval '5 minutes' FOR UPDATE),
       refund AS (UPDATE public.wallets w SET balance=balance+s.stake FROM stale s WHERE w.user_id IN (s.player1_id, s.player2_id) RETURNING 1),
       del AS (DELETE FROM public.games WHERE id IN (SELECT id FROM stale) RETURNING 1)
  SELECT count(*) INTO c4 FROM del;
  WITH stale AS (SELECT id, player1_id, player2_id, player3_id, stake, players_count FROM public.ludo_games WHERE players_count>=3 AND status='waiting' AND ((players_count=3 AND player3_id IS NULL) OR (players_count=4 AND player4_id IS NULL)) AND created_at < now()-interval '5 minutes' FOR UPDATE),
       refund AS (UPDATE public.wallets w SET balance=balance+s.stake FROM stale s WHERE w.user_id IN (s.player1_id, s.player2_id, s.player3_id) RETURNING 1),
       del AS (DELETE FROM public.ludo_games WHERE id IN (SELECT id FROM stale) RETURNING 1)
  SELECT count(*) INTO c5 FROM del;
  RETURN jsonb_build_object('domino',c1,'ludo',c2,'petanque',c3,'domino_3p',c4,'ludo_multi',c5);
END $function$;

-- 11) admin_approve_tx & admin_reset_user_balance: wrap
CREATE OR REPLACE FUNCTION public.admin_approve_tx(_tx_id uuid, _admin_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t RECORD; cur numeric; newbal numeric;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO t FROM public.transactions WHERE id = _tx_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tx_not_found_or_not_pending'; END IF;
  SELECT balance INTO cur FROM public.wallets WHERE user_id = t.user_id FOR UPDATE;
  IF cur IS NULL THEN INSERT INTO public.wallets(user_id, balance) VALUES (t.user_id, 0); cur := 0; END IF;
  IF t.type = 'deposit' THEN newbal := cur + t.amount;
  ELSIF t.type = 'withdrawal' THEN
    IF cur < t.amount THEN RAISE EXCEPTION 'insufficient_balance'; END IF;
    newbal := cur - t.amount;
  ELSE RAISE EXCEPTION 'invalid_tx_type'; END IF;
  UPDATE public.wallets SET balance = newbal, updated_at = now() WHERE user_id = t.user_id;
  UPDATE public.transactions SET status='approved', processed_by=_admin_id, processed_at=now() WHERE id=t.id;
  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (_admin_id, t.user_id,
    CASE WHEN t.type = 'deposit' THEN 'Dépôt ' ELSE 'Retrait ' END || t.amount::text || ' Ar nankatoavina ✓', false);
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_reset_user_balance(_user_id uuid, _admin_id uuid, _pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;
  PERFORM public.allow_wallet_mutation();
  UPDATE public.wallets SET balance = 0, updated_at = now() WHERE user_id = _user_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- 12) Backfill: in-progress games with positive commission but no cash_pool yet
UPDATE public.games
   SET cash_pool = GREATEST(0, (stake - round(stake*0.10)) * COALESCE(players_count,2))
 WHERE status='in_progress' AND commission > 0 AND cash_pool = 0;
UPDATE public.ludo_games
   SET cash_pool = GREATEST(0, (stake - round(stake*0.10)) * COALESCE(players_count,2))
 WHERE status='in_progress' AND commission > 0 AND cash_pool = 0;
UPDATE public.petanque_games
   SET cash_pool = GREATEST(0, (stake - round(stake*0.10)) * 2)
 WHERE status='in_progress' AND commission > 0 AND cash_pool = 0;

-- 13) Dashboard helper: total cash currently locked in active matches
CREATE OR REPLACE FUNCTION public.admin_total_locked_cash_pool(_admin_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT SUM(cash_pool) FROM public.games WHERE status='in_progress'),0)
       + COALESCE((SELECT SUM(cash_pool) FROM public.ludo_games WHERE status='in_progress'),0)
       + COALESCE((SELECT SUM(cash_pool) FROM public.petanque_games WHERE status='in_progress'),0)
   WHERE public.has_role(_admin_id, 'admin');
$function$;
