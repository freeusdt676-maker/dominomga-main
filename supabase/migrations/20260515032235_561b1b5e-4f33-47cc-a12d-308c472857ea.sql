CREATE OR REPLACE FUNCTION public.admin_cancel_domino_game(_game_id uuid, _admin_id uuid, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g RECORD;
  pids uuid[];
  pid uuid;
  refunded_count integer := 0;
  admin_user uuid;
  refund_amount numeric;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _pin <> '2583' THEN
    RAISE EXCEPTION 'pin_diso';
  END IF;

  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found';
  END IF;
  IF g.status IN ('finished', 'cancelled') THEN
    RAISE EXCEPTION 'already_closed';
  END IF;

  pids := ARRAY[g.player1_id, g.player2_id, g.player3_id]::uuid[];
  refund_amount := COALESCE(g.stake, 0);

  FOREACH pid IN ARRAY pids LOOP
    CONTINUE WHEN pid IS NULL;
    IF COALESCE(g.commission, 0) > 0 THEN
      UPDATE public.wallets
      SET balance = balance + refund_amount,
          updated_at = now()
      WHERE user_id = pid;

      INSERT INTO public.transactions(user_id, type, amount, status, game_id, admin_note, processed_at, processed_by)
      VALUES (pid, 'deposit', refund_amount, 'approved', g.id, 'Annulation admin - remboursement mise', now(), _admin_id);

      refunded_count := refunded_count + 1;
    END IF;
  END LOOP;

  IF COALESCE(g.commission, 0) > 0 THEN
    SELECT user_id INTO admin_user
    FROM public.user_roles
    WHERE role = 'admin'
    ORDER BY created_at ASC
    LIMIT 1;

    IF admin_user IS NOT NULL THEN
      UPDATE public.admin_wallets
      SET balance = GREATEST(0, balance - COALESCE(g.commission, 0)),
          updated_at = now()
      WHERE admin_id = admin_user;
    END IF;
  END IF;

  UPDATE public.games
  SET status = 'cancelled',
      winner_id = NULL,
      finished_at = now(),
      updated_at = now(),
      reveal_until = NULL,
      endgame_votes = NULL
  WHERE id = g.id;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', 'domino',
    'ticket_number', g.ticket_number,
    'refunded_players', refunded_count,
    'commission_reverted', COALESCE(g.commission, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_ludo_game(_game_id uuid, _admin_id uuid, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g RECORD;
  pids uuid[];
  pid uuid;
  refunded_count integer := 0;
  admin_user uuid;
  refund_amount numeric;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _pin <> '2583' THEN
    RAISE EXCEPTION 'pin_diso';
  END IF;

  SELECT * INTO g FROM public.ludo_games WHERE id = _game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found';
  END IF;
  IF g.status IN ('finished', 'cancelled') THEN
    RAISE EXCEPTION 'already_closed';
  END IF;

  pids := ARRAY[g.player1_id, g.player2_id, g.player3_id, g.player4_id]::uuid[];
  refund_amount := COALESCE(g.stake, 0);

  FOREACH pid IN ARRAY pids LOOP
    CONTINUE WHEN pid IS NULL;
    IF COALESCE(g.commission, 0) > 0 THEN
      UPDATE public.wallets
      SET balance = balance + refund_amount,
          updated_at = now()
      WHERE user_id = pid;

      INSERT INTO public.transactions(user_id, type, amount, status, admin_note, processed_at, processed_by)
      VALUES (pid, 'deposit', refund_amount, 'approved', 'Annulation admin - remboursement mise Ludo', now(), _admin_id);

      refunded_count := refunded_count + 1;
    END IF;
  END LOOP;

  IF COALESCE(g.commission, 0) > 0 THEN
    SELECT user_id INTO admin_user
    FROM public.user_roles
    WHERE role = 'admin'
    ORDER BY created_at ASC
    LIMIT 1;

    IF admin_user IS NOT NULL THEN
      UPDATE public.admin_wallets
      SET balance = GREATEST(0, balance - COALESCE(g.commission, 0)),
          updated_at = now()
      WHERE admin_id = admin_user;
    END IF;
  END IF;

  UPDATE public.ludo_games
  SET status = 'cancelled',
      winner_id = NULL,
      finished_at = now(),
      updated_at = now()
  WHERE id = g.id;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', 'ludo',
    'ticket_number', g.ticket_number,
    'refunded_players', refunded_count,
    'commission_reverted', COALESCE(g.commission, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_game_by_ticket(_ticket text, _admin_id uuid, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g_id uuid;
  lg_id uuid;
BEGIN
  IF _ticket IS NULL OR length(trim(_ticket)) = 0 THEN
    RAISE EXCEPTION 'ticket_required';
  END IF;

  SELECT id INTO g_id
  FROM public.games
  WHERE ticket_number = trim(_ticket)
  ORDER BY created_at DESC
  LIMIT 1;

  IF g_id IS NOT NULL THEN
    RETURN public.admin_cancel_domino_game(g_id, _admin_id, _pin);
  END IF;

  SELECT id INTO lg_id
  FROM public.ludo_games
  WHERE ticket_number = trim(_ticket)
  ORDER BY created_at DESC
  LIMIT 1;

  IF lg_id IS NOT NULL THEN
    RETURN public.admin_cancel_ludo_game(lg_id, _admin_id, _pin);
  END IF;

  RAISE EXCEPTION 'ticket_not_found';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_all_active_games(_admin_id uuid, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g RECORD;
  domino_count integer := 0;
  ludo_count integer := 0;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _pin <> '2583' THEN
    RAISE EXCEPTION 'pin_diso';
  END IF;

  FOR g IN
    SELECT id FROM public.games WHERE status IN ('waiting', 'in_progress', 'blocked')
  LOOP
    PERFORM public.admin_cancel_domino_game(g.id, _admin_id, _pin);
    domino_count := domino_count + 1;
  END LOOP;

  FOR g IN
    SELECT id FROM public.ludo_games WHERE status IN ('waiting', 'in_progress', 'blocked')
  LOOP
    PERFORM public.admin_cancel_ludo_game(g.id, _admin_id, _pin);
    ludo_count := ludo_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'domino_cancelled', domino_count,
    'ludo_cancelled', ludo_count,
    'total_cancelled', domino_count + ludo_count
  );
END;
$$;