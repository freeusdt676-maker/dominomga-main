CREATE OR REPLACE FUNCTION public.domino_normalize_turn_started_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'in_progress'::public.game_status
     AND NEW.current_turn IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.turn_started_at IS NULL THEN
        NEW.turn_started_at := now();
      END IF;
    ELSIF NEW.current_turn IS DISTINCT FROM OLD.current_turn
       OR OLD.turn_started_at IS NULL THEN
      NEW.turn_started_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.domino_normalize_turn_started_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.domino_normalize_turn_started_at() TO service_role;