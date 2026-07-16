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
      -- Contraire montre / makany ankavia amin'ny ordre table live.
      -- 3P: P1 -> P2 -> P3 -> P1.
      RETURN ids[(idx % len) + 1];
    END IF;
  END LOOP;

  RETURN ids[1];
END;
$$;

REVOKE ALL ON FUNCTION public.domino_next_turn_id(public.games, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.domino_next_turn_id(public.games, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.domino_next_turn_id(public.games, uuid) TO service_role;