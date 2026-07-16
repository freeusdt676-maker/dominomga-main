
-- 1) Add new columns to password_reset_requests for the new flow
ALTER TABLE public.password_reset_requests
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS answers JSONB,
  ADD COLUMN IF NOT EXISTS reveal_password TEXT,
  ADD COLUMN IF NOT EXISTS reveal_pin TEXT,
  ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_prr_phone_status ON public.password_reset_requests(phone, status);
CREATE INDEX IF NOT EXISTS idx_prr_status_created ON public.password_reset_requests(status, created_at DESC);

-- 2) RPC: request_password_recovery
CREATE OR REPLACE FUNCTION public.request_password_recovery(
  _phone TEXT,
  _name TEXT,
  _gender TEXT,
  _games TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_recent_fail INT;
  v_cooldown_until TIMESTAMPTZ;
  v_norm_games TEXT;
  v_id UUID;
  v_existing UUID;
BEGIN
  -- 5min cooldown check on failed attempts
  SELECT MAX(created_at) INTO v_cooldown_until
  FROM public.password_reset_requests
  WHERE phone = _phone
    AND status = 'rejected_auto'
    AND created_at > now() - INTERVAL '5 minutes';

  IF v_cooldown_until IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cooldown',
      'retry_at', (v_cooldown_until + INTERVAL '5 minutes'));
  END IF;

  -- Find profile by phone
  SELECT p.user_id, p.mvola_name, p.gender::text AS gender
  INTO v_profile
  FROM public.profiles p
  WHERE p.phone = _phone
  LIMIT 1;

  IF v_profile.user_id IS NULL THEN
    INSERT INTO public.password_reset_requests(user_id, phone, status, message, answers)
    VALUES (NULL, _phone, 'rejected_auto', 'phone_not_found',
            jsonb_build_object('phone', _phone, 'name', _name, 'gender', _gender, 'games', _games));
    RETURN jsonb_build_object('ok', false, 'error', 'wrong');
  END IF;

  -- Normalize games answer
  v_norm_games := lower(regexp_replace(coalesce(_games,''), '[^a-zA-Z]+', ' ', 'g'));

  IF lower(trim(coalesce(v_profile.mvola_name,''))) <> lower(trim(coalesce(_name,'')))
     OR lower(trim(coalesce(v_profile.gender,''))) <> lower(trim(coalesce(_gender,'')))
     OR NOT (v_norm_games LIKE '%domino%' AND v_norm_games LIKE '%ludo%'
             AND (v_norm_games LIKE '%petanque%' OR v_norm_games LIKE '%pétanque%')) THEN
    INSERT INTO public.password_reset_requests(user_id, phone, status, message, answers)
    VALUES (v_profile.user_id, _phone, 'rejected_auto', 'answers_wrong',
            jsonb_build_object('phone', _phone, 'name', _name, 'gender', _gender, 'games', _games));
    RETURN jsonb_build_object('ok', false, 'error', 'wrong');
  END IF;

  -- If user has a pending one already, return it
  SELECT id INTO v_existing
  FROM public.password_reset_requests
  WHERE phone = _phone AND status = 'pending'
  ORDER BY created_at DESC LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'request_id', v_existing);
  END IF;

  INSERT INTO public.password_reset_requests(user_id, phone, status, answers)
  VALUES (v_profile.user_id, _phone, 'pending',
          jsonb_build_object('phone', _phone, 'name', _name, 'gender', _gender, 'games', _games))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'request_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_password_recovery(TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;

-- 3) RPC: get_recovery_status — polled by user
CREATE OR REPLACE FUNCTION public.get_recovery_status(_request_id UUID, _phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM public.password_reset_requests
   WHERE id = _request_id AND phone = _phone;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','expired');
  END IF;

  IF r.status = 'pending' THEN
    RETURN jsonb_build_object('status','pending');
  END IF;

  IF r.status = 'rejected' OR r.status = 'rejected_auto' THEN
    RETURN jsonb_build_object('status','rejected', 'note', r.admin_note);
  END IF;

  IF r.status = 'approved' THEN
    -- First reveal -> set timer
    IF r.revealed_at IS NULL THEN
      UPDATE public.password_reset_requests
         SET revealed_at = now(), expires_at = now() + INTERVAL '60 seconds'
       WHERE id = r.id
       RETURNING revealed_at, expires_at INTO r.revealed_at, r.expires_at;
    END IF;
    -- Expired -> delete and report
    IF r.expires_at IS NOT NULL AND now() > r.expires_at THEN
      DELETE FROM public.password_reset_requests WHERE id = r.id;
      RETURN jsonb_build_object('status','expired');
    END IF;
    RETURN jsonb_build_object(
      'status','approved',
      'password', r.reveal_password,
      'pin', r.reveal_pin,
      'expires_at', r.expires_at
    );
  END IF;

  RETURN jsonb_build_object('status','expired');
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_recovery_status(UUID, TEXT) TO anon, authenticated;

-- 4) Admin RPCs
CREATE OR REPLACE FUNCTION public.admin_list_recovery_requests()
RETURNS TABLE(
  id UUID, user_id UUID, phone TEXT, status TEXT,
  answers JSONB, mvola_name TEXT, password_plain TEXT, pin_plain TEXT,
  created_at TIMESTAMPTZ, processed_at TIMESTAMPTZ, admin_note TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT r.id, r.user_id, r.phone, r.status, r.answers,
         p.mvola_name, p.password_plain, p.pin_plain,
         r.created_at, r.processed_at, r.admin_note
  FROM public.password_reset_requests r
  LEFT JOIN public.profiles p ON p.user_id = r.user_id
  ORDER BY r.created_at DESC
  LIMIT 200;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_recovery_requests() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_decide_recovery(_request_id UUID, _approve BOOLEAN, _note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_pwd TEXT;
  v_pin TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO r FROM public.password_reset_requests WHERE id = _request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error','not_found'); END IF;

  IF _approve THEN
    SELECT password_plain, pin_plain INTO v_pwd, v_pin
    FROM public.profiles WHERE user_id = r.user_id;
    UPDATE public.password_reset_requests
       SET status = 'approved',
           reveal_password = v_pwd,
           reveal_pin = v_pin,
           processed_at = now(),
           admin_note = _note
     WHERE id = _request_id;
  ELSE
    UPDATE public.password_reset_requests
       SET status = 'rejected',
           processed_at = now(),
           admin_note = _note
     WHERE id = _request_id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_decide_recovery(UUID, BOOLEAN, TEXT) TO authenticated;

-- 5) Realtime + grants on the table for admin client reads
GRANT SELECT, UPDATE, DELETE ON public.password_reset_requests TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.password_reset_requests;
