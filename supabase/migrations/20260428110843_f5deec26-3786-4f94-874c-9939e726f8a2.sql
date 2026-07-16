
-- Admin wallet (singular, but support multiple admins)
CREATE TABLE IF NOT EXISTS public.admin_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL UNIQUE,
  balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_wallets_select_self" ON public.admin_wallets FOR SELECT
USING (auth.uid() = admin_id AND public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "admin_wallets_admin_all" ON public.admin_wallets FOR ALL
USING (public.has_role(auth.uid(),'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

-- Add commission_total column on games (track per-game commission)
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS commission NUMERIC NOT NULL DEFAULT 0;

-- Challenges
CREATE TABLE IF NOT EXISTS public.challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user UUID NOT NULL,
  to_user UUID NOT NULL,
  stake NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|declined|cancelled|expired
  game_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 seconds')
);
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ch_select_party" ON public.challenges FOR SELECT
USING (auth.uid() = from_user OR auth.uid() = to_user OR public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "ch_insert_own" ON public.challenges FOR INSERT
WITH CHECK (auth.uid() = from_user);
CREATE POLICY "ch_update_party" ON public.challenges FOR UPDATE
USING (auth.uid() = from_user OR auth.uid() = to_user OR public.has_role(auth.uid(),'admin'::app_role));

-- Quick match queue
CREATE TABLE IF NOT EXISTS public.matchmaking_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  stake NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mq_select_all_auth" ON public.matchmaking_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY "mq_insert_own" ON public.matchmaking_queue FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "mq_delete_own" ON public.matchmaking_queue FOR DELETE USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'::app_role));

-- Function: deduct stake from both players, take 10% commission, credit admin wallet
CREATE OR REPLACE FUNCTION public.start_game_deduct(_game_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g RECORD;
  commission_each NUMERIC;
  net_each NUMERIC;
  admin_user UUID;
  bal1 NUMERIC; bal2 NUMERIC;
BEGIN
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'Game not found'; END IF;
  IF g.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Game not in_progress';
  END IF;
  IF g.commission > 0 THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  IF g.player2_id IS NULL THEN RAISE EXCEPTION 'No opponent'; END IF;

  commission_each := round(g.stake * 0.10);
  net_each := g.stake; -- the player puts up full stake; commission is part of that stake going to admin

  SELECT balance INTO bal1 FROM public.wallets WHERE user_id = g.player1_id FOR UPDATE;
  SELECT balance INTO bal2 FROM public.wallets WHERE user_id = g.player2_id FOR UPDATE;
  IF bal1 < g.stake OR bal2 < g.stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  UPDATE public.wallets SET balance = balance - g.stake, updated_at = now() WHERE user_id = g.player1_id;
  UPDATE public.wallets SET balance = balance - g.stake, updated_at = now() WHERE user_id = g.player2_id;

  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES
    (g.player1_id,'game_stake',g.stake,'completed',g.id),
    (g.player2_id,'game_stake',g.stake,'completed',g.id);

  -- credit admin wallet (first admin)
  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id, balance) VALUES (admin_user, commission_each*2)
    ON CONFLICT (admin_id) DO UPDATE SET balance = admin_wallets.balance + EXCLUDED.balance, updated_at = now();
  END IF;

  UPDATE public.games SET commission = commission_each*2 WHERE id = g.id;

  RETURN jsonb_build_object('ok', true, 'commission_total', commission_each*2, 'pot', (g.stake - commission_each)*2);
END;
$$;

-- Function: settle game (winner gets pot = (stake - commission_each) * 2, i.e. 1.8 * stake)
CREATE OR REPLACE FUNCTION public.settle_game(_game_id UUID, _winner UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g RECORD;
  commission_each NUMERIC;
  pot NUMERIC;
BEGIN
  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'Game not found'; END IF;
  IF g.status = 'finished' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF _winner <> g.player1_id AND _winner <> g.player2_id THEN
    RAISE EXCEPTION 'Invalid winner';
  END IF;

  commission_each := round(g.stake * 0.10);
  pot := (g.stake - commission_each) * 2;

  UPDATE public.wallets SET balance = balance + pot, updated_at = now() WHERE user_id = _winner;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id)
    VALUES (_winner,'game_win',pot,'completed',g.id);

  UPDATE public.games SET status='finished', winner_id=_winner, updated_at=now() WHERE id=g.id;

  RETURN jsonb_build_object('ok', true, 'pot', pot);
END;
$$;

CREATE INDEX IF NOT EXISTS idx_profiles_last_seen ON public.profiles(last_seen);
CREATE INDEX IF NOT EXISTS idx_games_status_stake ON public.games(status, stake);
CREATE INDEX IF NOT EXISTS idx_challenges_to_status ON public.challenges(to_user, status);
