-- Approve a transaction (deposit or withdrawal) as admin
CREATE OR REPLACE FUNCTION public.admin_approve_tx(_tx_id uuid, _admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
  cur numeric;
  newbal numeric;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO t FROM public.transactions WHERE id = _tx_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tx_not_found_or_not_pending';
  END IF;

  SELECT balance INTO cur FROM public.wallets WHERE user_id = t.user_id FOR UPDATE;
  IF cur IS NULL THEN
    INSERT INTO public.wallets(user_id, balance) VALUES (t.user_id, 0);
    cur := 0;
  END IF;

  IF t.type = 'deposit' THEN
    newbal := cur + t.amount;
  ELSIF t.type = 'withdrawal' THEN
    IF cur < t.amount THEN
      RAISE EXCEPTION 'insufficient_balance';
    END IF;
    newbal := cur - t.amount;
  ELSE
    RAISE EXCEPTION 'invalid_tx_type';
  END IF;

  UPDATE public.wallets SET balance = newbal, updated_at = now() WHERE user_id = t.user_id;
  UPDATE public.transactions
    SET status = 'approved', processed_by = _admin_id, processed_at = now()
    WHERE id = t.id;

  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (_admin_id, t.user_id,
    CASE WHEN t.type = 'deposit' THEN 'Dépôt ' ELSE 'Retrait ' END || t.amount::text || ' Ar nankatoavina ✓',
    false);

  RETURN jsonb_build_object('ok', true);
END $$;

-- Reject a transaction as admin
CREATE OR REPLACE FUNCTION public.admin_reject_tx(_tx_id uuid, _admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO t FROM public.transactions WHERE id = _tx_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tx_not_found_or_not_pending';
  END IF;

  UPDATE public.transactions
    SET status = 'rejected', processed_by = _admin_id, processed_at = now()
    WHERE id = t.id;

  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (_admin_id, t.user_id,
    CASE WHEN t.type = 'deposit' THEN 'Dépôt ' ELSE 'Retrait ' END || t.amount::text || ' Ar tsy nekena. Mba hamarino ny mombamomba ny transaction ataonao.',
    false);

  RETURN jsonb_build_object('ok', true);
END $$;

-- Send a broadcast message as admin
CREATE OR REPLACE FUNCTION public.admin_send_broadcast(_admin_id uuid, _content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _content IS NULL OR length(trim(_content)) = 0 THEN
    RAISE EXCEPTION 'empty_content';
  END IF;
  INSERT INTO public.chat_messages(sender_id, content, is_admin_broadcast)
  VALUES (_admin_id, trim(_content), true);
  RETURN jsonb_build_object('ok', true);
END $$;

-- Resolve admin id from access code (used when admin enters via code, no Supabase session)
CREATE OR REPLACE FUNCTION public.get_admin_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM public.user_roles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1;
$$;