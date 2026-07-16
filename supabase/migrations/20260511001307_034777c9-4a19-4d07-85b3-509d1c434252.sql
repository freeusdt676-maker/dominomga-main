
-- 1) lobby_messages
CREATE TABLE IF NOT EXISTS public.lobby_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lobby_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lobby_select_auth" ON public.lobby_messages;
CREATE POLICY "lobby_select_auth" ON public.lobby_messages
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "lobby_insert_own" ON public.lobby_messages;
CREATE POLICY "lobby_insert_own" ON public.lobby_messages
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id);
DROP POLICY IF EXISTS "lobby_delete_own" ON public.lobby_messages;
CREATE POLICY "lobby_delete_own" ON public.lobby_messages
  FOR DELETE TO authenticated USING (auth.uid() = sender_id);
DROP POLICY IF EXISTS "lobby_admin_all" ON public.lobby_messages;
CREATE POLICY "lobby_admin_all" ON public.lobby_messages
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lobby_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- 2) Player can delete own chat messages
DROP POLICY IF EXISTS "chat_delete_own" ON public.chat_messages;
CREATE POLICY "chat_delete_own" ON public.chat_messages
  FOR DELETE TO authenticated USING (auth.uid() = sender_id);

-- 3) Admin RPCs
CREATE OR REPLACE FUNCTION public.admin_total_player_balance(_admin_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(w.balance), 0)
  FROM public.wallets w
  WHERE public.has_role(_admin_id, 'admin')
    AND w.user_id NOT IN (SELECT user_id FROM public.user_roles WHERE role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_transaction(_tx_id uuid, _admin_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.transactions WHERE id = _tx_id;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_game(_game_id uuid, _admin_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.game_moves WHERE game_id = _game_id;
  DELETE FROM public.transactions WHERE game_id = _game_id;
  DELETE FROM public.challenges WHERE game_id = _game_id;
  DELETE FROM public.chat_messages WHERE game_id = _game_id;
  DELETE FROM public.games WHERE id = _game_id;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_reset_user_balance(_user_id uuid, _admin_id uuid, _pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;
  UPDATE public.wallets SET balance = 0, updated_at = now() WHERE user_id = _user_id;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_chat_message(_msg_id uuid, _admin_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.chat_messages WHERE id = _msg_id;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_lobby_message(_msg_id uuid, _admin_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.lobby_messages WHERE id = _msg_id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 4) Famafana ireo compte rehetra afa-tsy ny administratora
DO $$
DECLARE
  keep_ids uuid[];
BEGIN
  SELECT ARRAY(
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM public.user_roles WHERE role = 'admin'
      UNION
      SELECT user_id FROM public.profiles WHERE phone = '0345023006'
    ) s
  ) INTO keep_ids;

  DELETE FROM public.lobby_messages WHERE sender_id <> ALL(keep_ids);
  DELETE FROM public.game_moves WHERE player_id <> ALL(keep_ids);
  DELETE FROM public.transactions WHERE user_id <> ALL(keep_ids);
  DELETE FROM public.chat_messages WHERE
    (sender_id IS NOT NULL AND sender_id <> ALL(keep_ids))
    OR (recipient_id IS NOT NULL AND recipient_id <> ALL(keep_ids));
  DELETE FROM public.matchmaking_queue WHERE user_id <> ALL(keep_ids);
  DELETE FROM public.challenges WHERE from_user <> ALL(keep_ids) OR to_user <> ALL(keep_ids);
  DELETE FROM public.games WHERE
    player1_id <> ALL(keep_ids)
    OR (player2_id IS NOT NULL AND player2_id <> ALL(keep_ids))
    OR (player3_id IS NOT NULL AND player3_id <> ALL(keep_ids));
  DELETE FROM public.ludo_games WHERE
    player1_id <> ALL(keep_ids)
    OR (player2_id IS NOT NULL AND player2_id <> ALL(keep_ids))
    OR (player3_id IS NOT NULL AND player3_id <> ALL(keep_ids))
    OR (player4_id IS NOT NULL AND player4_id <> ALL(keep_ids));
  DELETE FROM public.password_reset_requests WHERE user_id <> ALL(keep_ids);
  DELETE FROM public.wallets WHERE user_id <> ALL(keep_ids);
  DELETE FROM public.user_roles WHERE user_id <> ALL(keep_ids);
  DELETE FROM public.profiles WHERE user_id <> ALL(keep_ids);
  DELETE FROM auth.users WHERE id <> ALL(keep_ids);
END $$;
