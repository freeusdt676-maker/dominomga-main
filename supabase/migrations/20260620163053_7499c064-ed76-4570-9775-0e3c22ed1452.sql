CREATE OR REPLACE FUNCTION public.trg_push_tx_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  label text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','rejected','completed') THEN
    label := CASE NEW.type::text
               WHEN 'deposit' THEN 'Dépôt'
               WHEN 'withdrawal' THEN 'Retrait'
               ELSE NEW.type::text
             END;
    IF NEW.status IN ('approved','completed') THEN
      PERFORM public.notify_push('user', NEW.user_id,
        '✅ '||label||' nankatoavina',
        label||' '||NEW.amount||' Ar nankatoavina',
        '/wallet', 'tx-'||NEW.id::text);
    ELSE
      PERFORM public.notify_push('user', NEW.user_id,
        '❌ '||label||' nolavina',
        label||' '||NEW.amount||' Ar tsy nankatoavina',
        '/wallet', 'tx-'||NEW.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;