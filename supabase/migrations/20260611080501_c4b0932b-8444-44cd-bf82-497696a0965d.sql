CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Allow the system (service role) to drive auto-play when a turn expires
CREATE OR REPLACE FUNCTION public.ludo_update_state(_game_id uuid, _pawns jsonb DEFAULT NULL::jsonb, _current_turn_seat smallint DEFAULT NULL::smallint, _last_dice smallint DEFAULT NULL::smallint, _dice_rolled boolean DEFAULT NULL::boolean, _consecutive_sixes smallint DEFAULT NULL::smallint, _turn_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE g RECORD; uid uuid := auth.uid(); is_system boolean := (COALESCE(auth.role(),'') = 'service_role');
BEGIN
  IF uid IS NULL AND NOT is_system THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF NOT is_system
     AND uid NOT IN (g.player1_id, g.player2_id, g.player3_id, g.player4_id)
     AND NOT public.has_role(uid,'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.ludo_games SET
    pawns = COALESCE(_pawns, pawns),
    current_turn_seat = COALESCE(_current_turn_seat, current_turn_seat),
    last_dice = COALESCE(_last_dice, last_dice),
    dice_rolled = COALESCE(_dice_rolled, dice_rolled),
    consecutive_sixes = COALESCE(_consecutive_sixes, consecutive_sixes),
    turn_started_at = COALESCE(_turn_started_at, turn_started_at),
    updated_at = now()
  WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true);
END $function$;

CREATE OR REPLACE FUNCTION public.ludo_settle(_game_id uuid, _winner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE g RECORD; pot numeric; caller uuid := auth.uid(); is_system boolean := (COALESCE(auth.role(),'') = 'service_role');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ludo_settle:'||_game_id::text, 0));
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status='finished' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF _winner NOT IN (g.player1_id, g.player2_id, g.player3_id, g.player4_id) THEN
    RAISE EXCEPTION 'invalid_winner'; END IF;
  IF NOT is_system AND NOT public.has_role(caller, 'admin') THEN
    IF caller IS NULL OR caller NOT IN (g.player1_id, g.player2_id, COALESCE(g.player3_id,g.player1_id), COALESCE(g.player4_id,g.player1_id)) THEN
      RAISE EXCEPTION 'forbidden_caller';
    END IF;
  END IF;
  pot := g.cash_pool;
  IF pot <= 0 THEN RAISE EXCEPTION 'empty_cash_pool'; END IF;
  UPDATE public.wallets SET balance=balance+pot, updated_at=now() WHERE user_id=_winner;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (_winner,'game_win',pot,'completed',_game_id);
  UPDATE public.ludo_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'pot',pot);
END $function$;

-- Run the server-side Ludo auto-play every 5 seconds
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ludo-autoplay-tick') THEN
    PERFORM cron.unschedule('ludo-autoplay-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'ludo-autoplay-tick',
  '5 seconds',
  $$
  SELECT net.http_post(
    url := 'https://taucobvazpwzzhmapekh.supabase.co/functions/v1/ludo-autoplay',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhdWNvYnZhenB3enpobWFwZWtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNjE5NjksImV4cCI6MjA5MjkzNzk2OX0.nGwcrd200MVTTqoBaNqwQN4giMUGWTOH8-2ttyJOdcE"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);