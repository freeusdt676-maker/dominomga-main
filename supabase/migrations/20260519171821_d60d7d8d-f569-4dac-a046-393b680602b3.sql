
-- ============= 1) Unique phone (1 phone = 1 compte) =============
-- Suppress potential dupes by keeping earliest
WITH dupes AS (
  SELECT user_id, phone,
    ROW_NUMBER() OVER (PARTITION BY phone ORDER BY created_at ASC) AS rn
  FROM public.profiles WHERE phone IS NOT NULL AND phone <> ''
)
UPDATE public.profiles p
SET account_status = 'blocked'
FROM dupes d
WHERE p.user_id = d.user_id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_unique
  ON public.profiles (phone) WHERE phone IS NOT NULL AND phone <> '';

-- ============= 2) Audit log =============
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON public.audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON public.audit_log(action, created_at DESC);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_admin_all ON public.audit_log FOR ALL
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY audit_select_own ON public.audit_log FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.log_audit(_action text, _meta jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.audit_log(user_id, action, meta) VALUES (auth.uid(), _action, COALESCE(_meta,'{}'::jsonb));
END $$;

-- ============= 3) Fraud alerts =============
CREATE TABLE IF NOT EXISTS public.fraud_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  severity text NOT NULL DEFAULT 'medium',
  kind text NOT NULL,
  message text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fraud_alerts_unresolved_idx ON public.fraud_alerts(created_at DESC) WHERE resolved = false;
ALTER TABLE public.fraud_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY fraud_admin_all ON public.fraud_alerts FOR ALL
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============= 4) Rate limits =============
CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id uuid NOT NULL,
  action text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, action)
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY rl_admin_all ON public.rate_limits FOR ALL
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.check_rate_limit(_action text, _max integer, _window_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r RECORD; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  SELECT * INTO r FROM public.rate_limits WHERE user_id=uid AND action=_action FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.rate_limits(user_id,action,window_start,count) VALUES (uid,_action,now(),1);
    RETURN true;
  END IF;
  IF r.window_start < now() - make_interval(secs=>_window_seconds) THEN
    UPDATE public.rate_limits SET window_start=now(), count=1 WHERE user_id=uid AND action=_action;
    RETURN true;
  END IF;
  IF r.count >= _max THEN RETURN false; END IF;
  UPDATE public.rate_limits SET count=count+1 WHERE user_id=uid AND action=_action;
  RETURN true;
END $$;

-- ============= 5) Responsible gaming =============
CREATE TABLE IF NOT EXISTS public.responsible_gaming (
  user_id uuid PRIMARY KEY,
  daily_loss_limit numeric,
  daily_stake_limit numeric,
  self_excluded_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.responsible_gaming ENABLE ROW LEVEL SECURITY;
CREATE POLICY rg_own ON public.responsible_gaming FOR ALL
  USING (auth.uid()=user_id OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid()=user_id OR public.has_role(auth.uid(),'admin'));

-- Trigger: tsy afaka mise raha self-excluded na tafahoatra ny fetra
CREATE OR REPLACE FUNCTION public.before_stake_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rg RECORD; today_stake numeric; today_loss numeric;
BEGIN
  IF NEW.type <> 'game_stake' THEN RETURN NEW; END IF;
  SELECT * INTO rg FROM public.responsible_gaming WHERE user_id=NEW.user_id;
  IF rg.self_excluded_until IS NOT NULL AND rg.self_excluded_until > now() THEN
    RAISE EXCEPTION 'self_excluded_until_%', to_char(rg.self_excluded_until,'YYYY-MM-DD HH24:MI');
  END IF;
  IF rg.daily_stake_limit IS NOT NULL THEN
    SELECT COALESCE(SUM(amount),0) INTO today_stake FROM public.transactions
      WHERE user_id=NEW.user_id AND type='game_stake' AND created_at::date = now()::date;
    IF today_stake + NEW.amount > rg.daily_stake_limit THEN
      RAISE EXCEPTION 'daily_stake_limit_reached_%', rg.daily_stake_limit::text;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_before_stake_check ON public.transactions;
CREATE TRIGGER trg_before_stake_check BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.before_stake_check();

-- ============= 6) Fraud detection trigger =============
CREATE OR REPLACE FUNCTION public.after_tx_fraud_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recent_count int; last_tx timestamptz;
BEGIN
  -- Retrait lehibe
  IF NEW.type='withdrawal' AND NEW.amount >= 500000 THEN
    INSERT INTO public.fraud_alerts(user_id,severity,kind,message,meta)
    VALUES (NEW.user_id,'high','large_withdrawal',
      'Retrait lehibe: '||NEW.amount::text||' Ar',
      jsonb_build_object('tx_id',NEW.id,'amount',NEW.amount));
  END IF;
  -- Transaction faingana be loatra (>5 amin'ny 60s)
  SELECT COUNT(*) INTO recent_count FROM public.transactions
    WHERE user_id=NEW.user_id AND created_at > now() - interval '60 seconds';
  IF recent_count > 5 THEN
    INSERT INTO public.fraud_alerts(user_id,severity,kind,message,meta)
    VALUES (NEW.user_id,'high','rapid_transactions',
      'Transaction maro be loatra ('||recent_count||') amin''ny 60s',
      jsonb_build_object('count',recent_count));
  END IF;
  -- Mise/retrait amin'ny phone hafa (différent profil.phone)
  IF NEW.type='withdrawal' AND NEW.mvola_phone IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=NEW.user_id AND phone=NEW.mvola_phone) THEN
      INSERT INTO public.fraud_alerts(user_id,severity,kind,message,meta)
      VALUES (NEW.user_id,'medium','withdraw_other_phone',
        'Retrait amin''ny numéro hafa: '||NEW.mvola_phone,
        jsonb_build_object('tx_id',NEW.id,'mvola_phone',NEW.mvola_phone));
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_after_tx_fraud_check ON public.transactions;
CREATE TRIGGER trg_after_tx_fraud_check AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.after_tx_fraud_check();

