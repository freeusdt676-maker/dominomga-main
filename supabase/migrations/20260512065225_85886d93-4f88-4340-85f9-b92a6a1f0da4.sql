
ALTER TABLE public.ludo_games ADD COLUMN IF NOT EXISTS seat_assignment jsonb;

CREATE OR REPLACE FUNCTION public.ludo_initial_pawns_for(_seats jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb := '[]'::jsonb; seat_val int; i int;
BEGIN
  FOR seat_val IN SELECT value::int FROM jsonb_array_elements(_seats) LOOP
    FOR i IN 0..3 LOOP
      result := result || jsonb_build_array(jsonb_build_object('seat',seat_val,'idx',i,'pos',0));
    END LOOP;
  END LOOP;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.ludo_join_and_start(_game_id uuid, _user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE g RECORD; ticket text; seat int := 0; filled int; seats jsonb; first_seat int;
BEGIN
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
    -- Use seat_assignment if present (notably for 2P variants), else default
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
      SET status='in_progress',
          current_turn_seat=first_seat,
          turn_started_at=now(),
          ticket_number=ticket,
          pawns=public.ludo_initial_pawns_for(seats),
          updated_at=now()
      WHERE id=_game_id;
    PERFORM public.ludo_start_deduct(_game_id);
  END IF;
  RETURN jsonb_build_object('ok',true,'seat',seat);
END $function$;
