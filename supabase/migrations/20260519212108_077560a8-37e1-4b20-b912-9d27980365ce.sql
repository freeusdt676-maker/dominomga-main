CREATE OR REPLACE FUNCTION public.petanque_join_and_start(_game_id uuid, _user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE g RECORD; ticket text;
BEGIN
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status <> 'waiting' OR g.player2_id IS NOT NULL THEN RAISE EXCEPTION 'already_taken'; END IF;
  IF g.player1_id = _user THEN RAISE EXCEPTION 'cannot_join_own'; END IF;
  ticket := to_char(now(),'YYYYMMDDHH24MISS');
  UPDATE public.petanque_games SET
    player2_id=_user,
    status='in_progress',
    current_turn=g.player1_id,
    turn_started_at=now(),
    ticket_number=ticket,
    state=jsonb_build_object(
      'balls', '[]'::jsonb,
      'jack', jsonb_build_object('x',0,'z',6),
      'phase','aim',
      'remaining', jsonb_build_object('p1',6,'p2',6)
    ),
    updated_at=now()
  WHERE id=_game_id;
  PERFORM public.petanque_start_deduct(_game_id);
  RETURN jsonb_build_object('ok',true,'ticket',ticket);
END $function$;