
DROP FUNCTION IF EXISTS public.petanque_join_and_start(uuid, uuid);

CREATE OR REPLACE FUNCTION public.petanque_join_and_start(_game_id uuid, _user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE g RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_join:'||_game_id::text, 0));
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status <> 'waiting' OR g.player2_id IS NOT NULL THEN RAISE EXCEPTION 'already_taken'; END IF;
  IF g.player1_id = _user THEN RAISE EXCEPTION 'cannot_join_own'; END IF;
  UPDATE public.petanque_games
    SET player2_id=_user, status='in_progress', current_turn=player1_id, turn_started_at=now(),
        state = jsonb_build_object('balls','[]'::jsonb,'jack',NULL,'phase','throw_jack','remaining', jsonb_build_object('p1',4,'p2',4)),
        updated_at=now()
    WHERE id=_game_id;
  PERFORM public.petanque_start_deduct(_game_id);
  RETURN jsonb_build_object('ok',true);
END $fn$;

-- Re-apply the other functions (the previous migration aborted on the petanque error)
CREATE OR REPLACE FUNCTION public.start_game_deduct(_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE g RECORD; commission_each NUMERIC; admin_user UUID; bal NUMERIC; pcount int; total_commission NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('start_deduct:'||_game_id::text, 0));
  SELECT * INTO g FROM public.games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'Game not found'; END IF;
  IF g.status <> 'in_progress' THEN RAISE EXCEPTION 'Game not in_progress'; END IF;
  IF g.commission > 0 THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  pcount := COALESCE(g.players_count, 2);
  IF pcount = 2 AND g.player2_id IS NULL THEN RAISE EXCEPTION 'No opponent'; END IF;
  IF pcount = 3 AND (g.player2_id IS NULL OR g.player3_id IS NULL) THEN RAISE EXCEPTION 'No opponents'; END IF;
  commission_each := round(g.stake * 0.10);
  total_commission := commission_each * pcount;

  SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player1_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player1_id;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (g.player1_id,'game_stake',g.stake,'completed',g.id);

  SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player2_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player2_id;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (g.player2_id,'game_stake',g.stake,'completed',g.id);

  IF pcount = 3 THEN
    SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player3_id FOR UPDATE;
    IF bal < g.stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
    UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player3_id;
    INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (g.player3_id,'game_stake',g.stake,'completed',g.id);
  END IF;

  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id, balance) VALUES (admin_user, total_commission)
    ON CONFLICT (admin_id) DO UPDATE SET balance = admin_wallets.balance + EXCLUDED.balance, updated_at = now();
  END IF;

  UPDATE public.games SET commission = total_commission WHERE id = g.id;
  RETURN jsonb_build_object('ok', true, 'commission_total', total_commission, 'pot', (g.stake - commission_each) * pcount);
END $fn$;

CREATE OR REPLACE FUNCTION public.join_and_start_game(_game_id uuid, _player2 uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE g RECORD; ticket text; pcount int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('join:'||_game_id::text, 0));
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  pcount := COALESCE(g.players_count, 2);
  IF g.status = 'in_progress' AND pcount = 3 AND g.player3_id IS NULL THEN
    IF _player2 = g.player1_id OR _player2 = g.player2_id THEN RAISE EXCEPTION 'cannot_join_own'; END IF;
    UPDATE public.games SET player3_id = _player2, updated_at = now() WHERE id = _game_id;
    PERFORM public.start_game_deduct(_game_id);
    RETURN jsonb_build_object('ok', true, 'ticket', g.ticket_number, 'role', 'p3');
  END IF;
  IF g.status <> 'waiting' OR g.player2_id IS NOT NULL THEN RAISE EXCEPTION 'already_taken'; END IF;
  IF g.player1_id = _player2 THEN RAISE EXCEPTION 'cannot_join_own'; END IF;
  ticket := to_char(now(), 'YYYYMMDDHH24MISS');
  IF pcount = 2 THEN
    UPDATE public.games SET player2_id=_player2, status='in_progress', current_turn=g.player1_id, turn_started_at=now(), ticket_number=ticket, updated_at=now() WHERE id=_game_id;
    PERFORM public.start_game_deduct(_game_id);
    RETURN jsonb_build_object('ok', true, 'ticket', ticket, 'role', 'p2');
  ELSE
    UPDATE public.games SET player2_id=_player2, ticket_number=ticket, updated_at=now() WHERE id=_game_id;
    RETURN jsonb_build_object('ok', true, 'ticket', ticket, 'role', 'p2', 'awaiting_p3', true);
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.join_3p_start(_game_id uuid, _player3 uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE g RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('join:'||_game_id::text, 0));
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF COALESCE(g.players_count,2) <> 3 THEN RAISE EXCEPTION 'not_3p'; END IF;
  IF g.player3_id IS NOT NULL THEN RAISE EXCEPTION 'already_taken'; END IF;
  IF g.player2_id IS NULL THEN RAISE EXCEPTION 'need_player2_first'; END IF;
  IF _player3 = g.player1_id OR _player3 = g.player2_id THEN RAISE EXCEPTION 'cannot_join_own'; END IF;
  UPDATE public.games SET player3_id=_player3, status='in_progress', current_turn=g.player1_id, turn_started_at=now(), updated_at=now() WHERE id=_game_id;
  PERFORM public.start_game_deduct(_game_id);
  RETURN jsonb_build_object('ok', true, 'ticket', g.ticket_number);
END $fn$;

