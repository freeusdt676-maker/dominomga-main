-- 1) Add new columns to games
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS players_count smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS player3_id uuid,
  ADD COLUMN IF NOT EXISTS player3_hand jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS score_p3 numeric NOT NULL DEFAULT 0;

ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS players_count smallint NOT NULL DEFAULT 2;

ALTER TABLE public.matchmaking_queue
  ADD COLUMN IF NOT EXISTS players_count smallint NOT NULL DEFAULT 2;

-- 2) Update RLS policies for games to include player3
DROP POLICY IF EXISTS games_select_participant ON public.games;
CREATE POLICY games_select_participant ON public.games
FOR SELECT USING (
  auth.uid() = player1_id
  OR auth.uid() = player2_id
  OR auth.uid() = player3_id
  OR status = 'waiting'::game_status
  OR has_role(auth.uid(), 'admin'::app_role)
);

DROP POLICY IF EXISTS games_update_participant ON public.games;
CREATE POLICY games_update_participant ON public.games
FOR UPDATE USING (
  auth.uid() = player1_id OR auth.uid() = player2_id OR auth.uid() = player3_id
) WITH CHECK (
  auth.uid() = player1_id OR auth.uid() = player2_id OR auth.uid() = player3_id
);

-- 3) Update player_update_game_state to support player3_hand
CREATE OR REPLACE FUNCTION public.player_update_game_state(
  _game_id uuid,
  _board_state jsonb DEFAULT NULL,
  _player1_hand jsonb DEFAULT NULL,
  _player2_hand jsonb DEFAULT NULL,
  _boneyard jsonb DEFAULT NULL,
  _current_turn uuid DEFAULT NULL,
  _turn_started_at timestamp with time zone DEFAULT NULL,
  _passes integer DEFAULT NULL,
  _status game_status DEFAULT NULL,
  _player3_hand jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  g public.games%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF uid <> g.player1_id AND uid <> g.player2_id AND uid <> COALESCE(g.player3_id, '00000000-0000-0000-0000-000000000000'::uuid) AND NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.games SET
    board_state = COALESCE(_board_state, board_state),
    player1_hand = COALESCE(_player1_hand, player1_hand),
    player2_hand = COALESCE(_player2_hand, player2_hand),
    player3_hand = COALESCE(_player3_hand, player3_hand),
    boneyard = COALESCE(_boneyard, boneyard),
    current_turn = COALESCE(_current_turn, current_turn),
    turn_started_at = COALESCE(_turn_started_at, turn_started_at),
    passes = COALESCE(_passes, passes),
    status = COALESCE(_status, status),
    updated_at = now()
  WHERE id = _game_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- 4) Update start_game_deduct to handle 3 players
CREATE OR REPLACE FUNCTION public.start_game_deduct(_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  g RECORD;
  commission_each NUMERIC;
  admin_user UUID;
  bal NUMERIC;
  pcount int;
  total_commission NUMERIC;
BEGIN
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'Game not found'; END IF;
  IF g.status <> 'in_progress' THEN RAISE EXCEPTION 'Game not in_progress'; END IF;
  IF g.commission > 0 THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  pcount := COALESCE(g.players_count, 2);
  IF pcount = 2 AND g.player2_id IS NULL THEN RAISE EXCEPTION 'No opponent'; END IF;
  IF pcount = 3 AND (g.player2_id IS NULL OR g.player3_id IS NULL) THEN RAISE EXCEPTION 'No opponents'; END IF;

  commission_each := round(g.stake * 0.10);
  total_commission := commission_each * pcount;

  -- Player 1
  SELECT balance INTO bal FROM public.wallets WHERE user_id = g.player1_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  UPDATE public.wallets SET balance = balance - g.stake, updated_at = now() WHERE user_id = g.player1_id;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (g.player1_id,'game_stake',g.stake,'completed',g.id);

  -- Player 2
  SELECT balance INTO bal FROM public.wallets WHERE user_id = g.player2_id FOR UPDATE;
  IF bal < g.stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  UPDATE public.wallets SET balance = balance - g.stake, updated_at = now() WHERE user_id = g.player2_id;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (g.player2_id,'game_stake',g.stake,'completed',g.id);

  -- Player 3 (if 3P)
  IF pcount = 3 THEN
    SELECT balance INTO bal FROM public.wallets WHERE user_id = g.player3_id FOR UPDATE;
    IF bal < g.stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
    UPDATE public.wallets SET balance = balance - g.stake, updated_at = now() WHERE user_id = g.player3_id;
    INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (g.player3_id,'game_stake',g.stake,'completed',g.id);
  END IF;

  -- credit admin wallet
  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id, balance) VALUES (admin_user, total_commission)
    ON CONFLICT (admin_id) DO UPDATE SET balance = admin_wallets.balance + EXCLUDED.balance, updated_at = now();
  END IF;

  UPDATE public.games SET commission = total_commission WHERE id = g.id;

  RETURN jsonb_build_object('ok', true, 'commission_total', total_commission, 'pot', (g.stake - commission_each) * pcount);
