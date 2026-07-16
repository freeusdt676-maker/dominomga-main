-- 1) Backfill ticket_number for existing petanque games (so they appear in admin history)
UPDATE public.petanque_games
SET ticket_number = to_char(created_at, 'YYYYMMDDHH24MISS') ||
                    lpad((floor(random()*1000))::int::text, 3, '0')
WHERE ticket_number IS NULL;

-- 2) Update petanque_join_and_start to assign ticket_number when the game starts
CREATE OR REPLACE FUNCTION public.petanque_join_and_start(_game_id uuid, _user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE g RECORD; ticket text;
BEGIN
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
END $function$;