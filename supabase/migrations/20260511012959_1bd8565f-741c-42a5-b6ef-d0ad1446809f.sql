CREATE OR REPLACE FUNCTION public.admin_reset_commission(_admin_id uuid, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;
  UPDATE public.admin_wallets SET balance = 0, updated_at = now() WHERE admin_id = _admin_id;
  RETURN jsonb_build_object('ok', true);
END $$;