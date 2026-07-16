CREATE OR REPLACE FUNCTION public.expire_stale_waiting_games()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c1 int := 0;
  c2 int := 0;
  c3 int := 0;
  c4 int := 0;
  c5 int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  WITH d AS (
    DELETE FROM public.games
    WHERE status='waiting'
      AND player2_id IS NULL
      AND created_at < now()-interval '2 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO c1 FROM d;

  WITH d AS (
    DELETE FROM public.ludo_games
    WHERE status='waiting'
      AND player2_id IS NULL
      AND created_at < now()-interval '2 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO c2 FROM d;

  WITH d AS (
    DELETE FROM public.petanque_games
    WHERE status='waiting'
      AND player2_id IS NULL
      AND created_at < now()-interval '2 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO c3 FROM d;

  WITH del AS (
    DELETE FROM public.games
    WHERE players_count = 3
      AND status='waiting'
      AND player2_id IS NOT NULL
      AND player3_id IS NULL
      AND created_at < now()-interval '5 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO c4 FROM del;

  WITH del AS (
    DELETE FROM public.ludo_games
    WHERE players_count >= 3
      AND status='waiting'
      AND (
        (players_count = 3 AND player2_id IS NOT NULL AND player3_id IS NULL)
        OR
        (players_count = 4 AND player3_id IS NOT NULL AND player4_id IS NULL)
      )
      AND created_at < now()-interval '5 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO c5 FROM del;

  RETURN jsonb_build_object(
    'domino', c1,
    'ludo', c2,
    'petanque', c3,
    'domino_3p', c4,
    'ludo_multi', c5
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_total_player_balance(_admin_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(w.balance), 0)
  FROM public.wallets w
  WHERE public.has_role(_admin_id, 'admin')
    AND w.user_id NOT IN (
      SELECT user_id
      FROM public.user_roles
      WHERE role = 'admin'
    );
$function$;