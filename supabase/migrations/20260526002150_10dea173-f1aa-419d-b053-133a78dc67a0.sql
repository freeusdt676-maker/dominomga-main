
-- ============ DELETE GAME RPCs (Ludo + Pétanque) ============
CREATE OR REPLACE FUNCTION public.admin_delete_ludo_game(_game_id uuid, _admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.ludo_games WHERE id = _game_id;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_petanque_game(_game_id uuid, _admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.petanque_games WHERE id = _game_id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ============ GAME AUDIT TABLE ============
CREATE TABLE IF NOT EXISTS public.game_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_kind text NOT NULL,
  game_id uuid NOT NULL,
  ticket_number text,
  action text NOT NULL,
  stake numeric,
  commission numeric,
  pot numeric,
  winner_id uuid,
  players_count smallint,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.game_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_audit_admin_all ON public.game_audit;
CREATE POLICY game_audit_admin_all ON public.game_audit
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS game_audit_game_idx ON public.game_audit(game_id);
CREATE INDEX IF NOT EXISTS game_audit_ticket_idx ON public.game_audit(ticket_number);

-- ============ INTEGRITY TRIGGER: commission must equal stake*0.10*players ============
CREATE OR REPLACE FUNCTION public.enforce_domino_settle_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE expected_commission numeric; pc int;
BEGIN
  IF NEW.status = 'finished' AND NEW.winner_id IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'finished') THEN
    pc := COALESCE(NEW.players_count, 2);
    expected_commission := round(NEW.stake * 0.10) * pc;
    IF COALESCE(NEW.commission,0) <> expected_commission THEN
      RAISE EXCEPTION 'integrity_violation: commission diso (nahazo % nefa tokony %)', NEW.commission, expected_commission;
    END IF;
    IF NEW.winner_id NOT IN (NEW.player1_id, NEW.player2_id, COALESCE(NEW.player3_id, NEW.player1_id)) THEN
      RAISE EXCEPTION 'integrity_violation: winner tsy mpilalao';
    END IF;
    INSERT INTO public.game_audit(game_kind, game_id, ticket_number, action, stake, commission, pot, winner_id, players_count, meta)
    VALUES ('domino', NEW.id, NEW.ticket_number, 'settle', NEW.stake, NEW.commission,
            (NEW.stake - round(NEW.stake*0.10)) * pc, NEW.winner_id, pc,
            jsonb_build_object('score_p1', NEW.score_p1, 'score_p2', NEW.score_p2, 'score_p3', NEW.score_p3));
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_ludo_settle_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE expected_commission numeric; pc int;
BEGIN
  IF NEW.status = 'finished' AND NEW.winner_id IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'finished') THEN
    pc := COALESCE(NEW.players_count, 2);
    expected_commission := round(NEW.stake * 0.10) * pc;
    IF COALESCE(NEW.commission,0) <> expected_commission THEN
      RAISE EXCEPTION 'integrity_violation: ludo commission diso (% vs %)', NEW.commission, expected_commission;
    END IF;
    IF NEW.winner_id NOT IN (NEW.player1_id, COALESCE(NEW.player2_id, NEW.player1_id),
                              COALESCE(NEW.player3_id, NEW.player1_id), COALESCE(NEW.player4_id, NEW.player1_id)) THEN
      RAISE EXCEPTION 'integrity_violation: ludo winner tsy mpilalao';
    END IF;
    INSERT INTO public.game_audit(game_kind, game_id, ticket_number, action, stake, commission, pot, winner_id, players_count)
    VALUES ('ludo', NEW.id, NEW.ticket_number, 'settle', NEW.stake, NEW.commission,
            (NEW.stake - round(NEW.stake*0.10)) * pc, NEW.winner_id, pc);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_petanque_settle_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE expected_commission numeric;
BEGIN
  IF NEW.status = 'finished' AND NEW.winner_id IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'finished') THEN
    expected_commission := round(NEW.stake * 0.10) * 2;
    IF COALESCE(NEW.commission,0) <> expected_commission THEN
      RAISE EXCEPTION 'integrity_violation: petanque commission diso (% vs %)', NEW.commission, expected_commission;
    END IF;
    IF NEW.winner_id NOT IN (NEW.player1_id, COALESCE(NEW.player2_id, NEW.player1_id)) THEN
      RAISE EXCEPTION 'integrity_violation: petanque winner tsy mpilalao';
    END IF;
    INSERT INTO public.game_audit(game_kind, game_id, ticket_number, action, stake, commission, pot, winner_id, players_count, meta)
    VALUES ('petanque', NEW.id, NEW.ticket_number, 'settle', NEW.stake, NEW.commission,
            (NEW.stake - round(NEW.stake*0.10)) * 2, NEW.winner_id, 2,
            jsonb_build_object('score_p1', NEW.score_p1, 'score_p2', NEW.score_p2));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_domino_settle ON public.games;
CREATE TRIGGER trg_enforce_domino_settle
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.enforce_domino_settle_integrity();

DROP TRIGGER IF EXISTS trg_enforce_ludo_settle ON public.ludo_games;
CREATE TRIGGER trg_enforce_ludo_settle
  BEFORE UPDATE ON public.ludo_games
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ludo_settle_integrity();

DROP TRIGGER IF EXISTS trg_enforce_petanque_settle ON public.petanque_games;
CREATE TRIGGER trg_enforce_petanque_settle
  BEFORE UPDATE ON public.petanque_games
  FOR EACH ROW EXECUTE FUNCTION public.enforce_petanque_settle_integrity();

-- ============ VERIFY HELPER ============
CREATE OR REPLACE FUNCTION public.verify_game_settlement(_kind text, _game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; pc int; expected_commission numeric; expected_pot numeric; paid numeric;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _kind = 'domino' THEN
    SELECT stake, commission, players_count, winner_id, status INTO r FROM public.games WHERE id=_game_id;
    pc := COALESCE(r.players_count,2);
  ELSIF _kind = 'ludo' THEN
    SELECT stake, commission, players_count, winner_id, status INTO r FROM public.ludo_games WHERE id=_game_id;
    pc := COALESCE(r.players_count,2);
  ELSE
    SELECT stake, commission, 2 AS players_count, winner_id, status INTO r FROM public.petanque_games WHERE id=_game_id;
    pc := 2;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  expected_commission := round(r.stake * 0.10) * pc;
  expected_pot := (r.stake - round(r.stake * 0.10)) * pc;
  SELECT COALESCE(SUM(amount),0) INTO paid FROM public.transactions
    WHERE user_id=r.winner_id AND type='game_win' AND game_id=_game_id;
  RETURN jsonb_build_object(
    'kind', _kind, 'status', r.status,
    'stake', r.stake, 'players', pc,
    'expected_commission', expected_commission, 'actual_commission', r.commission,
    'commission_ok', COALESCE(r.commission,0) = expected_commission,
    'expected_pot', expected_pot, 'pot_paid', paid,
    'pot_ok', paid = expected_pot OR r.status <> 'finished'
  );
END $$;
