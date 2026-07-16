-- 1) Foanana ny self-exclusion rehetra
UPDATE public.responsible_gaming SET self_excluded_until = NULL WHERE self_excluded_until IS NOT NULL;

-- 2) Block all non-admin accounts
CREATE OR REPLACE FUNCTION public.admin_block_all_accounts(_admin_id uuid, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;

  UPDATE public.profiles
  SET account_status = 'blocked'
  WHERE user_id NOT IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
    AND account_status <> 'blocked';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'blocked', n);
END $function$;

-- 3) Unblock all non-admin accounts
CREATE OR REPLACE FUNCTION public.admin_unblock_all_accounts(_admin_id uuid, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;

  UPDATE public.profiles
  SET account_status = 'active'
  WHERE user_id NOT IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
    AND account_status = 'blocked';
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Confirm email so they can sign in
  UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, now())
  WHERE id IN (SELECT user_id FROM public.profiles WHERE account_status = 'active');

  -- Esorina koa ny self-exclusion mba tsy hisakana
  UPDATE public.responsible_gaming SET self_excluded_until = NULL WHERE self_excluded_until IS NOT NULL;

  RETURN jsonb_build_object('ok', true, 'unblocked', n);
END $function$;