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
    INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (pid,'game_stake',g.stake,'completed',_game_id);
  END LOOP;
  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id,balance) VALUES (admin_user,total_commission)
    ON CONFLICT (admin_id) DO UPDATE SET balance=admin_wallets.balance+EXCLUDED.balance, updated_at=now();
  END IF;
  UPDATE public.ludo_games SET commission=total_commission, cash_pool=pot WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'commission',total_commission,'cash_pool',pot);
END $function$;

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
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (_winner,'game_win',pot,'completed',_game_id);
  UPDATE public.ludo_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'pot',pot);
END $function$;

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
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (g.player1_id,'game_stake',g.stake,'completed',_game_id);

  SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player2_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Tsy ampy ny solde-nao'; END IF;
  UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player2_id;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (g.player2_id,'game_stake',g.stake,'completed',_game_id);

  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id,balance) VALUES (admin_user,total_commission)
    ON CONFLICT (admin_id) DO UPDATE SET balance=admin_wallets.balance+EXCLUDED.balance, updated_at=now();
  END IF;
  UPDATE public.petanque_games SET commission=total_commission, cash_pool=pot WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'commission',total_commission,'cash_pool',pot);
END $function$;

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
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (_winner,'game_win',pot,'completed',_game_id);
  UPDATE public.petanque_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'pot',pot);
END $function$;

CREATE OR REPLACE FUNCTION public.expire_stale_waiting_games()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c1 int := 0; c2 int := 0; c3 int := 0; c4 int := 0; c5 int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  WITH d AS (
    DELETE FROM public.games
    WHERE status='waiting' AND player2_id IS NULL AND created_at < now()-interval '2 minutes'
    RETURNING 1
  ) SELECT count(*) INTO c1 FROM d;

  WITH d AS (
    DELETE FROM public.ludo_games
    WHERE status='waiting' AND player2_id IS NULL AND created_at < now()-interval '2 minutes'
    RETURNING 1
  ) SELECT count(*) INTO c2 FROM d;

  WITH d AS (
    DELETE FROM public.petanque_games
    WHERE status='waiting' AND player2_id IS NULL AND created_at < now()-interval '2 minutes'
    RETURNING 1
  ) SELECT count(*) INTO c3 FROM d;

  WITH del AS (
    DELETE FROM public.games
    WHERE players_count=3
      AND status='waiting'
      AND player2_id IS NOT NULL
      AND player3_id IS NULL
      AND created_at < now()-interval '5 minutes'
    RETURNING 1
  ) SELECT count(*) INTO c4 FROM del;

  WITH del AS (
    DELETE FROM public.ludo_games
    WHERE players_count>=3
      AND status='waiting'
      AND (
        (players_count=3 AND player2_id IS NOT NULL AND player3_id IS NULL) OR
        (players_count=4 AND player3_id IS NOT NULL AND player4_id IS NULL)
      )
      AND created_at < now()-interval '5 minutes'
    RETURNING 1
  ) SELECT count(*) INTO c5 FROM del;

  RETURN jsonb_build_object('domino',c1,'ludo',c2,'petanque',c3,'domino_3p',c4,'ludo_multi',c5);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_total_player_balance(_admin_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH player_wallets AS (
    SELECT COALESCE(SUM(w.balance), 0) AS total
    FROM public.wallets w
    WHERE public.has_role(_admin_id, 'admin')
      AND w.user_id NOT IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  ), locked_cash AS (
    SELECT COALESCE((SELECT SUM(cash_pool) FROM public.games WHERE status='in_progress'),0)
         + COALESCE((SELECT SUM(cash_pool) FROM public.ludo_games WHERE status='in_progress'),0)
         + COALESCE((SELECT SUM(cash_pool) FROM public.petanque_games WHERE status='in_progress'),0) AS total
  )
  SELECT GREATEST(0, (SELECT total FROM player_wallets) - (SELECT total FROM locked_cash));
$function$;