-- Ampiana column passes ho an'ny games (manisa pass mifanesy)
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS passes INTEGER NOT NULL DEFAULT 0;

-- Esorina ny table bot_games (tsy ampiasaina intsony)
DROP TABLE IF EXISTS public.bot_games CASCADE;

-- Esorina ny RPC bot_start_stake / bot_settle raha mbola ao
DROP FUNCTION IF EXISTS public.bot_start_stake(text, text, numeric);
DROP FUNCTION IF EXISTS public.bot_settle(uuid, boolean);