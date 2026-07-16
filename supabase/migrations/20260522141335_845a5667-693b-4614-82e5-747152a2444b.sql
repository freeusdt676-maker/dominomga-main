
DROP FUNCTION IF EXISTS public.petanque_join_and_start(uuid, uuid);

CREATE OR REPLACE FUNCTION public.petanque_join_and_start(_game_id uuid, _user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.petanque_games
  SET
    player2_id = _user,
    status = 'in_progress',
    current_turn = player1_id,
    turn_started_at = now(),
    state = jsonb_build_object(
      'balls', '[]'::jsonb,
      'jack', NULL,
      'phase', 'throw_jack',
      'remaining', jsonb_build_object('p1',4,'p2',4)
    ),
    updated_at = now()
  WHERE id = _game_id AND status = 'waiting' AND player2_id IS NULL;

  PERFORM public.petanque_start_deduct(_game_id);
END;
$$;
