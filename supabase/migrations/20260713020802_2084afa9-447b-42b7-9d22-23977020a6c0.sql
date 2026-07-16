CREATE OR REPLACE FUNCTION public.domino_normalize_turn_started_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'in_progress'::public.game_status
     AND NEW.current_turn IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.current_turn IS DISTINCT FROM OLD.current_turn
       OR OLD.turn_started_at IS NULL
     ) THEN
    NEW.turn_started_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_domino_normalize_turn_started_at ON public.games;
CREATE TRIGGER trg_domino_normalize_turn_started_at
BEFORE INSERT OR UPDATE ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.domino_normalize_turn_started_at();

REVOKE ALL ON FUNCTION public.domino_normalize_turn_started_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.domino_normalize_turn_started_at() TO service_role;