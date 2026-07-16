
-- RPC: admin clears a user's history (games, messages, transactions)
-- Wallet & admin_wallets untouched. Pending transactions preserved.
CREATE OR REPLACE FUNCTION public.admin_clear_user_history(_user_id uuid, _admin_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  is_admin boolean;
  deleted_games int := 0;
  deleted_ludo int := 0;
  deleted_pet int := 0;
  deleted_msgs int := 0;
  deleted_lobby int := 0;
  deleted_tx int := 0;
  deleted_moves int := 0;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT public.has_role(caller, 'admin') INTO is_admin;
  IF NOT is_admin THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF _admin_pin IS DISTINCT FROM '2583' THEN
    RAISE EXCEPTION 'PIN diso';
  END IF;
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  -- Game moves (cascade-friendly; tied to games)
  DELETE FROM public.game_moves gm
  USING public.games g
  WHERE gm.game_id = g.id
    AND g.status IN ('finished','cancelled')
    AND (g.player1_id = _user_id OR g.player2_id = _user_id);
  GET DIAGNOSTICS deleted_moves = ROW_COUNT;

  -- Domino games (finished/cancelled only)
  DELETE FROM public.games
  WHERE status IN ('finished','cancelled')
    AND (player1_id = _user_id OR player2_id = _user_id);
  GET DIAGNOSTICS deleted_games = ROW_COUNT;

  -- Ludo
  DELETE FROM public.ludo_games
  WHERE status IN ('finished','cancelled')
    AND (
      player1_id = _user_id OR player2_id = _user_id
      OR player3_id = _user_id OR player4_id = _user_id
    );
  GET DIAGNOSTICS deleted_ludo = ROW_COUNT;

  -- Petanque
  DELETE FROM public.petanque_games
  WHERE status IN ('finished','cancelled')
    AND (player1_id = _user_id OR player2_id = _user_id);
  GET DIAGNOSTICS deleted_pet = ROW_COUNT;

  -- Chat messages from this user
  DELETE FROM public.chat_messages WHERE user_id = _user_id;
  GET DIAGNOSTICS deleted_msgs = ROW_COUNT;

  -- Lobby messages from this user
  DELETE FROM public.lobby_messages WHERE user_id = _user_id;
  GET DIAGNOSTICS deleted_lobby = ROW_COUNT;

  -- Transaction history: keep pending (handled separately), delete the rest
  DELETE FROM public.transactions
  WHERE user_id = _user_id
    AND status IN ('approved','rejected','completed');
  GET DIAGNOSTICS deleted_tx = ROW_COUNT;

  PERFORM public.log_audit('admin_clear_user_history', jsonb_build_object(
    'target_user', _user_id,
    'games', deleted_games,
    'ludo', deleted_ludo,
    'petanque', deleted_pet,
    'moves', deleted_moves,
    'chat_messages', deleted_msgs,
    'lobby_messages', deleted_lobby,
    'transactions', deleted_tx
  ));

  RETURN jsonb_build_object(
    'games', deleted_games,
    'ludo', deleted_ludo,
    'petanque', deleted_pet,
    'moves', deleted_moves,
    'chat_messages', deleted_msgs,
    'lobby_messages', deleted_lobby,
    'transactions', deleted_tx
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_clear_user_history(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_user_history(uuid, text) TO authenticated;


-- Push subscriptions table (Web Push / VAPID)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own push subs"
ON public.push_subscriptions
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins read all push subs"
ON public.push_subscriptions
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_admin_idx ON public.push_subscriptions(is_admin) WHERE is_admin = true;
