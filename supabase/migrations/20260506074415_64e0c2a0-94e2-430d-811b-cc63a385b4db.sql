CREATE OR REPLACE FUNCTION public.player_update_game_state(
  _game_id uuid,
  _board_state jsonb DEFAULT NULL,
  _player1_hand jsonb DEFAULT NULL,
  _player2_hand jsonb DEFAULT NULL,
  _boneyard jsonb DEFAULT NULL,
  _current_turn uuid DEFAULT NULL,
  _turn_started_at timestamptz DEFAULT NULL,
  _passes integer DEFAULT NULL,
  _status public.game_status DEFAULT NULL
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

  IF uid <> g.player1_id AND uid <> g.player2_id AND NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.games
  SET board_state = COALESCE(_board_state, board_state),
      player1_hand = COALESCE(_player1_hand, player1_hand),
      player2_hand = COALESCE(_player2_hand, player2_hand),
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

CREATE OR REPLACE FUNCTION public.cancel_waiting_game(_game_id uuid)
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

  IF g.player1_id <> uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF g.status <> 'waiting' OR g.player2_id IS NOT NULL THEN
    RAISE EXCEPTION 'cannot_cancel_started_game';
  END IF;

  DELETE FROM public.games WHERE id = _game_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

DROP POLICY IF EXISTS "games_insert_own_waiting" ON public.games;
CREATE POLICY "games_insert_own_waiting"
ON public.games
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = player1_id
  AND player2_id IS NULL
  AND status = 'waiting'::public.game_status
  AND winner_id IS NULL
  AND commission = 0
);

DROP POLICY IF EXISTS "games_delete_own_waiting" ON public.games;
CREATE POLICY "games_delete_own_waiting"
ON public.games
FOR DELETE
TO authenticated
USING (
  auth.uid() = player1_id
  AND status = 'waiting'::public.game_status
  AND player2_id IS NULL
);

DROP POLICY IF EXISTS "games_update_participant" ON public.games;
CREATE POLICY "games_update_participant"
ON public.games
FOR UPDATE
TO authenticated
USING (
  auth.uid() = player1_id OR auth.uid() = player2_id
)
WITH CHECK (
  auth.uid() = player1_id OR auth.uid() = player2_id
);

DROP POLICY IF EXISTS "moves_insert_participant" ON public.game_moves;
CREATE POLICY "moves_insert_participant"
ON public.game_moves
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = player_id
  AND EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = game_id
      AND (g.player1_id = auth.uid() OR g.player2_id = auth.uid())
  )
);

GRANT EXECUTE ON FUNCTION public.player_update_game_state(uuid, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, integer, public.game_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_waiting_game(uuid) TO authenticated;