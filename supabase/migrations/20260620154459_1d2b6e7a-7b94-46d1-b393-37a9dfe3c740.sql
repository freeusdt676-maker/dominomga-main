
-- Enable pg_net for HTTP from the database
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Helper: POST to send-push edge function (fire & forget)
CREATE OR REPLACE FUNCTION public.notify_push(
  _audience text,
  _user_id uuid,
  _title text,
  _body text,
  _url text DEFAULT '/',
  _tag text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'audience', _audience,
    'user_id', _user_id,
    'title', _title,
    'body', _body,
    'url', _url,
    'tag', _tag
  );
  PERFORM extensions.http_post(
    url := 'https://taucobvazpwzzhmapekh.supabase.co/functions/v1/send-push',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := payload
  );
EXCEPTION WHEN OTHERS THEN
  -- never block the parent DML on a push failure
  RAISE NOTICE 'notify_push failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_push(text, uuid, text, text, text, text) FROM PUBLIC;

-- Trigger: new pending transaction → notify admins
CREATE OR REPLACE FUNCTION public.trg_push_tx_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uname text;
BEGIN
  IF NEW.status = 'pending' THEN
    SELECT mvola_name INTO uname FROM public.profiles WHERE user_id = NEW.user_id;
    IF NEW.type = 'deposit' THEN
      PERFORM public.notify_push('admins', NULL,
        '💰 Dépôt vaovao',
        COALESCE(uname,'Mpilalao')||' • '||NEW.amount||' Ar mila valide',
        '/admin', 'tx-'||NEW.id::text);
    ELSIF NEW.type = 'withdrawal' THEN
      PERFORM public.notify_push('admins', NULL,
        '💸 Retrait vaovao',
        COALESCE(uname,'Mpilalao')||' • '||NEW.amount||' Ar mila valide',
        '/admin', 'tx-'||NEW.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_tx_insert ON public.transactions;
CREATE TRIGGER push_tx_insert
AFTER INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_push_tx_insert();

-- Trigger: transaction status changed → notify the user
CREATE OR REPLACE FUNCTION public.trg_push_tx_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  label text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','rejected','completed') THEN
    label := CASE NEW.type WHEN 'deposit' THEN 'Dépôt' WHEN 'withdrawal' THEN 'Retrait' ELSE NEW.type END;
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
$$;

DROP TRIGGER IF EXISTS push_tx_update ON public.transactions;
CREATE TRIGGER push_tx_update
AFTER UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_push_tx_update();

-- Trigger: new password reset request → admins
CREATE OR REPLACE FUNCTION public.trg_push_pwd_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.notify_push('admins', NULL,
    '🔐 Demande mot de passe',
    'Misy demande mot de passe oublié vaovao',
    '/admin', 'pwd-'||NEW.id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_pwd_reset ON public.password_reset_requests;
CREATE TRIGGER push_pwd_reset
AFTER INSERT ON public.password_reset_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_push_pwd_reset();

-- Trigger: new profile change request → admins
CREATE OR REPLACE FUNCTION public.trg_push_profile_req()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.notify_push('admins', NULL,
    '👤 Fanovana profil',
    'Misy demande fanovana profil mila validation',
    '/admin', 'prof-'||NEW.id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_profile_req ON public.profile_change_requests;
CREATE TRIGGER push_profile_req
AFTER INSERT ON public.profile_change_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_push_profile_req();

-- Trigger: new game created → admins
CREATE OR REPLACE FUNCTION public.trg_push_game()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  kind text := TG_ARGV[0];
BEGIN
  PERFORM public.notify_push('admins', NULL,
    '🎲 Lalao vaovao',
    kind||' • mise '||COALESCE(NEW.bet_amount::text, '?')||' Ar',
    '/admin', kind||'-'||NEW.id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_game_domino ON public.games;
CREATE TRIGGER push_game_domino
AFTER INSERT ON public.games
FOR EACH ROW EXECUTE FUNCTION public.trg_push_game('Domino');

DROP TRIGGER IF EXISTS push_game_ludo ON public.ludo_games;
CREATE TRIGGER push_game_ludo
AFTER INSERT ON public.ludo_games
FOR EACH ROW EXECUTE FUNCTION public.trg_push_game('Ludo');

DROP TRIGGER IF EXISTS push_game_petanque ON public.petanque_games;
CREATE TRIGGER push_game_petanque
AFTER INSERT ON public.petanque_games
FOR EACH ROW EXECUTE FUNCTION public.trg_push_game('Pétanque');
