
-- Allow service_role to drive petanque_update_state from the autoplay edge function
CREATE OR REPLACE FUNCTION public.petanque_update_state(
  _game_id uuid,
  _state jsonb DEFAULT NULL,
  _current_turn uuid DEFAULT NULL,
  _turn_started_at timestamptz DEFAULT NULL,
  _score_p1 integer DEFAULT NULL,
  _score_p2 integer DEFAULT NULL,
  _round_number integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE g RECORD; uid uuid := auth.uid(); is_service boolean := (auth.role() = 'service_role');
BEGIN
  IF uid IS NULL AND NOT is_service THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF NOT is_service AND uid <> g.player1_id AND uid <> g.player2_id AND NOT public.has_role(uid,'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.petanque_games SET
    state = COALESCE(_state, state),
    current_turn = COALESCE(_current_turn, current_turn),
    turn_started_at = COALESCE(_turn_started_at, turn_started_at),
    score_p1 = COALESCE(_score_p1, score_p1),
    score_p2 = COALESCE(_score_p2, score_p2),
    round_number = COALESCE(_round_number, round_number),
    updated_at = now()
  WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true);
END
$function$;

-- Allow service_role to settle a finished petanque game from the autoplay edge function
CREATE OR REPLACE FUNCTION public.petanque_settle(
  _game_id uuid,
  _winner uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE g RECORD; pot numeric; caller uuid := auth.uid(); is_service boolean := (auth.role() = 'service_role');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('petanque_settle:'||_game_id::text, 0));
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status='finished' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF _winner NOT IN (g.player1_id, g.player2_id) THEN RAISE EXCEPTION 'invalid_winner'; END IF;
  IF NOT is_service AND NOT public.has_role(caller,'admin') THEN
    IF caller IS NULL OR caller NOT IN (g.player1_id, g.player2_id) THEN RAISE EXCEPTION 'forbidden_caller'; END IF;
  END IF;
  IF g.is_tournament = true THEN
    UPDATE public.petanque_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=_game_id;
    UPDATE public.tournament_matches SET winner_id=_winner, finished_at=now()
      WHERE game_id = _game_id AND winner_id IS NULL;
    RETURN jsonb_build_object('ok',true,'tournament',true);
  END IF;
  pot := g.cash_pool;
  IF pot <= 0 THEN RAISE EXCEPTION 'empty_cash_pool'; END IF;
  UPDATE public.wallets SET balance=balance+pot, updated_at=now() WHERE user_id=_winner;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (_winner,'game_win',pot,'completed',_game_id);
  UPDATE public.petanque_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'pot',pot);
END
$function$;

-- Schedule the petanque-autoplay edge function every 5 seconds
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'petanque-autoplay-tick') THEN
    PERFORM cron.unschedule('petanque-autoplay-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'petanque-autoplay-tick',
  '5 seconds',
  $$
  SELECT net.http_post(
    url := 'https://taucobvazpwzzhmapekh.supabase.co/functions/v1/petanque-autoplay',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhdWNvYnZhenB3enpobWFwZWtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNjE5NjksImV4cCI6MjA5MjkzNzk2OX0.nGwcrd200MVTTqoBaNqwQN4giMUGWTOH8-2ttyJOdcE"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
