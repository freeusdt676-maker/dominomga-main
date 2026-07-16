CREATE OR REPLACE FUNCTION public.player_update_game_state_guarded(
  _game_id uuid,
  _board_state jsonb DEFAULT NULL,
  _player1_hand jsonb DEFAULT NULL,
  _player2_hand jsonb DEFAULT NULL,
  _boneyard jsonb DEFAULT NULL,
  _current_turn uuid DEFAULT NULL,
  _turn_started_at timestamptz DEFAULT NULL,
  _passes integer DEFAULT NULL,
  _status public.game_status DEFAULT NULL,
  _player3_hand jsonb DEFAULT NULL,
  _expected_current_turn uuid DEFAULT NULL,
  _expected_turn_started_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.games%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO g
  FROM public.games
  WHERE id = _game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found';
  END IF;

  IF uid <> g.player1_id
    AND uid <> g.player2_id
    AND uid <> COALESCE(g.player3_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _expected_current_turn IS NOT NULL
    AND g.current_turn IS DISTINCT FROM _expected_current_turn THEN
    RAISE EXCEPTION 'state_conflict';
  END IF;

  IF _expected_turn_started_at IS NOT NULL
    AND g.turn_started_at IS DISTINCT FROM _expected_turn_started_at THEN
    RAISE EXCEPTION 'state_conflict';
  END IF;

  UPDATE public.games
  SET board_state = COALESCE(_board_state, board_state),
      player1_hand = COALESCE(_player1_hand, player1_hand),
      player2_hand = COALESCE(_player2_hand, player2_hand),
      player3_hand = COALESCE(_player3_hand, player3_hand),
      boneyard = COALESCE(_boneyard, boneyard),
      current_turn = COALESCE(_current_turn, current_turn),
      turn_started_at = COALESCE(_turn_started_at, turn_started_at),
      passes = COALESCE(_passes, passes),
      status = COALESCE(_status, status),
      updated_at = now()
  WHERE id = _game_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.player_update_game_state_guarded(uuid, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, integer, public.game_status, jsonb, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.player_update_game_state_guarded(uuid, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, integer, public.game_status, jsonb, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.player_update_game_state_guarded(uuid, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, integer, public.game_status, jsonb, uuid, timestamptz) TO service_role;