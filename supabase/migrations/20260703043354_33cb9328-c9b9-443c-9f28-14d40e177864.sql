CREATE OR REPLACE FUNCTION public.domino_player_ids(_g public.games)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  ids uuid[];
BEGIN
  IF COALESCE(_g.players_count, 2) = 3 THEN
    ids := ARRAY[_g.player1_id, _g.player2_id, _g.player3_id];
  ELSE
    ids := ARRAY[_g.player1_id, _g.player2_id];
  END IF;
  RETURN ARRAY(SELECT x FROM unnest(ids) AS x WHERE x IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.domino_next_turn_id(_g public.games, _current uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  ids uuid[] := public.domino_player_ids(_g);
  len int := COALESCE(array_length(ids, 1), 0);
  idx int;
BEGIN
  IF _current IS NULL OR len = 0 THEN
    RETURN NULL;
  END IF;

  FOR idx IN 1..len LOOP
    IF ids[idx] = _current THEN
      -- Counter-clockwise / makany ankavia. 3P: P1 -> P3 -> P2 -> P1.
      IF idx = 1 THEN
        RETURN ids[len];
      END IF;
      RETURN ids[idx - 1];
    END IF;
  END LOOP;

  RETURN ids[1];
END;
$$;

CREATE OR REPLACE FUNCTION public.domino_current_turn_hand(_g public.games)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN CASE
    WHEN _g.current_turn = _g.player1_id THEN COALESCE(_g.player1_hand, '[]'::jsonb)
    WHEN _g.current_turn = _g.player2_id THEN COALESCE(_g.player2_hand, '[]'::jsonb)
    WHEN _g.current_turn = _g.player3_id THEN COALESCE(_g.player3_hand, '[]'::jsonb)
    ELSE '[]'::jsonb
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.domino_guard_turn_rotation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  expected_next uuid;
  hand_before jsonb;
  turn_advanced boolean;
  hand_changed boolean;
  board_changed boolean;
BEGIN
  IF OLD.status <> 'in_progress'::public.game_status
     OR NEW.status <> 'in_progress'::public.game_status THEN
    RETURN NEW;
  END IF;

  IF OLD.current_turn IS NULL OR NEW.current_turn IS NULL THEN
    RETURN NEW;
  END IF;

  turn_advanced := NEW.current_turn IS DISTINCT FROM OLD.current_turn;
  IF NOT turn_advanced THEN
    RETURN NEW;
  END IF;

  expected_next := public.domino_next_turn_id(OLD, OLD.current_turn);
  IF expected_next IS NOT NULL AND NEW.current_turn IS DISTINCT FROM expected_next THEN
    RAISE EXCEPTION 'domino_wrong_turn_rotation';
  END IF;

  hand_changed := CASE
    WHEN OLD.current_turn = OLD.player1_id THEN NEW.player1_hand IS DISTINCT FROM OLD.player1_hand
    WHEN OLD.current_turn = OLD.player2_id THEN NEW.player2_hand IS DISTINCT FROM OLD.player2_hand
    WHEN OLD.current_turn = OLD.player3_id THEN NEW.player3_hand IS DISTINCT FROM OLD.player3_hand
    ELSE false
  END;
  board_changed := NEW.board_state IS DISTINCT FROM OLD.board_state;

  -- If the turn advances without a tile being placed by the current player,
  -- it is a pass. A pass is forbidden while that player has any legal tile.
  IF NOT hand_changed AND NOT board_changed THEN
    hand_before := public.domino_current_turn_hand(OLD);
    IF public.domino_hand_has_move(hand_before, OLD.board_state) THEN
      RAISE EXCEPTION 'player_has_move_no_skip';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_domino_guard_turn_rotation ON public.games;
CREATE TRIGGER trg_domino_guard_turn_rotation
BEFORE UPDATE ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.domino_guard_turn_rotation();

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
  expected_next uuid;
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

  IF _current_turn IS NOT NULL
    AND g.current_turn IS NOT NULL
    AND _current_turn IS DISTINCT FROM g.current_turn THEN
    expected_next := public.domino_next_turn_id(g, g.current_turn);
    IF expected_next IS NOT NULL AND _current_turn IS DISTINCT FROM expected_next THEN
      RAISE EXCEPTION 'domino_wrong_turn_rotation';
    END IF;
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
    turn_hand := public.domino_current_turn_hand(g);

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

REVOKE ALL ON FUNCTION public.domino_player_ids(public.games) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.domino_player_ids(public.games) TO authenticated;
GRANT EXECUTE ON FUNCTION public.domino_player_ids(public.games) TO service_role;

REVOKE ALL ON FUNCTION public.domino_next_turn_id(public.games, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.domino_next_turn_id(public.games, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.domino_next_turn_id(public.games, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.domino_current_turn_hand(public.games) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.domino_current_turn_hand(public.games) TO authenticated;
GRANT EXECUTE ON FUNCTION public.domino_current_turn_hand(public.games) TO service_role;

REVOKE ALL ON FUNCTION public.domino_guard_turn_rotation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.domino_guard_turn_rotation() TO service_role;

REVOKE ALL ON FUNCTION public.player_update_game_state_guarded(uuid, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, integer, public.game_status, jsonb, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.player_update_game_state_guarded(uuid, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, integer, public.game_status, jsonb, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.player_update_game_state_guarded(uuid, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, integer, public.game_status, jsonb, uuid, timestamptz) TO service_role;