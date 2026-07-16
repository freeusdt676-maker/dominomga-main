CREATE OR REPLACE FUNCTION public.accept_challenge_start_game(_challenge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.challenges%ROWTYPE;
  new_game_id uuid;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO c
  FROM public.challenges
  WHERE id = _challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'challenge_not_found';
  END IF;

  IF c.to_user <> uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF c.status <> 'pending' THEN
    RAISE EXCEPTION 'challenge_not_pending';
  END IF;

  IF c.expires_at <= now() THEN
    RAISE EXCEPTION 'challenge_expired';
  END IF;

  INSERT INTO public.games (
    player1_id,
    player2_id,
    stake,
    status,
    current_turn,
    turn_started_at
  ) VALUES (
    c.from_user,
    uid,
    c.stake,
    'in_progress',
    c.from_user,
    now()
  ) RETURNING id INTO new_game_id;

  UPDATE public.challenges
  SET status = 'accepted',
      game_id = new_game_id
  WHERE id = c.id;

  PERFORM public.start_game_deduct(new_game_id);

  RETURN jsonb_build_object('ok', true, 'game_id', new_game_id);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_challenge_start_game(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_challenge_start_game(uuid) TO authenticated;