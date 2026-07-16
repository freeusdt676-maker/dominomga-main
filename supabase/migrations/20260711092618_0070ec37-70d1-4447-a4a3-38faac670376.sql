CREATE OR REPLACE FUNCTION public.join_and_start_game(_game_id uuid, _player2 uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE g RECORD; ticket text; pcount int;
BEGIN
  IF public.game_blocked('domino') THEN
    RAISE EXCEPTION 'game_blocked' USING HINT = 'Bloqué le jeu: Domino maintenance vetivety';
  END IF;
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
END $$;

CREATE OR REPLACE FUNCTION public.join_3p_start(_game_id uuid, _player3 uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE g RECORD;
BEGIN
  IF public.game_blocked('domino') THEN
    RAISE EXCEPTION 'game_blocked' USING HINT = 'Bloqué le jeu: Domino maintenance vetivety';
  END IF;
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
END $$;

CREATE OR REPLACE FUNCTION public.ludo_join_and_start(_game_id uuid, _user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE g RECORD; ticket text; seat int := 0; filled int; seats jsonb; first_seat int;
BEGIN
  IF public.game_blocked('ludo') THEN
    RAISE EXCEPTION 'game_blocked' USING HINT = 'Bloqué le jeu: Ludo maintenance vetivety';
  END IF;
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
    IF g.players_count = 2 THEN seats := '[4,2]'::jsonb;
    ELSIF g.players_count = 3 THEN seats := '[4,1,2]'::jsonb;
    ELSE seats := '[4,1,2,3]'::jsonb;
    END IF;
    UPDATE public.ludo_games SET seat_assignment = seats WHERE id=_game_id;
    first_seat := (seats->>0)::int;
    UPDATE public.ludo_games
      SET status='in_progress', current_turn_seat=first_seat, turn_started_at=now(),
          ticket_number=ticket, pawns=public.ludo_initial_pawns_for(seats), updated_at=now()
      WHERE id=_game_id;
    PERFORM public.ludo_start_deduct(_game_id);
  END IF;
  RETURN jsonb_build_object('ok',true,'seat',seat);
END $$;

CREATE OR REPLACE FUNCTION public.petanque_join_and_start(_game_id uuid, _user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE g RECORD; ticket text;
BEGIN
  IF public.game_blocked('petanque') THEN
    RAISE EXCEPTION 'game_blocked' USING HINT = 'Bloqué le jeu: Pétanque maintenance vetivety';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_join:'||_game_id::text, 0));
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status <> 'waiting' OR g.player2_id IS NOT NULL THEN RAISE EXCEPTION 'already_taken'; END IF;
  IF g.player1_id = _user THEN RAISE EXCEPTION 'cannot_join_own'; END IF;
  ticket := COALESCE(g.ticket_number,
    to_char(now(), 'YYYYMMDDHH24MISS') ||
    lpad((floor(random()*1000))::int::text, 3, '0'));
  UPDATE public.petanque_games
    SET player2_id=_user,
        status='in_progress',
        current_turn=player1_id,
        turn_started_at=now(),
        ticket_number=ticket,
        state = jsonb_build_object('balls','[]'::jsonb,'jack',NULL,'phase','throw_jack','remaining', jsonb_build_object('p1',4,'p2',4)),
        updated_at=now()
    WHERE id=_game_id;
  PERFORM public.petanque_start_deduct(_game_id);
  RETURN jsonb_build_object('ok',true,'ticket',ticket);
END $$;

SELECT cron.alter_job(13, schedule => '1 second', active => true);