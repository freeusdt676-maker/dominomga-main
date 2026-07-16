
-- 1) Reschedule schedule to SUNDAY (week_start + 6 days at 14h MG)
CREATE OR REPLACE FUNCTION public.tournament_ensure_current(_game_type text DEFAULT 'domino')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws timestamptz; rid uuid; st public.tournament_status; guard int := 0; gt public.tournament_game_type;
BEGIN
  gt := _game_type::public.tournament_game_type;
  ws := public.tournament_week_start_for(now());
  LOOP
    guard := guard + 1;
    EXIT WHEN guard > 8;
    SELECT id, status INTO rid, st FROM public.tournaments WHERE week_start = ws AND game_type = gt;
    IF rid IS NULL THEN
      INSERT INTO public.tournaments(week_start, game_type, reg_close, qf_at, sf_at, third_at, final_at, reset_at)
      VALUES (ws, gt,
        ws + interval '6 days' + interval '13 hours 45 minutes', -- Sun 13:45 MG
        ws + interval '6 days' + interval '14 hours',           -- Sun 14:00 MG
        ws + interval '6 days' + interval '14 hours 40 minutes',
        ws + interval '6 days' + interval '15 hours 20 minutes',
        ws + interval '6 days' + interval '16 hours',
        ws + interval '7 days')                                 -- Mon 00:00 MG next week
      RETURNING id INTO rid;
      RETURN rid;
    END IF;
    IF st IN ('cancelled','finished') AND now() >= (SELECT reset_at FROM public.tournaments WHERE id = rid) THEN
      ws := ws + interval '7 days';
      CONTINUE;
    END IF;
    RETURN rid;
  END LOOP;
  RETURN rid;
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_ensure_current(text) TO authenticated, anon;

-- 2) Reschedule current 'registration' rows for this week to SUNDAY 14/06/2026
UPDATE public.tournaments
SET reg_close = week_start + interval '6 days' + interval '13 hours 45 minutes',
    qf_at    = week_start + interval '6 days' + interval '14 hours',
    sf_at    = week_start + interval '6 days' + interval '14 hours 40 minutes',
    third_at = week_start + interval '6 days' + interval '15 hours 20 minutes',
    final_at = week_start + interval '6 days' + interval '16 hours',
    reset_at = week_start + interval '7 days',
    updated_at = now()
WHERE status = 'registration';

-- 3) Lockout helper: registered & (qf within 30 min OR tournament running)
CREATE OR REPLACE FUNCTION public.tournament_player_locked(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tournament_registrations r
    JOIN public.tournaments t ON t.id = r.tournament_id
    WHERE r.user_id = _uid
      AND r.cancelled_at IS NULL
      AND (
        (t.status = 'registration' AND now() >= t.qf_at - interval '30 minutes' AND now() < t.reset_at)
        OR (t.status = 'running')
      )
  );
$$;
GRANT EXECUTE ON FUNCTION public.tournament_player_locked(uuid) TO authenticated, anon;

-- 4) Trigger functions
CREATE OR REPLACE FUNCTION public.trg_block_locked_game()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
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
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION public.trg_block_locked_challenge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.tournament_player_locked(NEW.from_user) OR public.tournament_player_locked(NEW.to_user) THEN
    RAISE EXCEPTION 'tournament_lockout' USING HINT = 'Mpisoratra anarana amin''ny Tornoi — tsy afaka milalao tsotra';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_block_locked_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.tournament_player_locked(NEW.user_id) THEN
    RAISE EXCEPTION 'tournament_lockout' USING HINT = 'Mpisoratra anarana amin''ny Tornoi — tsy afaka milalao tsotra';
  END IF;
  RETURN NEW;
END $$;

-- 5) Attach triggers (BEFORE INSERT)
DROP TRIGGER IF EXISTS trg_block_lockout_games ON public.games;
CREATE TRIGGER trg_block_lockout_games BEFORE INSERT ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_locked_game_p3();

DROP TRIGGER IF EXISTS trg_block_lockout_ludo ON public.ludo_games;
CREATE TRIGGER trg_block_lockout_ludo BEFORE INSERT ON public.ludo_games
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_locked_game();

DROP TRIGGER IF EXISTS trg_block_lockout_petanque ON public.petanque_games;
CREATE TRIGGER trg_block_lockout_petanque BEFORE INSERT ON public.petanque_games
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_locked_game();

DROP TRIGGER IF EXISTS trg_block_lockout_challenges ON public.challenges;
CREATE TRIGGER trg_block_lockout_challenges BEFORE INSERT ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_locked_challenge();

DROP TRIGGER IF EXISTS trg_block_lockout_queue ON public.matchmaking_queue;
CREATE TRIGGER trg_block_lockout_queue BEFORE INSERT ON public.matchmaking_queue
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_locked_queue();