-- ============= 7) Login attempts + brute-force guard =============
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  success boolean NOT NULL,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_phone_idx ON public.login_attempts(phone, created_at DESC);
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY la_admin_all ON public.login_attempts FOR ALL
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.record_login_attempt(_phone text, _success boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE fails int;
BEGIN
  INSERT INTO public.login_attempts(phone,success) VALUES (_phone,_success);
  IF _success THEN RETURN jsonb_build_object('locked',false); END IF;
  SELECT COUNT(*) INTO fails FROM public.login_attempts
    WHERE phone=_phone AND success=false AND created_at > now() - interval '15 minutes';
  RETURN jsonb_build_object('locked', fails >= 5, 'fails', fails);
END $$;

CREATE OR REPLACE FUNCTION public.check_login_lockout(_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE fails int;
BEGIN
  SELECT COUNT(*) INTO fails FROM public.login_attempts
    WHERE phone=_phone AND success=false AND created_at > now() - interval '15 minutes';
  RETURN jsonb_build_object('locked', fails >= 5, 'fails', fails);
END $$;

-- ============= 8) Admin: resolve alert =============
CREATE OR REPLACE FUNCTION public.admin_resolve_fraud_alert(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.fraud_alerts SET resolved=true, resolved_at=now(), resolved_by=auth.uid() WHERE id=_id;
  RETURN jsonb_build_object('ok',true);
END $$;

-- ============= 9) Admin: detect multi-account (same selfie/IP/device) =============
CREATE OR REPLACE FUNCTION public.admin_list_phone_duplicates()
RETURNS TABLE(phone text, count bigint, user_ids uuid[])
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT phone, COUNT(*) AS count, array_agg(user_id) AS user_ids
  FROM public.profiles
  WHERE public.has_role(auth.uid(),'admin') AND phone IS NOT NULL AND phone <> ''
  GROUP BY phone HAVING COUNT(*) > 1
$$;
