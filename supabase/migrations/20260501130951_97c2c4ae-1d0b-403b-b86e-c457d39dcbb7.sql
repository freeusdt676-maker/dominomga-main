-- Enum karazana lalao bot
DO $$ BEGIN
  CREATE TYPE public.bot_game_kind AS ENUM ('billiard','ludo','poker');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.bot_difficulty AS ENUM ('easy','medium','hard');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.bot_game_status AS ENUM ('in_progress','won','lost','aborted');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.bot_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind public.bot_game_kind NOT NULL,
  difficulty public.bot_difficulty NOT NULL DEFAULT 'medium',
  stake numeric NOT NULL,
  commission numeric NOT NULL DEFAULT 0,
  payout numeric NOT NULL DEFAULT 0,
  status public.bot_game_status NOT NULL DEFAULT 'in_progress',
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

ALTER TABLE public.bot_games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bg_select_own ON public.bot_games;
CREATE POLICY bg_select_own ON public.bot_games FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS bg_insert_own ON public.bot_games;
CREATE POLICY bg_insert_own ON public.bot_games FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS bg_admin_all ON public.bot_games;
CREATE POLICY bg_admin_all ON public.bot_games FOR ALL
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- RPC: maka stake + 10% commission ho admin, mamorona bot_game
CREATE OR REPLACE FUNCTION public.bot_start_stake(_kind public.bot_game_kind, _difficulty public.bot_difficulty, _stake numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  bal numeric;
  commission numeric;
  admin_user uuid;
  new_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _stake <= 0 THEN RAISE EXCEPTION 'invalid stake'; END IF;

  SELECT balance INTO bal FROM public.wallets WHERE user_id = uid FOR UPDATE;
  IF bal IS NULL OR bal < _stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  commission := round(_stake * 0.10);

  UPDATE public.wallets SET balance = balance - _stake, updated_at = now() WHERE user_id = uid;
  INSERT INTO public.transactions(user_id,type,amount,status) VALUES (uid,'game_stake',_stake,'completed');

  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id, balance) VALUES (admin_user, commission)
    ON CONFLICT (admin_id) DO UPDATE SET balance = admin_wallets.balance + EXCLUDED.balance, updated_at = now();
  END IF;

  INSERT INTO public.bot_games(user_id,kind,difficulty,stake,commission)
    VALUES (uid,_kind,_difficulty,_stake,commission)
    RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok',true,'id',new_id,'commission',commission);
END $$;

-- RPC: famaranana — won = mahazo stake*1.8, lost = tsy mahazo
CREATE OR REPLACE FUNCTION public.bot_settle(_game_id uuid, _won boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  g RECORD;
  payout numeric := 0;
BEGIN
  SELECT * INTO g FROM public.bot_games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  IF g.user_id <> uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF g.status <> 'in_progress' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;

  IF _won THEN
    payout := round(g.stake * 1.8);
    UPDATE public.wallets SET balance = balance + payout, updated_at = now() WHERE user_id = uid;
    INSERT INTO public.transactions(user_id,type,amount,status) VALUES (uid,'game_win',payout,'completed');
    UPDATE public.bot_games SET status='won', payout=payout, finished_at=now() WHERE id=g.id;
  ELSE
    UPDATE public.bot_games SET status='lost', finished_at=now() WHERE id=g.id;
  END IF;

  RETURN jsonb_build_object('ok',true,'payout',payout);
END $$;