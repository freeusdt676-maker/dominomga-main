CREATE OR REPLACE FUNCTION public.settle_game(_game_id uuid, _winner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g RECORD;
  pot NUMERIC;
  caller uuid := auth.uid();
  winner_score numeric := 0;
  target_score numeric := 120;
  instant_domino_win boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('settle:'||_game_id::text, 0));
  PERFORM public.allow_wallet_mutation();

  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status = 'finished' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;

  IF _winner <> g.player1_id AND _winner <> g.player2_id
     AND _winner <> COALESCE(g.player3_id,'00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'invalid_winner';
  END IF;

  IF NOT public.has_role(caller, 'admin') THEN
    IF caller IS NULL OR caller NOT IN (g.player1_id, g.player2_id, COALESCE(g.player3_id, g.player1_id)) THEN
      RAISE EXCEPTION 'forbidden_caller';
    END IF;
  END IF;

  IF g.is_tournament = true THEN
    UPDATE public.games
      SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0
      WHERE id=g.id;
    UPDATE public.tournament_matches SET winner_id = _winner, finished_at = now()
      WHERE game_id = g.id AND winner_id IS NULL;
    RETURN jsonb_build_object('ok', true, 'tournament', true);
  END IF;

  IF g.game_mode = 'd80' THEN target_score := 80; ELSE target_score := 120; END IF;

  winner_score := CASE
    WHEN _winner = g.player1_id THEN COALESCE(g.score_p1, 0)
    WHEN _winner = g.player2_id THEN COALESCE(g.score_p2, 0)
    WHEN _winner = g.player3_id THEN COALESCE(g.score_p3, 0)
    ELSE 0
  END;

  instant_domino_win := COALESCE(g.last_reason, '') LIKE 'MANDRESY NY LALAO — MANDEHA IRERY%'
    OR COALESCE(g.last_reason, '') LIKE 'MANDRESY NY LALAO — DOUBLE 6%'
    OR COALESCE(g.last_reason, '') LIKE 'MANDRESY NY LALAO — DATINANDRO%';

  IF NOT public.has_role(caller, 'admin') AND caller = _winner AND winner_score < target_score AND NOT instant_domino_win THEN
    RAISE EXCEPTION 'domino_target_not_reached';
  END IF;

  pot := g.cash_pool;
  IF pot <= 0 THEN RAISE EXCEPTION 'empty_cash_pool'; END IF;

  UPDATE public.wallets SET balance = balance + pot, updated_at = now() WHERE user_id = _winner;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id)
  VALUES (_winner,'game_win',pot,'completed',g.id);

  UPDATE public.games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0
  WHERE id=g.id;

  RETURN jsonb_build_object('ok', true, 'pot', pot, 'target_score', target_score, 'winner_score', winner_score, 'instant_domino_win', instant_domino_win);
END $$;