CREATE OR REPLACE FUNCTION public.approve_user_with_message(_user_id uuid, _admin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.profiles
    SET account_status = 'active', approved_at = now(), approved_by = _admin_id
    WHERE user_id = _user_id;

  UPDATE auth.users
    SET email_confirmed_at = COALESCE(email_confirmed_at, now())
    WHERE id = _user_id;

  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (_admin_id, _user_id, 'Vita soa amantsara ny fisoratanao anarana tato amin''ny Domino MG. Hafatra avy amin''ny ADMINISTRATIF. Misaotra Tompoko.', false);

  RETURN jsonb_build_object('ok', true);
END $function$;

UPDATE auth.users u
   SET email_confirmed_at = COALESCE(u.email_confirmed_at, now())
  FROM public.profiles p
 WHERE p.user_id = u.id
   AND p.account_status = 'active'
   AND u.email_confirmed_at IS NULL;