END;
$function$;

-- 5) Update settle_game to handle player3
CREATE OR REPLACE FUNCTION public.settle_game(_game_id uuid, _winner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  g RECORD;
  commission_each NUMERIC;
  pot NUMERIC;
  pcount int;
BEGIN
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

-- 6) Update join_and_start_game to handle 3P
CREATE OR REPLACE FUNCTION public.join_and_start_game(_game_id uuid, _player2 uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  g RECORD;
  ticket text;
  pcount int;
BEGIN
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  pcount := COALESCE(g.players_count, 2);
  IF g.status = 'in_progress' AND pcount = 3 AND g.player3_id IS NULL THEN
    -- joining as player3
    IF _player2 = g.player1_id OR _player2 = g.player2_id THEN
      RAISE EXCEPTION 'cannot_join_own';
    END IF;
    UPDATE public.games SET player3_id = _player2, updated_at = now() WHERE id = _game_id;
    PERFORM public.start_game_deduct(_game_id);
    RETURN jsonb_build_object('ok', true, 'ticket', g.ticket_number, 'role', 'p3');
  END IF;

  IF g.status <> 'waiting' OR g.player2_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_taken';
  END IF;
  IF g.player1_id = _player2 THEN
    RAISE EXCEPTION 'cannot_join_own';
  END IF;

  ticket := to_char(now(), 'YYYYMMDDHH24MISS');

  IF pcount = 2 THEN
    UPDATE public.games
      SET player2_id = _player2,
          status = 'in_progress',
          current_turn = g.player1_id,
          turn_started_at = now(),
          ticket_number = ticket,
          updated_at = now()
      WHERE id = _game_id;
    PERFORM public.start_game_deduct(_game_id);
    RETURN jsonb_build_object('ok', true, 'ticket', ticket, 'role', 'p2');
  ELSE
    -- 3P: needs another player; mark as in_progress only when 3 are present
    UPDATE public.games
      SET player2_id = _player2,
          ticket_number = ticket,
          updated_at = now()
      WHERE id = _game_id;
    -- still waiting for player3
    RETURN jsonb_build_object('ok', true, 'ticket', ticket, 'role', 'p2', 'awaiting_p3', true);
  END IF;
END;
$function$;

-- 7) Helper RPC: start the 3P game when player3 joins
CREATE OR REPLACE FUNCTION public.join_3p_start(_game_id uuid, _player3 uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  g RECORD;
BEGIN
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF COALESCE(g.players_count,2) <> 3 THEN RAISE EXCEPTION 'not_3p'; END IF;
  IF g.player3_id IS NOT NULL THEN RAISE EXCEPTION 'already_taken'; END IF;
  IF g.player2_id IS NULL THEN RAISE EXCEPTION 'need_player2_first'; END IF;
  IF _player3 = g.player1_id OR _player3 = g.player2_id THEN RAISE EXCEPTION 'cannot_join_own'; END IF;

  UPDATE public.games
    SET player3_id = _player3,
        status = 'in_progress',
        current_turn = g.player1_id,
        turn_started_at = now(),
        updated_at = now()
    WHERE id = _game_id;
  PERFORM public.start_game_deduct(_game_id);
  RETURN jsonb_build_object('ok', true, 'ticket', g.ticket_number);
END;
$function$;