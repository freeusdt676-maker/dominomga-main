
-- ============ PERF INDEXES (zero data change) ============
CREATE INDEX IF NOT EXISTS idx_games_status_created ON public.games(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_p1_status ON public.games(player1_id, status);
CREATE INDEX IF NOT EXISTS idx_games_p2_status ON public.games(player2_id, status);

CREATE INDEX IF NOT EXISTS idx_ludo_status_created ON public.ludo_games(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ludo_p1_status ON public.ludo_games(player1_id, status);
CREATE INDEX IF NOT EXISTS idx_ludo_p2_status ON public.ludo_games(player2_id, status);
CREATE INDEX IF NOT EXISTS idx_ludo_p3_status ON public.ludo_games(player3_id, status);
CREATE INDEX IF NOT EXISTS idx_ludo_p4_status ON public.ludo_games(player4_id, status);

CREATE INDEX IF NOT EXISTS idx_tx_user_status_created ON public.transactions(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_status_type ON public.transactions(status, type);

CREATE INDEX IF NOT EXISTS idx_chat_recipient_created ON public.chat_messages(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_game_created ON public.chat_messages(game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_broadcast_created ON public.chat_messages(is_admin_broadcast, created_at DESC) WHERE is_admin_broadcast = true;

CREATE INDEX IF NOT EXISTS idx_profiles_online ON public.profiles(is_online, last_seen DESC) WHERE is_online = true;
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone);

CREATE INDEX IF NOT EXISTS idx_challenges_to_status ON public.challenges(to_user, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_login_attempts_phone_created ON public.login_attempts(phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fraud_unresolved ON public.fraud_alerts(resolved, created_at DESC) WHERE resolved = false;

-- ============ ANTI DOUBLE-SETTLE (advisory lock per game) ============
CREATE OR REPLACE FUNCTION public.settle_game(_game_id uuid, _winner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g RECORD; commission_each NUMERIC; pot NUMERIC; pcount int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('settle:'||_game_id::text, 0));
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'Game not found'; END IF;
  IF g.status = 'finished' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  pcount := COALESCE(g.players_count, 2);
  IF _winner <> g.player1_id AND _winner <> g.player2_id AND _winner <> COALESCE(g.player3_id,'00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'Invalid winner';
  END IF;
  commission_each := round(g.stake * 0.10);
  pot := (g.stake - commission_each) * pcount;
  UPDATE public.wallets SET balance = balance + pot, updated_at = now() WHERE user_id = _winner;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id)
    VALUES (_winner,'game_win',pot,'completed',g.id);
  UPDATE public.games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now() WHERE id=g.id;
  RETURN jsonb_build_object('ok', true, 'pot', pot);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ludo_settle(_game_id uuid, _winner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE g RECORD; commission_each numeric; pot numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ludo_settle:'||_game_id::text, 0));
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status='finished' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF _winner NOT IN (g.player1_id, g.player2_id, g.player3_id, g.player4_id) THEN
    RAISE EXCEPTION 'invalid_winner'; END IF;
  commission_each := round(g.stake * 0.10);
  pot := (g.stake - commission_each) * g.players_count;
  UPDATE public.wallets SET balance=balance+pot, updated_at=now() WHERE user_id=_winner;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (_winner,'game_win',pot,'completed');
  UPDATE public.ludo_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now() WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'pot',pot);
END $function$;
