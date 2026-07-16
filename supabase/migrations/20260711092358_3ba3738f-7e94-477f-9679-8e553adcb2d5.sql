CREATE TABLE IF NOT EXISTS public.game_blocks (
  game_type text PRIMARY KEY CHECK (game_type IN ('domino', 'ludo', 'petanque')),
  blocked boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.game_blocks TO authenticated;
GRANT ALL ON public.game_blocks TO service_role;

ALTER TABLE public.game_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read game blocks" ON public.game_blocks;
CREATE POLICY "Authenticated can read game blocks"
ON public.game_blocks
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Admins can manage game blocks" ON public.game_blocks;
CREATE POLICY "Admins can manage game blocks"
ON public.game_blocks
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.game_blocks(game_type, blocked)
VALUES ('domino', false), ('ludo', false), ('petanque', false)
ON CONFLICT (game_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.game_blocked(_game_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT blocked FROM public.game_blocks WHERE game_type = _game_type), false)
$$;
GRANT EXECUTE ON FUNCTION public.game_blocked(text) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_game_block(_admin_id uuid, _pin text, _game_type text, _blocked boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;
  IF _game_type NOT IN ('domino', 'ludo', 'petanque') THEN RAISE EXCEPTION 'game_type_diso'; END IF;

  INSERT INTO public.game_blocks(game_type, blocked, updated_by, updated_at)
  VALUES (_game_type, _blocked, _admin_id, now())
  ON CONFLICT (game_type) DO UPDATE
    SET blocked = EXCLUDED.blocked,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'game_type', _game_type, 'blocked', _blocked);
END $$;
GRANT EXECUTE ON FUNCTION public.admin_set_game_block(uuid, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_block_locked_game()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gt text := CASE TG_TABLE_NAME
    WHEN 'games' THEN 'domino'
    WHEN 'ludo_games' THEN 'ludo'
    WHEN 'petanque_games' THEN 'petanque'
    ELSE NULL
  END;
BEGIN
  IF gt IS NOT NULL AND public.game_blocked(gt) THEN
    RAISE EXCEPTION 'game_blocked' USING HINT = 'Bloqué le jeu: administratif manao maintenance vetivety';
  END IF;

  IF COALESCE(NEW.is_tournament, false) = true THEN RETURN NEW; END IF;
  IF NEW.player1_id IS NOT NULL AND public.tournament_player_locked(NEW.player1_id) THEN
    RAISE EXCEPTION 'tournament_lockout' USING HINT = 'Mpisoratra anarana amin''ny Tornoi — tsy afaka milalao tsotra';
  END IF;
  IF NEW.player2_id IS NOT NULL AND public.tournament_player_locked(NEW.player2_id) THEN
    RAISE EXCEPTION 'tournament_lockout' USING HINT = 'Mpisoratra anarana amin''ny Tornoi — tsy afaka milalao tsotra';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_block_locked_game_p3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gt text := CASE TG_TABLE_NAME
    WHEN 'games' THEN 'domino'
    WHEN 'ludo_games' THEN 'ludo'
    WHEN 'petanque_games' THEN 'petanque'
    ELSE NULL
  END;
BEGIN
  IF gt IS NOT NULL AND public.game_blocked(gt) THEN
    RAISE EXCEPTION 'game_blocked' USING HINT = 'Bloqué le jeu: administratif manao maintenance vetivety';
  END IF;

  IF COALESCE(NEW.is_tournament, false) = true THEN RETURN NEW; END IF;
  IF NEW.player1_id IS NOT NULL AND public.tournament_player_locked(NEW.player1_id) THEN
    RAISE EXCEPTION 'tournament_lockout' USING HINT = 'Mpisoratra anarana amin''ny Tornoi — tsy afaka milalao tsotra';
  END IF;
  IF NEW.player2_id IS NOT NULL AND public.tournament_player_locked(NEW.player2_id) THEN
    RAISE EXCEPTION 'tournament_lockout' USING HINT = 'Mpisoratra anarana amin''ny Tornoi — tsy afaka milalao tsotra';
  END IF;
  IF NEW.player3_id IS NOT NULL AND public.tournament_player_locked(NEW.player3_id) THEN
    RAISE EXCEPTION 'tournament_lockout' USING HINT = 'Mpisoratra anarana amin''ny Tornoi — tsy afaka milalao tsotra';
  END IF;
  RETURN NEW;
END $$;