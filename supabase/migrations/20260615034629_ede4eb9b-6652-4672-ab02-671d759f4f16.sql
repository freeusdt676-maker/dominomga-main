
CREATE OR REPLACE FUNCTION public.request_password_recovery(_phone text, _name text, _gender text, _games text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile RECORD;
  v_cooldown_until TIMESTAMPTZ;
  v_id UUID;
  v_existing UUID;
  v_gender_in TEXT;
  v_gender_profile TEXT;
BEGIN
  -- 5min cooldown after a wrong attempt
  SELECT MAX(created_at) INTO v_cooldown_until
  FROM public.password_reset_requests
  WHERE phone = _phone
    AND status = 'rejected_auto'
    AND created_at > now() - INTERVAL '5 minutes';

  IF v_cooldown_until IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cooldown',
      'retry_at', (v_cooldown_until + INTERVAL '5 minutes'));
  END IF;

  SELECT p.user_id, p.mvola_name, p.gender::text AS gender
  INTO v_profile
  FROM public.profiles p
  WHERE p.phone = _phone
  LIMIT 1;

  IF v_profile.user_id IS NULL THEN
    INSERT INTO public.password_reset_requests(user_id, phone, status, message, answers)
    VALUES (NULL, _phone, 'rejected_auto', 'phone_not_found',
            jsonb_build_object('phone', _phone, 'name', _name, 'gender', _gender));
    RETURN jsonb_build_object('ok', false, 'error', 'wrong');
  END IF;

  -- Normalize gender: accept male/female/other OR lahy/vavy/hafa (any case)
  v_gender_in := lower(trim(coalesce(_gender,'')));
  v_gender_in := CASE
    WHEN v_gender_in IN ('lahy','male','m','homme','lehilahy') THEN 'male'
    WHEN v_gender_in IN ('vavy','female','f','femme','vehivavy') THEN 'female'
    WHEN v_gender_in IN ('hafa','other','autre') THEN 'other'
    ELSE v_gender_in
  END;
  v_gender_profile := lower(trim(coalesce(v_profile.gender,'')));

  IF lower(trim(coalesce(v_profile.mvola_name,''))) <> lower(trim(coalesce(_name,'')))
     OR v_gender_profile <> v_gender_in THEN
    INSERT INTO public.password_reset_requests(user_id, phone, status, message, answers)
    VALUES (v_profile.user_id, _phone, 'rejected_auto', 'answers_wrong',
            jsonb_build_object('phone', _phone, 'name', _name, 'gender', _gender));
    RETURN jsonb_build_object('ok', false, 'error', 'wrong');
  END IF;

  SELECT id INTO v_existing
  FROM public.password_reset_requests
  WHERE phone = _phone AND status = 'pending'
  ORDER BY created_at DESC LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'request_id', v_existing);
  END IF;

  INSERT INTO public.password_reset_requests(user_id, phone, status, answers)
  VALUES (v_profile.user_id, _phone, 'pending',
          jsonb_build_object('phone', _phone, 'name', _name, 'gender', _gender))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'request_id', v_id);
END;
$function$;
