
-- Sequential player number for profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS player_number integer;

-- Backfill existing rows ordered by created_at
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM public.profiles
  WHERE player_number IS NULL
)
UPDATE public.profiles p
SET player_number = ordered.rn
FROM ordered
WHERE p.id = ordered.id;

-- Create sequence starting after max existing
DO $$
DECLARE
  maxn int;
BEGIN
  SELECT COALESCE(MAX(player_number), 0) INTO maxn FROM public.profiles;
  EXECUTE format('CREATE SEQUENCE IF NOT EXISTS public.profile_player_number_seq START %s', maxn + 1);
  PERFORM setval('public.profile_player_number_seq', GREATEST(maxn, 1), true);
END $$;

ALTER TABLE public.profiles
  ALTER COLUMN player_number SET DEFAULT nextval('public.profile_player_number_seq');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_player_number_uniq ON public.profiles(player_number);

-- Trigger to ensure assigned on insert if null
CREATE OR REPLACE FUNCTION public.profiles_assign_player_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.player_number IS NULL THEN
    NEW.player_number := nextval('public.profile_player_number_seq');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_assign_player_number_trg ON public.profiles;
CREATE TRIGGER profiles_assign_player_number_trg
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_assign_player_number();
