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

  -- Starting a new round deliberately resets board/hands/current_turn to that round's opener.
  -- That is not a within-round turn advance, so do not apply the left-rotation guard here.
  IF COALESCE(NEW.round_number, 1) IS DISTINCT FROM COALESCE(OLD.round_number, 1) THEN
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

  IF NOT hand_changed AND NOT board_changed THEN
    hand_before := public.domino_current_turn_hand(OLD);
    IF public.domino_hand_has_move(hand_before, OLD.board_state) THEN
      RAISE EXCEPTION 'player_has_move_no_skip';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.domino_guard_turn_rotation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.domino_guard_turn_rotation() TO service_role;