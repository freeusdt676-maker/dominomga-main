
-- 1) Fix bogus far-future self-exclusion dates
UPDATE public.responsible_gaming
SET self_excluded_until = NULL
WHERE self_excluded_until IS NOT NULL
  AND self_excluded_until > (now() + interval '10 years');

-- 2) Guard trigger to clamp any future inserts/updates
CREATE OR REPLACE FUNCTION public.responsible_gaming_clamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.self_excluded_until IS NOT NULL
     AND NEW.self_excluded_until > (now() + interval '10 years') THEN
    NEW.self_excluded_until := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_responsible_gaming_clamp ON public.responsible_gaming;
CREATE TRIGGER trg_responsible_gaming_clamp
BEFORE INSERT OR UPDATE ON public.responsible_gaming
FOR EACH ROW EXECUTE FUNCTION public.responsible_gaming_clamp();

-- 3) Clean Ludo lobby (only Ludo — Pétanque & Domino untouched).
--    Refund any in_progress games where stakes were already deducted.
DO $$
DECLARE g RECORD;
BEGIN
  FOR g IN
    SELECT id, stake, players_count, commission,
           player1_id, player2_id, player3_id, player4_id
    FROM public.ludo_games
    WHERE status IN ('waiting','in_progress')
  LOOP
    IF g.commission IS NOT NULL AND g.commission > 0 THEN
      -- Stakes were deducted: refund each seated player
      FOR i IN 1..4 LOOP
        DECLARE pid uuid;
        BEGIN
          pid := (ARRAY[g.player1_id, g.player2_id, g.player3_id, g.player4_id])[i];
          IF pid IS NOT NULL THEN
            UPDATE public.wallets
              SET balance = balance + g.stake, updated_at = now()
              WHERE user_id = pid;
            INSERT INTO public.transactions(user_id, type, amount, status)
              VALUES (pid, 'refund', g.stake, 'completed');
          END IF;
        END;
      END LOOP;
    END IF;
    DELETE FROM public.ludo_games WHERE id = g.id;
  END LOOP;
END $$;
