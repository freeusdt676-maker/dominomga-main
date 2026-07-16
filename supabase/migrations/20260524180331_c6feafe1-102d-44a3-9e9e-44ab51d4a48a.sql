CREATE OR REPLACE FUNCTION public.admin_delete_transaction(_tx_id uuid, _admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE t RECORD;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO t FROM public.transactions WHERE id = _tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tx_not_found'; END IF;

  -- Mba tsy hisy fihetsika diso amin'ny wallet: tsy azo fafàna ny transaction
  -- efa nampihena/nampitombo solde. Ny "pending" ihany no azo esorina.
  IF t.status <> 'pending' THEN
    RAISE EXCEPTION 'cannot_delete_completed_tx';
  END IF;

  DELETE FROM public.transactions WHERE id = _tx_id;
  RETURN jsonb_build_object('ok', true);
END $function$;