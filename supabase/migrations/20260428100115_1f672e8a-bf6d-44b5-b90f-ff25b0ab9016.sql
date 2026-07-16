-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'player');
CREATE TYPE public.transaction_type AS ENUM ('deposit', 'withdrawal', 'game_win', 'game_loss', 'game_stake', 'refund');
CREATE TYPE public.transaction_status AS ENUM ('pending', 'approved', 'rejected', 'completed');
CREATE TYPE public.game_status AS ENUM ('waiting', 'in_progress', 'finished', 'cancelled', 'blocked');
CREATE TYPE public.gender AS ENUM ('male', 'female', 'other');

-- ============ UTILITY: updated_at trigger ============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  mvola_name TEXT NOT NULL,           -- anarana ao amin'ny MVOLA = anarana profil
  phone TEXT NOT NULL UNIQUE,         -- num Telma
  birth_date DATE,
  gender public.gender,
  avatar_url TEXT,
  last_seen TIMESTAMPTZ DEFAULT now(),
  is_online BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ USER ROLES (séparé) ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'player',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- ============ WALLETS ============
CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  pin_hash TEXT,                       -- code PIN (hash) ilaina amin'ny retrait
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_wallets_updated BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ TRANSACTIONS ============
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.transaction_type NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status public.transaction_status NOT NULL DEFAULT 'pending',
  mvola_reference TEXT,                -- réf SMS MVOLA fournie par le joueur
  mvola_phone TEXT,                    -- numéro source/destination
  game_id UUID,                        -- raha mifandray amin'ny lalao
  admin_note TEXT,
  processed_by UUID REFERENCES auth.users(id),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_transactions_updated BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_transactions_user ON public.transactions(user_id);
CREATE INDEX idx_transactions_status ON public.transactions(status);

-- ============ GAMES ============
CREATE TABLE public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player1_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player2_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stake NUMERIC(14,2) NOT NULL CHECK (stake >= 1000),
  status public.game_status NOT NULL DEFAULT 'waiting',
  current_turn UUID REFERENCES auth.users(id),
  winner_id UUID REFERENCES auth.users(id),
  board_state JSONB DEFAULT '[]'::jsonb,    -- pi\u00e8ces sur la table
  player1_hand JSONB DEFAULT '[]'::jsonb,
  player2_hand JSONB DEFAULT '[]'::jsonb,
  boneyard JSONB DEFAULT '[]'::jsonb,       -- pioche
  turn_started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_games_updated BEFORE UPDATE ON public.games FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_games_status ON public.games(status);
CREATE INDEX idx_games_players ON public.games(player1_id, player2_id);

-- ============ GAME MOVES ============
CREATE TABLE public.game_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES auth.users(id),
  piece JSONB,                              -- ex: {"a":6,"b":3}
  side TEXT,                                -- 'left' | 'right' | 'draw' | 'pass'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.game_moves ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_moves_game ON public.game_moves(game_id);

-- ============ CHAT (in-game + admin) ============
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES auth.users(id),       -- NULL = système
  recipient_id UUID REFERENCES auth.users(id),    -- pour chat admin direct
  content TEXT NOT NULL,
  is_admin_broadcast BOOLEAN DEFAULT false,       -- alefan'ny admin, tsy azo valiana
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_chat_game ON public.chat_messages(game_id);
CREATE INDEX idx_chat_recipient ON public.chat_messages(recipient_id);

-- ============ PASSWORD RESET REQUESTS ============
CREATE TABLE public.password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT,
  selfie_url TEXT,                          -- sary alefan'ny mpilalao raha mangataka admin
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  temp_password TEXT,                       -- 0000 default rehefa approuv\u00e9
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

-- ============ RLS POLICIES ============

-- profiles: izaho mahita ny ahy + admin mahita rehetra; lisitra membres hita amin'ny rehetra (anarana fotsiny)
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "profiles_select_public" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- user_roles: izaho mahita ny ahy; admin manao rehetra
CREATE POLICY "roles_select_own" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "roles_admin_all" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- wallets: izaho mahita ny ahy fotsiny (tsy mahita pin_hash satria server-side ihany no manodina)
CREATE POLICY "wallets_select_own" ON public.wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "wallets_admin_all" ON public.wallets FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
-- Tsy misy update direct avy amin'ny client; via edge function ihany

-- transactions: izaho mahita ny ahy + admin manao rehetra; ny mpilalao afaka manao demande deposit/withdrawal pending
CREATE POLICY "tx_select_own" ON public.transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "tx_admin_all" ON public.transactions FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "tx_insert_own_request" ON public.transactions FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
  AND type IN ('deposit', 'withdrawal')
);

-- games: ny mpilalao roa amin'ny lalao + admin
CREATE POLICY "games_select_participant" ON public.games FOR SELECT USING (
  auth.uid() = player1_id OR auth.uid() = player2_id OR status = 'waiting' OR public.has_role(auth.uid(), 'admin')
);
CREATE POLICY "games_admin_all" ON public.games FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
-- Création/update via edge function (service role)

-- game_moves: ny mpilalao amin'ny lalao + admin
CREATE POLICY "moves_select_participant" ON public.game_moves FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.games g WHERE g.id = game_id AND (g.player1_id = auth.uid() OR g.player2_id = auth.uid()))
  OR public.has_role(auth.uid(), 'admin')
);
CREATE POLICY "moves_admin_all" ON public.game_moves FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- chat: in-game (mpilalao roa); admin (sender/recipient); broadcast (rehetra mahita)
CREATE POLICY "chat_select" ON public.chat_messages FOR SELECT USING (
  is_admin_broadcast = true
  OR auth.uid() = sender_id
  OR auth.uid() = recipient_id
  OR (game_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.games g WHERE g.id = game_id AND (g.player1_id = auth.uid() OR g.player2_id = auth.uid())))
  OR public.has_role(auth.uid(), 'admin')
);
CREATE POLICY "chat_insert_player" ON public.chat_messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id
  AND is_admin_broadcast = false
);
CREATE POLICY "chat_admin_all" ON public.chat_messages FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- password reset requests
CREATE POLICY "prr_insert_own" ON public.password_reset_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "prr_select_own" ON public.password_reset_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "prr_admin_all" ON public.password_reset_requests FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ TRIGGER: auto-create profile + wallet + role on signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, mvola_name, phone, birth_date, gender)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'mvola_name', 'Joueur'),
    COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone, ''),
    NULLIF(NEW.raw_user_meta_data->>'birth_date','')::date,
    NULLIF(NEW.raw_user_meta_data->>'gender','')::public.gender
  );
  INSERT INTO public.wallets (user_id, balance) VALUES (NEW.id, 0);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'player');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ REALTIME ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_moves;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
ALTER TABLE public.games REPLICA IDENTITY FULL;
ALTER TABLE public.game_moves REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;