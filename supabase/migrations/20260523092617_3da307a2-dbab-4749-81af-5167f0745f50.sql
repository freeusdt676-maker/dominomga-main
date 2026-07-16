CREATE OR REPLACE FUNCTION public.expire_stale_waiting_games()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c1 int := 0; c2 int := 0; c3 int := 0; c4 int := 0; c5 int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 2P rooms waiting too long for an opponent
  WITH d AS (
    DELETE FROM public.games
    WHERE status = 'waiting'
      AND player2_id IS NULL
      AND created_at < now() - interval '2 minutes'
    RETURNING 1
  ) SELECT count(*) INTO c1 FROM d;

  WITH d AS (
    DELETE FROM public.ludo_games
    WHERE status = 'waiting'
      AND player2_id IS NULL
      AND created_at < now() - interval '2 minutes'
    RETURNING 1
  ) SELECT count(*) INTO c2 FROM d;

  WITH d AS (
    DELETE FROM public.petanque_games
    WHERE status = 'waiting'
      AND player2_id IS NULL
      AND created_at < now() - interval '2 minutes'
    RETURNING 1
  ) SELECT count(*) INTO c3 FROM d;

  -- 3P rooms that never got a third player: refund player1 + player2 and delete
  WITH stale AS (
    SELECT id, player1_id, player2_id, stake
    FROM public.games
    WHERE players_count = 3
      AND status = 'waiting'
      AND player3_id IS NULL
      AND created_at < now() - interval '5 minutes'
    FOR UPDATE
  ),
  refund AS (
    UPDATE public.wallets w
    SET balance = balance + s.stake
    FROM stale s
    WHERE w.user_id IN (s.player1_id, s.player2_id)
    RETURNING 1
  ),
  del AS (
    DELETE FROM public.games WHERE id IN (SELECT id FROM stale)
    RETURNING 1
  )
  SELECT count(*) INTO c4 FROM del;

  -- Same for Ludo 3P/4P rooms missing seats after 5 minutes
  WITH stale AS (
    SELECT id, player1_id, player2_id, player3_id, stake, players_count
    FROM public.ludo_games
    WHERE players_count >= 3
      AND status = 'waiting'
      AND (
        (players_count = 3 AND player3_id IS NULL) OR
        (players_count = 4 AND player4_id IS NULL)
      )
      AND created_at < now() - interval '5 minutes'
    FOR UPDATE
  ),
  refund AS (
    UPDATE public.wallets w
    SET balance = balance + s.stake
    FROM stale s
    WHERE w.user_id IN (s.player1_id, s.player2_id, s.player3_id)
    RETURNING 1
  ),
  del AS (
    DELETE FROM public.ludo_games WHERE id IN (SELECT id FROM stale)
    RETURNING 1
  )
  SELECT count(*) INTO c5 FROM del;

  RETURN jsonb_build_object('domino', c1, 'ludo', c2, 'petanque', c3, 'domino_3p', c4, 'ludo_multi', c5);
END
$function$;