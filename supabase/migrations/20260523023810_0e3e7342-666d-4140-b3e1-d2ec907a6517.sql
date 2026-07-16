
-- 1) Auto-cancel stale waiting games (>2 min, no opponent yet) across all 3 game types
CREATE OR REPLACE FUNCTION public.expire_stale_waiting_games()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c1 int := 0; c2 int := 0; c3 int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

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

  RETURN jsonb_build_object('domino', c1, 'ludo', c2, 'petanque', c3);
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_stale_waiting_games() TO authenticated;

-- 2) User self-reset: clears chats, lobby messages, transaction history and finished/cancelled games history.
--    NEVER touches public.wallets (balance preserved).
CREATE OR REPLACE FUNCTION public.user_reset_history()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ch_cnt int := 0; lb_cnt int := 0; tx_cnt int := 0;
  g_cnt int := 0; l_cnt int := 0; p_cnt int := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  WITH d AS (
    DELETE FROM public.chat_messages
    WHERE sender_id = uid OR recipient_id = uid
    RETURNING 1
  ) SELECT count(*) INTO ch_cnt FROM d;

  WITH d AS (
    DELETE FROM public.lobby_messages WHERE sender_id = uid
    RETURNING 1
  ) SELECT count(*) INTO lb_cnt FROM d;

  WITH d AS (
    DELETE FROM public.transactions WHERE user_id = uid
    RETURNING 1
  ) SELECT count(*) INTO tx_cnt FROM d;

  -- Only delete finished/cancelled games (do not destroy live games of co-players)
  WITH d AS (
    DELETE FROM public.games
    WHERE status IN ('finished','cancelled','blocked')
      AND (player1_id = uid OR player2_id = uid OR player3_id = uid)
    RETURNING 1
  ) SELECT count(*) INTO g_cnt FROM d;

  WITH d AS (
    DELETE FROM public.ludo_games
    WHERE status IN ('finished','cancelled','blocked')
      AND (player1_id = uid OR player2_id = uid OR player3_id = uid OR player4_id = uid)
    RETURNING 1
  ) SELECT count(*) INTO l_cnt FROM d;

  WITH d AS (
    DELETE FROM public.petanque_games
    WHERE status IN ('finished','cancelled','blocked')
      AND (player1_id = uid OR player2_id = uid)
    RETURNING 1
  ) SELECT count(*) INTO p_cnt FROM d;

  RETURN jsonb_build_object(
    'chat', ch_cnt, 'lobby', lb_cnt, 'tx', tx_cnt,
    'domino', g_cnt, 'ludo', l_cnt, 'petanque', p_cnt
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_reset_history() TO authenticated;
