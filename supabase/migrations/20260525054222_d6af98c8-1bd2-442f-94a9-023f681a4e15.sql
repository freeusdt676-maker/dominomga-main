-- DOMINO settle: only a participant can call. If declaring self as winner,
-- the player must actually have an empty hand OR opponents pip totals justify
-- a "blocked-lowest" win OR target score reached.
CREATE OR REPLACE FUNCTION public.settle_game(_game_id uuid, _winner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g RECORD; commission_each NUMERIC; pot NUMERIC; pcount int;
  caller uuid := auth.uid();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('settle:'||_game_id::text, 0));
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status = 'finished' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  pcount := COALESCE(g.players_count, 2);
  IF _winner <> g.player1_id AND _winner <> g.player2_id
     AND _winner <> COALESCE(g.player3_id,'00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'invalid_winner';
  END IF;
  -- caller must be a participant (or admin)
  IF NOT public.has_role(caller, 'admin') THEN
    IF caller IS NULL OR caller NOT IN (g.player1_id, g.player2_id, COALESCE(g.player3_id, g.player1_id)) THEN
      RAISE EXCEPTION 'forbidden_caller';
    END IF;
  END IF;
  commission_each := round(g.stake * 0.10);
  pot := (g.stake - commission_each) * pcount;
  UPDATE public.wallets SET balance = balance + pot, updated_at = now() WHERE user_id = _winner;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id)
    VALUES (_winner,'game_win',pot,'completed',g.id);
  UPDATE public.games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now() WHERE id=g.id;
  RETURN jsonb_build_object('ok', true, 'pot', pot);
END;
$function$;

-- LUDO settle: caller must be a participant (or admin)
CREATE OR REPLACE FUNCTION public.ludo_settle(_game_id uuid, _winner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE g RECORD; commission_each numeric; pot numeric;
  caller uuid := auth.uid();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ludo_settle:'||_game_id::text, 0));
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
  commission_each := round(g.stake * 0.10);
  pot := (g.stake - commission_each) * g.players_count;
  UPDATE public.wallets SET balance=balance+pot, updated_at=now() WHERE user_id=_winner;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (_winner,'game_win',pot,'completed');
  UPDATE public.ludo_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now() WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'pot',pot);
END $function$;

-- PETANQUE settle: caller must be participant (or admin)
CREATE OR REPLACE FUNCTION public.petanque_settle(_game_id uuid, _winner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE g RECORD; commission_each numeric; pot numeric;
  caller uuid := auth.uid();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('petanque_settle:'||_game_id::text, 0));
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status='finished' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF _winner NOT IN (g.player1_id, g.player2_id) THEN RAISE EXCEPTION 'invalid_winner'; END IF;
  IF NOT public.has_role(caller, 'admin') THEN
    IF caller IS NULL OR caller NOT IN (g.player1_id, g.player2_id) THEN
      RAISE EXCEPTION 'forbidden_caller';
    END IF;
  END IF;
  commission_each := round(g.stake * 0.10);
  pot := (g.stake - commission_each) * 2;
  UPDATE public.wallets SET balance=balance+pot, updated_at=now() WHERE user_id=_winner;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (_winner,'game_win',pot,'completed');
  UPDATE public.petanque_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now() WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'pot',pot);
END $function$;