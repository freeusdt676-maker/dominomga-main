CREATE OR REPLACE FUNCTION public.domino_next_turn_id(_g games, _current uuid) RETURNS uuid LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  ids uuid[] := public.domino_player_ids(_g);
  len int := COALESCE(array_length(ids, 1), 0);
  idx int;
BEGIN
  IF _current IS NULL OR len = 0 THEN RETURN NULL; END IF;
  FOR idx IN 1..len LOOP
    IF ids[idx] = _current THEN
      RETURN ids[((idx - 2 + len) % len) + 1];
    END IF;
  END LOOP;
  RETURN ids[1];
END;
$$;