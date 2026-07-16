
-- LUDO GAMES TABLE
CREATE TABLE IF NOT EXISTS public.ludo_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  players_count smallint NOT NULL DEFAULT 4,
  stake numeric NOT NULL,
  status public.game_status NOT NULL DEFAULT 'waiting',
  player1_id uuid NOT NULL,
  player2_id uuid,
  player3_id uuid,
  player4_id uuid,
  current_turn_seat smallint NOT NULL DEFAULT 1,
  last_dice smallint,
  dice_rolled boolean NOT NULL DEFAULT false,
  consecutive_sixes smallint NOT NULL DEFAULT 0,
  pawns jsonb NOT NULL DEFAULT '[]'::jsonb,
  winner_id uuid,
  ticket_number text,
  commission numeric NOT NULL DEFAULT 0,
  turn_started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ludo_games_status_idx ON public.ludo_games(status);
CREATE INDEX IF NOT EXISTS ludo_games_p1_idx ON public.ludo_games(player1_id);

ALTER TABLE public.ludo_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY ludo_games_admin_all ON public.ludo_games FOR ALL
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY ludo_games_select_participant ON public.ludo_games FOR SELECT
  USING (
    auth.uid() = player1_id OR auth.uid() = player2_id OR
    auth.uid() = player3_id OR auth.uid() = player4_id OR
    status = 'waiting' OR public.has_role(auth.uid(),'admin')
  );

CREATE POLICY ludo_games_insert_own_waiting ON public.ludo_games FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = player1_id AND player2_id IS NULL AND player3_id IS NULL AND player4_id IS NULL
    AND status = 'waiting' AND winner_id IS NULL AND commission = 0
  );

CREATE POLICY ludo_games_update_participant ON public.ludo_games FOR UPDATE
  USING (
    auth.uid() = player1_id OR auth.uid() = player2_id OR
    auth.uid() = player3_id OR auth.uid() = player4_id
  )
  WITH CHECK (
    auth.uid() = player1_id OR auth.uid() = player2_id OR
    auth.uid() = player3_id OR auth.uid() = player4_id
  );

CREATE POLICY ludo_games_delete_own_waiting ON public.ludo_games FOR DELETE TO authenticated
  USING (auth.uid() = player1_id AND status='waiting' AND player2_id IS NULL);

CREATE TRIGGER ludo_games_updated_at
  BEFORE UPDATE ON public.ludo_games
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER TABLE public.ludo_games REPLICA IDENTITY FULL;
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='ludo_games';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.ludo_games';
  END IF;
END $$;

-- Helper: build initial pawns jsonb for N players
CREATE OR REPLACE FUNCTION public.ludo_initial_pawns(_n int)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb := '[]'::jsonb; s int; i int;
BEGIN
  FOR s IN 1.._n LOOP
    FOR i IN 0..3 LOOP
      result := result || jsonb_build_array(jsonb_build_object('seat',s,'idx',i,'pos',-1));
    END LOOP;
  END LOOP;
  RETURN result;
END $$;

-- DEDUCT STAKES + COMMISSION
CREATE OR REPLACE FUNCTION public.ludo_start_deduct(_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  g RECORD; commission_each numeric; total_commission numeric;
  admin_user uuid; bal numeric; pids uuid[]; pid uuid; n int;
BEGIN
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status <> 'in_progress' THEN RAISE EXCEPTION 'not_in_progress'; END IF;
  IF g.commission > 0 THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;

  n := g.players_count;
  pids := ARRAY[g.player1_id, g.player2_id, g.player3_id, g.player4_id]::uuid[];
  commission_each := round(g.stake * 0.10);
  total_commission := commission_each * n;

  FOR i IN 1..n LOOP
    pid := pids[i];
    IF pid IS NULL THEN RAISE EXCEPTION 'missing_player'; END IF;
    SELECT balance INTO bal FROM public.wallets WHERE user_id=pid FOR UPDATE;
    IF bal < g.stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
    UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=pid;
    INSERT INTO public.transactions(user_id,type,amount,status) VALUES (pid,'game_stake',g.stake,'completed');
  END LOOP;

  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id,balance) VALUES (admin_user,total_commission)
    ON CONFLICT (admin_id) DO UPDATE SET balance=admin_wallets.balance+EXCLUDED.balance, updated_at=now();
  END IF;

  UPDATE public.ludo_games SET commission=total_commission WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'commission',total_commission);
END $$;

-- JOIN OR START
CREATE OR REPLACE FUNCTION public.ludo_join_and_start(_game_id uuid, _user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g RECORD; ticket text; seat int := 0; filled int;
BEGIN
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status='finished' THEN RAISE EXCEPTION 'finished'; END IF;
  IF _user IN (g.player1_id, g.player2_id, g.player3_id, g.player4_id) THEN
    RETURN jsonb_build_object('ok',true,'already_in',true);
  END IF;
  IF g.player2_id IS NULL THEN seat := 2;
  ELSIF g.player3_id IS NULL AND g.players_count>=3 THEN seat := 3;
  ELSIF g.player4_id IS NULL AND g.players_count>=4 THEN seat := 4;
  ELSE RAISE EXCEPTION 'full'; END IF;

  IF seat=2 THEN UPDATE public.ludo_games SET player2_id=_user, updated_at=now() WHERE id=_game_id;
  ELSIF seat=3 THEN UPDATE public.ludo_games SET player3_id=_user, updated_at=now() WHERE id=_game_id;
  ELSIF seat=4 THEN UPDATE public.ludo_games SET player4_id=_user, updated_at=now() WHERE id=_game_id;
  END IF;

  -- Re-read
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  filled := (CASE WHEN g.player1_id IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN g.player2_id IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN g.player3_id IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN g.player4_id IS NOT NULL THEN 1 ELSE 0 END);
  IF filled = g.players_count AND g.status='waiting' THEN
    ticket := to_char(now(),'YYYYMMDDHH24MISS');
    UPDATE public.ludo_games
      SET status='in_progress',
          current_turn_seat=1,
          turn_started_at=now(),
          ticket_number=ticket,
          pawns=public.ludo_initial_pawns(g.players_count),
          updated_at=now()
      WHERE id=_game_id;
    PERFORM public.ludo_start_deduct(_game_id);
  END IF;
  RETURN jsonb_build_object('ok',true,'seat',seat);
END $$;

-- CANCEL
CREATE OR REPLACE FUNCTION public.ludo_cancel_waiting(_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g RECORD; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.player1_id <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF g.status <> 'waiting' OR g.player2_id IS NOT NULL THEN RAISE EXCEPTION 'cannot_cancel'; END IF;
  DELETE FROM public.ludo_games WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true);
END $$;

-- SETTLE
CREATE OR REPLACE FUNCTION public.ludo_settle(_game_id uuid, _winner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g RECORD; commission_each numeric; pot numeric;
BEGIN
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
END $$;

-- UPDATE STATE (turn / pawns / dice)
CREATE OR REPLACE FUNCTION public.ludo_update_state(
  _game_id uuid,
  _pawns jsonb DEFAULT NULL,
  _current_turn_seat smallint DEFAULT NULL,
  _last_dice smallint DEFAULT NULL,
  _dice_rolled boolean DEFAULT NULL,
  _consecutive_sixes smallint DEFAULT NULL,
  _turn_started_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g RECORD; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF uid NOT IN (g.player1_id, g.player2_id, g.player3_id, g.player4_id)
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
END $$;