CREATE OR REPLACE FUNCTION public.ludo_start_deduct(_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE g RECORD; commission_each numeric; total_commission numeric; admin_user uuid; bal numeric; pids uuid[]; pid uuid; n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ludo_start_deduct:'||_game_id::text, 0));
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status <> 'in_progress' THEN RAISE EXCEPTION 'not_in_progress'; END IF;
  IF g.commission > 0 THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  n := g.players_count;
  pids := ARRAY[g.player1_id, g.player2_id, g.player3_id, g.player4_id]::uuid[];
  commission_each := round(g.stake * 0.10);
  total_commission := commission_each * n;
  FOR i IN 1..n LOOP
    pid := pids[i];
    IF pid IS NULL THEN RAISE EXCEPTION 'missing_player'; END IF;
    SELECT balance INTO bal FROM public.wallets WHERE user_id=pid FOR UPDATE;
    IF bal < g.stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
    UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=pid;
    INSERT INTO public.transactions(user_id,type,amount,status) VALUES (pid,'game_stake',g.stake,'completed');
  END LOOP;
  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id,balance) VALUES (admin_user,total_commission)
    ON CONFLICT (admin_id) DO UPDATE SET balance=admin_wallets.balance+EXCLUDED.balance, updated_at=now();
  END IF;
  UPDATE public.ludo_games SET commission=total_commission WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'commission',total_commission);
END $fn$;

CREATE OR REPLACE FUNCTION public.ludo_join_and_start(_game_id uuid, _user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE g RECORD; ticket text; seat int := 0; filled int; seats jsonb; first_seat int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ludo_join:'||_game_id::text, 0));
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status='finished' THEN RAISE EXCEPTION 'finished'; END IF;
  IF _user IN (g.player1_id, g.player2_id, g.player3_id, g.player4_id) THEN
    RETURN jsonb_build_object('ok',true,'already_in',true);
  END IF;
  IF g.player2_id IS NULL THEN seat := 2;
  ELSIF g.player3_id IS NULL AND g.players_count>=3 THEN seat := 3;
  ELSIF g.player4_id IS NULL AND g.players_count>=4 THEN seat := 4;
  ELSE RAISE EXCEPTION 'full'; END IF;
  IF seat=2 THEN UPDATE public.ludo_games SET player2_id=_user, updated_at=now() WHERE id=_game_id;
  ELSIF seat=3 THEN UPDATE public.ludo_games SET player3_id=_user, updated_at=now() WHERE id=_game_id;
  ELSIF seat=4 THEN UPDATE public.ludo_games SET player4_id=_user, updated_at=now() WHERE id=_game_id;
  END IF;
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  filled := (CASE WHEN g.player1_id IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN g.player2_id IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN g.player3_id IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN g.player4_id IS NOT NULL THEN 1 ELSE 0 END);
  IF filled = g.players_count AND g.status='waiting' THEN
    ticket := to_char(now(),'YYYYMMDDHH24MISS');
    IF g.seat_assignment IS NULL THEN
      IF g.players_count = 2 THEN seats := '[1,3]'::jsonb;
      ELSIF g.players_count = 3 THEN seats := '[1,2,3]'::jsonb;
      ELSE seats := '[1,2,3,4]'::jsonb;
      END IF;
      UPDATE public.ludo_games SET seat_assignment = seats WHERE id=_game_id;
    ELSE
      seats := g.seat_assignment;
    END IF;
    first_seat := (seats->>0)::int;
    UPDATE public.ludo_games
      SET status='in_progress', current_turn_seat=first_seat, turn_started_at=now(),
          ticket_number=ticket, pawns=public.ludo_initial_pawns_for(seats), updated_at=now()
      WHERE id=_game_id;
    PERFORM public.ludo_start_deduct(_game_id);
  END IF;
  RETURN jsonb_build_object('ok',true,'seat',seat);
END $fn$;

CREATE OR REPLACE FUNCTION public.petanque_start_deduct(_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE g RECORD; commission_each numeric; total_commission numeric; admin_user uuid; bal numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_start_deduct:'||_game_id::text, 0));
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status <> 'in_progress' THEN RAISE EXCEPTION 'not_in_progress'; END IF;
  IF g.commission > 0 THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF g.player2_id IS NULL THEN RAISE EXCEPTION 'no_opponent'; END IF;
  commission_each := round(g.stake * 0.10);
  total_commission := commission_each * 2;

  SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player1_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player1_id;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (g.player1_id,'game_stake',g.stake,'completed');

  SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player2_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player2_id;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (g.player2_id,'game_stake',g.stake,'completed');

  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id,balance) VALUES (admin_user,total_commission)
    ON CONFLICT (admin_id) DO UPDATE SET balance=admin_wallets.balance+EXCLUDED.balance, updated_at=now();
  END IF;
  UPDATE public.petanque_games SET commission=total_commission WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'commission',total_commission);
END $fn$;

CREATE OR REPLACE FUNCTION public.accept_challenge_start_game(_challenge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE c public.challenges%ROWTYPE; new_game_id uuid; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('challenge:'||_challenge_id::text, 0));
  SELECT * INTO c FROM public.challenges WHERE id = _challenge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'challenge_not_found'; END IF;
  IF c.to_user <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF c.status <> 'pending' THEN RAISE EXCEPTION 'challenge_not_pending'; END IF;
  IF c.expires_at <= now() THEN RAISE EXCEPTION 'challenge_expired'; END IF;
  INSERT INTO public.games (player1_id, player2_id, stake, status, current_turn, turn_started_at)
  VALUES (c.from_user, uid, c.stake, 'in_progress', c.from_user, now())
  RETURNING id INTO new_game_id;
  UPDATE public.challenges SET status='accepted', game_id=new_game_id WHERE id = c.id;
  PERFORM public.start_game_deduct(new_game_id);
  RETURN jsonb_build_object('ok', true, 'game_id', new_game_id);
END $fn$;
