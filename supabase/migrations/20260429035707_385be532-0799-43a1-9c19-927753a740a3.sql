
DELETE FROM public.transactions WHERE user_id = '536f9587-18a8-4729-8540-b9ef08b8dc7c';
DELETE FROM public.password_reset_requests WHERE user_id = '536f9587-18a8-4729-8540-b9ef08b8dc7c';
DELETE FROM public.chat_messages WHERE sender_id = '536f9587-18a8-4729-8540-b9ef08b8dc7c' OR recipient_id = '536f9587-18a8-4729-8540-b9ef08b8dc7c';
DELETE FROM public.matchmaking_queue WHERE user_id = '536f9587-18a8-4729-8540-b9ef08b8dc7c';
DELETE FROM public.wallets WHERE user_id = '536f9587-18a8-4729-8540-b9ef08b8dc7c';
DELETE FROM public.user_roles WHERE user_id = '536f9587-18a8-4729-8540-b9ef08b8dc7c';
DELETE FROM public.profiles WHERE user_id = '536f9587-18a8-4729-8540-b9ef08b8dc7c';
DELETE FROM auth.users WHERE id = '536f9587-18a8-4729-8540-b9ef08b8dc7c';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='password_reset_requests_user_id_fkey') THEN
    ALTER TABLE public.password_reset_requests
      ADD CONSTRAINT password_reset_requests_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wallets_user_id_fkey') THEN
    ALTER TABLE public.wallets
      ADD CONSTRAINT wallets_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.approve_user_with_message(_user_id uuid, _admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.profiles
    SET account_status = 'active', approved_at = now(), approved_by = _admin_id
    WHERE user_id = _user_id;
  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (_admin_id, _user_id, 'Vita soa amantsara ny fisoratanao anarana tato amin''ny Domino MG. Hafatra avy amin''ny ADMINISTRATIF. Misaotra Tompoko.', false);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.reject_user_with_message(_user_id uuid, _admin_id uuid, _message text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.profiles SET account_status = 'blocked' WHERE user_id = _user_id;
  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (_admin_id, _user_id, _message, false);
  RETURN jsonb_build_object('ok', true);
END $$;
