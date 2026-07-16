
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
    -- Physical yards: 1=red, 2=green, 3=yellow, 4=blue.
    -- Duel  (2P) => blue + green         => [4,2]
    -- Tri   (3P) => blue + red + green   => [4,1,2]
    -- Quadri(4P) => blue + red + green + yellow => [4,1,2,3]
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
END $fn$;
