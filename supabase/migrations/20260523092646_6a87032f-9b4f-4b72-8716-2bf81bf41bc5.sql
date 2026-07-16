CREATE OR REPLACE FUNCTION public.admin_block_user_with_message(
  _user_id uuid,
  _admin_id uuid,
  _message text
)
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
  SET account_status = 'blocked'
  WHERE user_id = _user_id;

  IF coalesce(trim(_message), '') <> '' THEN
    INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
    VALUES (_admin_id, _user_id, _message, false);
  END IF;

  RETURN jsonb_build_object('ok', true);
END
$function$;