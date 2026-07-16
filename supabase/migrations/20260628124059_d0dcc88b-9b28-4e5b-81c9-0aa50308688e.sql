CREATE OR REPLACE FUNCTION public.domino_tile_can_place(_board jsonb, _tile jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  first_piece jsonb;
  last_piece jsonb;
  first_tile jsonb;
  last_tile jsonb;
  first_flipped boolean;
  last_flipped boolean;
  left_end integer;
  right_end integer;
  a integer;
  b integer;
BEGIN
  IF _tile IS NULL OR jsonb_typeof(_tile) <> 'array' OR jsonb_array_length(_tile) < 2 THEN
    RETURN false;
  END IF;

  a := (_tile->>0)::integer;
  b := (_tile->>1)::integer;

  IF _board IS NULL OR jsonb_typeof(_board) <> 'array' OR jsonb_array_length(_board) = 0 THEN
    RETURN true;
  END IF;

  first_piece := _board->0;
  last_piece := _board->(jsonb_array_length(_board) - 1);
  first_tile := first_piece->'tile';
  last_tile := last_piece->'tile';
  first_flipped := COALESCE((first_piece->>'flipped')::boolean, false);
  last_flipped := COALESCE((last_piece->>'flipped')::boolean, false);

  IF first_tile IS NULL OR last_tile IS NULL THEN
    RETURN false;
  END IF;

  left_end := CASE WHEN first_flipped THEN (first_tile->>1)::integer ELSE (first_tile->>0)::integer END;
  right_end := CASE WHEN last_flipped THEN (last_tile->>0)::integer ELSE (last_tile->>1)::integer END;

  RETURN a = left_end OR b = left_end OR a = right_end OR b = right_end;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.domino_hand_has_move(_hand jsonb, _board jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  tile jsonb;
BEGIN
  IF _hand IS NULL OR jsonb_typeof(_hand) <> 'array' THEN
    RETURN false;
  END IF;

  FOR tile IN SELECT value FROM jsonb_array_elements(_hand)
  LOOP
    IF public.domino_tile_can_place(_board, tile) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

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
  turn_hand jsonb;
  only_turn_advanced boolean;
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

  only_turn_advanced := _board_state IS NULL
    AND _player1_hand IS NULL
    AND _player2_hand IS NULL
    AND _player3_hand IS NULL
    AND _boneyard IS NULL
    AND _status IS NULL
    AND _current_turn IS NOT NULL
    AND _current_turn IS DISTINCT FROM g.current_turn
    AND COALESCE(_passes, g.passes) > COALESCE(g.passes, 0);

  IF only_turn_advanced AND g.current_turn IS NOT NULL THEN
    turn_hand := CASE
      WHEN g.current_turn = g.player1_id THEN g.player1_hand
      WHEN g.current_turn = g.player2_id THEN g.player2_hand
      WHEN g.current_turn = g.player3_id THEN g.player3_hand
      ELSE '[]'::jsonb
    END;

    IF public.domino_hand_has_move(turn_hand, g.board_state) THEN
      RAISE EXCEPTION 'player_has_move_no_skip';
    END IF;
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

REVOKE ALL ON FUNCTION public.domino_tile_can_place(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.domino_tile_can_place(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.domino_tile_can_place(jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.domino_hand_has_move(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.domino_hand_has_move(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.domino_hand_has_move(jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.player_update_game_state_guarded(uuid, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, integer, public.game_status, jsonb, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.player_update_game_state_guarded(uuid, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, integer, public.game_status, jsonb, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.player_update_game_state_guarded(uuid, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, integer, public.game_status, jsonb, uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_adjust_player_wallet(
  _user_id uuid,
  _admin_id uuid,
  _type public.transaction_type,
  _amount numeric,
  _pin text,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur numeric;
  newbal numeric;
  tx_id uuid;
  clean_note text;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _pin <> '2583' THEN
    RAISE EXCEPTION 'pin_diso';
  END IF;

  IF _type NOT IN ('deposit', 'withdrawal') THEN
    RAISE EXCEPTION 'invalid_tx_type';
  END IF;

  IF COALESCE(_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT balance INTO cur FROM public.wallets WHERE user_id = _user_id FOR UPDATE;
  IF cur IS NULL THEN
    INSERT INTO public.wallets(user_id, balance) VALUES (_user_id, 0);
    cur := 0;
  END IF;

  IF _type = 'deposit' THEN
    newbal := cur + _amount;
  ELSE
    IF cur < _amount THEN
      RAISE EXCEPTION 'insufficient_balance';
    END IF;
    newbal := cur - _amount;
  END IF;

  clean_note := COALESCE(NULLIF(trim(_note), ''), 'Réclamation administratif');

  UPDATE public.wallets
  SET balance = newbal, updated_at = now()
  WHERE user_id = _user_id;

  INSERT INTO public.transactions(user_id, type, amount, status, admin_note, processed_by, processed_at, mvola_reference)
  VALUES (_user_id, _type, _amount, 'approved', clean_note, _admin_id, now(), 'RECLAMATION-ADMIN')
  RETURNING id INTO tx_id;

  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (
    _admin_id,
    _user_id,
    CASE WHEN _type = 'deposit' THEN 'Dépôt administratif +' ELSE 'Retrait administratif -' END || _amount::text || ' Ar — ' || clean_note,
    false
  );

  RETURN jsonb_build_object('ok', true, 'transaction_id', tx_id, 'old_balance', cur, 'new_balance', newbal);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_player_wallet(uuid, uuid, public.transaction_type, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_player_wallet(uuid, uuid, public.transaction_type, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_player_wallet(uuid, uuid, public.transaction_type, numeric, text, text) TO service_role;