-- Petanque games table
CREATE TABLE public.petanque_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player1_id uuid NOT NULL,
  player2_id uuid,
  stake numeric NOT NULL,
  commission numeric NOT NULL DEFAULT 0,
  status game_status NOT NULL DEFAULT 'waiting',
  winner_id uuid,
  current_turn uuid,
  turn_started_at timestamptz,
  ticket_number text,
  score_p1 smallint NOT NULL DEFAULT 0,
  score_p2 smallint NOT NULL DEFAULT 0,
  round_number smallint NOT NULL DEFAULT 1,
  state jsonb NOT NULL DEFAULT '{"balls":[],"jack":null,"phase":"aim","remaining":{"p1":3,"p2":3}}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

ALTER TABLE public.petanque_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY pg_admin_all ON public.petanque_games FOR ALL
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY pg_select_participant ON public.petanque_games FOR SELECT
  USING (auth.uid() = player1_id OR auth.uid() = player2_id OR status = 'waiting' OR public.has_role(auth.uid(),'admin'));

CREATE POLICY pg_insert_own_waiting ON public.petanque_games FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = player1_id AND player2_id IS NULL AND status = 'waiting' AND winner_id IS NULL AND commission = 0);

CREATE POLICY pg_update_participant ON public.petanque_games FOR UPDATE
  USING (auth.uid() = player1_id OR auth.uid() = player2_id)
  WITH CHECK (auth.uid() = player1_id OR auth.uid() = player2_id);

CREATE POLICY pg_delete_own_waiting ON public.petanque_games FOR DELETE TO authenticated
  USING (auth.uid() = player1_id AND status = 'waiting' AND player2_id IS NULL);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.petanque_games;
ALTER TABLE public.petanque_games REPLICA IDENTITY FULL;

-- RPC: start deduct (commission + stake)
CREATE OR REPLACE FUNCTION public.petanque_start_deduct(_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g RECORD; commission_each numeric; total_commission numeric; admin_user uuid; bal numeric;
BEGIN
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status <> 'in_progress' THEN RAISE EXCEPTION 'not_in_progress'; END IF;
  IF g.commission > 0 THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF g.player2_id IS NULL THEN RAISE EXCEPTION 'no_opponent'; END IF;

  commission_each := round(g.stake * 0.10);
  total_commission := commission_each * 2;

  SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player1_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player1_id;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (g.player1_id,'game_stake',g.stake,'completed');

  SELECT balance INTO bal FROM public.wallets WHERE user_id=g.player2_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  UPDATE public.wallets SET balance=balance-g.stake, updated_at=now() WHERE user_id=g.player2_id;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (g.player2_id,'game_stake',g.stake,'completed');

  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id,balance) VALUES (admin_user,total_commission)
    ON CONFLICT (admin_id) DO UPDATE SET balance=admin_wallets.balance+EXCLUDED.balance, updated_at=now();
  END IF;

  UPDATE public.petanque_games SET commission=total_commission WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'commission',total_commission);
END $$;

-- RPC: join and start
CREATE OR REPLACE FUNCTION public.petanque_join_and_start(_game_id uuid, _user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g RECORD; ticket text;
BEGIN
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status <> 'waiting' OR g.player2_id IS NOT NULL THEN RAISE EXCEPTION 'already_taken'; END IF;
  IF g.player1_id = _user THEN RAISE EXCEPTION 'cannot_join_own'; END IF;
  ticket := to_char(now(),'YYYYMMDDHH24MISS');
  UPDATE public.petanque_games SET
    player2_id=_user,
    status='in_progress',
    current_turn=g.player1_id,
    turn_started_at=now(),
    ticket_number=ticket,
    state=jsonb_build_object(
      'balls', '[]'::jsonb,
      'jack', jsonb_build_object('x',0,'z',6),
      'phase','aim',
      'remaining', jsonb_build_object('p1',3,'p2',3)
    ),
    updated_at=now()
  WHERE id=_game_id;
  PERFORM public.petanque_start_deduct(_game_id);
  RETURN jsonb_build_object('ok',true,'ticket',ticket);
END $$;

-- RPC: cancel waiting
CREATE OR REPLACE FUNCTION public.petanque_cancel_waiting(_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g RECORD; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.player1_id <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF g.status <> 'waiting' OR g.player2_id IS NOT NULL THEN RAISE EXCEPTION 'cannot_cancel'; END IF;
  DELETE FROM public.petanque_games WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true);
END $$;

-- RPC: update state
CREATE OR REPLACE FUNCTION public.petanque_update_state(
  _game_id uuid,
  _state jsonb DEFAULT NULL,
  _current_turn uuid DEFAULT NULL,
  _turn_started_at timestamptz DEFAULT NULL,
  _score_p1 smallint DEFAULT NULL,
  _score_p2 smallint DEFAULT NULL,
  _round_number smallint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g RECORD; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF uid <> g.player1_id AND uid <> g.player2_id AND NOT public.has_role(uid,'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
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
END $$;

-- RPC: settle
CREATE OR REPLACE FUNCTION public.petanque_settle(_game_id uuid, _winner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g RECORD; commission_each numeric; pot numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('petanque_settle:'||_game_id::text, 0));
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status='finished' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF _winner NOT IN (g.player1_id, g.player2_id) THEN RAISE EXCEPTION 'invalid_winner'; END IF;
  commission_each := round(g.stake * 0.10);
  pot := (g.stake - commission_each) * 2;
  UPDATE public.wallets SET balance=balance+pot, updated_at=now() WHERE user_id=_winner;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (_winner,'game_win',pot,'completed');
  UPDATE public.petanque_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now() WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'pot',pot);
END $$;

-- Admin cancel petanque
CREATE OR REPLACE FUNCTION public.admin_cancel_petanque_game(_game_id uuid, _admin_id uuid, _pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g RECORD; pids uuid[]; pid uuid; refunded_count int := 0; admin_user uuid; refund_amount numeric;
BEGIN
  IF NOT public.has_role(_admin_id,'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status IN ('finished','cancelled') THEN RAISE EXCEPTION 'already_closed'; END IF;
  pids := ARRAY[g.player1_id, g.player2_id]::uuid[];
  refund_amount := COALESCE(g.stake, 0);
  FOREACH pid IN ARRAY pids LOOP
    CONTINUE WHEN pid IS NULL;
    IF COALESCE(g.commission,0) > 0 THEN
      UPDATE public.wallets SET balance=balance+refund_amount, updated_at=now() WHERE user_id=pid;
      INSERT INTO public.transactions(user_id,type,amount,status,admin_note,processed_at,processed_by)
        VALUES (pid,'deposit',refund_amount,'approved','Annulation admin - remboursement Pétanque',now(),_admin_id);
      refunded_count := refunded_count + 1;
    END IF;
  END LOOP;
  IF COALESCE(g.commission,0) > 0 THEN
    SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
    IF admin_user IS NOT NULL THEN
      UPDATE public.admin_wallets SET balance=GREATEST(0, balance - COALESCE(g.commission,0)), updated_at=now() WHERE admin_id=admin_user;
    END IF;
  END IF;
  UPDATE public.petanque_games SET status='cancelled', winner_id=NULL, finished_at=now(), updated_at=now() WHERE id=g.id;
  RETURN jsonb_build_object('ok',true,'kind','petanque','ticket_number',g.ticket_number,'refunded_players',refunded_count);
END $$;