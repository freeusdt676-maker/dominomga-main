
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS ticket_number text,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS games_ticket_number_uniq ON public.games(ticket_number) WHERE ticket_number IS NOT NULL;

-- Backfill old finished games
UPDATE public.games SET ticket_number = to_char(created_at, 'YYYYMMDDHH24MISS') WHERE ticket_number IS NULL;
UPDATE public.games SET finished_at = updated_at WHERE finished_at IS NULL AND status IN ('finished','blocked','cancelled');

-- Join + start a waiting game atomically: assigns player2, deducts stakes, generates ticket
CREATE OR REPLACE FUNCTION public.join_and_start_game(_game_id uuid, _player2 uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g RECORD;
  ticket text;
BEGIN
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status <> 'waiting' OR g.player2_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_taken';
  END IF;
  IF g.player1_id = _player2 THEN
    RAISE EXCEPTION 'cannot_join_own';
  END IF;

  ticket := to_char(now(), 'YYYYMMDDHH24MISS');

  UPDATE public.games
    SET player2_id = _player2,
        status = 'in_progress',
        current_turn = g.player1_id,
        turn_started_at = now(),
        ticket_number = ticket,
        updated_at = now()
    WHERE id = _game_id;

  PERFORM public.start_game_deduct(_game_id);
  RETURN jsonb_build_object('ok', true, 'ticket', ticket);
END $$;

-- Update settle_game to set finished_at
CREATE OR REPLACE FUNCTION public.settle_game(_game_id uuid, _winner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g RECORD;
  commission_each NUMERIC;
  pot NUMERIC;
BEGIN
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'Game not found'; END IF;
  IF g.status = 'finished' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF _winner <> g.player1_id AND _winner <> g.player2_id THEN
    RAISE EXCEPTION 'Invalid winner';
  END IF;
  commission_each := round(g.stake * 0.10);
  pot := (g.stake - commission_each) * 2;
  UPDATE public.wallets SET balance = balance + pot, updated_at = now() WHERE user_id = _winner;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id)
    VALUES (_winner,'game_win',pot,'completed',g.id);
  UPDATE public.games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now() WHERE id=g.id;
  RETURN jsonb_build_object('ok', true, 'pot', pot);
END;
$function$;

-- Admin unblock
CREATE OR REPLACE FUNCTION public.admin_unblock_user(_user_id uuid, _admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.profiles SET account_status='active' WHERE user_id=_user_id;
  UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, now()) WHERE id = _user_id;
  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (_admin_id, _user_id, 'Voavaha ny compte-nao. Afaka miditra indray ianao.', false);
  RETURN jsonb_build_object('ok', true);
END $$;

-- Allow admin (via has_role) to read all profiles for history (already covered) and games (already)
