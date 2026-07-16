
-- 1) ENUM types
DO $$ BEGIN
  CREATE TYPE public.tournament_status AS ENUM ('registration','running','finished','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tournament_round AS ENUM ('qf','sf','third','final');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) tournaments table
CREATE TABLE IF NOT EXISTS public.tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start timestamptz NOT NULL UNIQUE,
  reg_close timestamptz NOT NULL,
  qf_at timestamptz NOT NULL,
  sf_at timestamptz NOT NULL,
  third_at timestamptz NOT NULL,
  final_at timestamptz NOT NULL,
  reset_at timestamptz NOT NULL,
  status public.tournament_status NOT NULL DEFAULT 'registration',
  winner_id uuid,
  runner_up_id uuid,
  total_collected numeric NOT NULL DEFAULT 0,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournaments TO authenticated;
GRANT SELECT ON public.tournaments TO anon;
GRANT ALL ON public.tournaments TO service_role;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tournaments readable by all" ON public.tournaments;
CREATE POLICY "Tournaments readable by all" ON public.tournaments FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admin manage tournaments" ON public.tournaments;
CREATE POLICY "Admin manage tournaments" ON public.tournaments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 3) registrations
CREATE TABLE IF NOT EXISTS public.tournament_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  nom text NOT NULL,
  tel text NOT NULL,
  id_card text NOT NULL,
  paid_amount numeric NOT NULL DEFAULT 5000,
  group_letter text NOT NULL,
  slot smallint NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  UNIQUE (tournament_id, user_id),
  UNIQUE (tournament_id, group_letter, slot)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_registrations TO authenticated;
GRANT ALL ON public.tournament_registrations TO service_role;
ALTER TABLE public.tournament_registrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Regs visible" ON public.tournament_registrations;
CREATE POLICY "Regs visible" ON public.tournament_registrations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin manage regs" ON public.tournament_registrations;
CREATE POLICY "Admin manage regs" ON public.tournament_registrations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 4) matches
CREATE TABLE IF NOT EXISTS public.tournament_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round public.tournament_round NOT NULL,
  match_index smallint NOT NULL,
  player1_id uuid,
  player2_id uuid,
  winner_id uuid,
  game_id uuid,
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, round, match_index)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_matches TO authenticated;
GRANT ALL ON public.tournament_matches TO service_role;
ALTER TABLE public.tournament_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Matches visible" ON public.tournament_matches;
CREATE POLICY "Matches visible" ON public.tournament_matches FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin manage matches" ON public.tournament_matches;
CREATE POLICY "Admin manage matches" ON public.tournament_matches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 5) Mark games as tournament
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS is_tournament boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tournament_match_id uuid REFERENCES public.tournament_matches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_games_tournament_match ON public.games(tournament_match_id) WHERE tournament_match_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tourn_match_tournament ON public.tournament_matches(tournament_id, round);
CREATE INDEX IF NOT EXISTS idx_tourn_regs_tournament ON public.tournament_registrations(tournament_id) WHERE cancelled_at IS NULL;

-- 6) updated_at trigger
DROP TRIGGER IF EXISTS trg_tournaments_updated ON public.tournaments;
CREATE TRIGGER trg_tournaments_updated BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7) Helpers: compute the start of the current MG (UTC+3) week (Monday 00:00 MG -> UTC)
CREATE OR REPLACE FUNCTION public.tournament_week_start_for(_at timestamptz)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  mg_naive timestamp;
  monday_mg timestamp;
  dow int;
BEGIN
  mg_naive := (_at + interval '3 hours')::timestamp;
  dow := EXTRACT(ISODOW FROM mg_naive)::int;  -- Monday=1..Sunday=7
  monday_mg := date_trunc('day', mg_naive) - make_interval(days => dow - 1);
  RETURN (monday_mg - interval '3 hours')::timestamptz;
END $$;

-- 8) Ensure current week tournament exists
CREATE OR REPLACE FUNCTION public.tournament_ensure_current()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ws timestamptz;
  rid uuid;
BEGIN
  ws := public.tournament_week_start_for(now());
  SELECT id INTO rid FROM public.tournaments WHERE week_start = ws;
  IF rid IS NOT NULL THEN RETURN rid; END IF;

  INSERT INTO public.tournaments(week_start, reg_close, qf_at, sf_at, third_at, final_at, reset_at)
  VALUES (
    ws,
    ws + interval '5 days',                          -- Sat 00:00 MG
    ws + interval '5 days' + interval '14 hours',    -- Sat 14:00 MG
    ws + interval '5 days' + interval '14 hours' + interval '40 minutes',
    ws + interval '5 days' + interval '15 hours' + interval '20 minutes',
    ws + interval '5 days' + interval '16 hours',
    ws + interval '6 days'                           -- Sun 00:00 MG
  )
  RETURNING id INTO rid;
  RETURN rid;
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_ensure_current() TO authenticated, anon;

-- 9) Get current tournament + summary
CREATE OR REPLACE FUNCTION public.tournament_get_current()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tid uuid;
  t public.tournaments%ROWTYPE;
  regs jsonb;
  matches jsonb;
  cnt int;
BEGIN
  tid := public.tournament_ensure_current();
  SELECT * INTO t FROM public.tournaments WHERE id = tid;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'user_id', r.user_id, 'nom', r.nom, 'tel', r.tel, 'id_card', r.id_card,
    'paid_amount', r.paid_amount, 'group_letter', r.group_letter, 'slot', r.slot,
    'registered_at', r.registered_at
  ) ORDER BY r.registered_at), '[]'::jsonb) INTO regs
  FROM public.tournament_registrations r
  WHERE r.tournament_id = tid AND r.cancelled_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', m.id, 'round', m.round, 'match_index', m.match_index,
    'player1_id', m.player1_id, 'player2_id', m.player2_id,
    'winner_id', m.winner_id, 'game_id', m.game_id,
    'scheduled_at', m.scheduled_at, 'started_at', m.started_at, 'finished_at', m.finished_at
  ) ORDER BY m.round, m.match_index), '[]'::jsonb) INTO matches
  FROM public.tournament_matches m WHERE m.tournament_id = tid;

  cnt := jsonb_array_length(regs);

  RETURN jsonb_build_object(
    'tournament', to_jsonb(t),
    'registrations', regs,
    'matches', matches,
    'count', cnt
  );
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_get_current() TO authenticated, anon;

-- 10) Register (deduct 5000 from wallet, validate PIN)
CREATE OR REPLACE FUNCTION public.tournament_register(_nom text, _tel text, _id_card text, _pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  tid uuid;
  t public.tournaments%ROWTYPE;
  current_count int;
  group_letter text;
  slot smallint;
  bal numeric;
  profile_pin text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF coalesce(trim(_nom),'') = '' OR coalesce(trim(_tel),'') = '' OR coalesce(trim(_id_card),'') = '' THEN
    RAISE EXCEPTION 'fields_required';
  END IF;

  SELECT pin_plain INTO profile_pin FROM public.profiles WHERE user_id = uid;
  IF profile_pin IS NULL OR profile_pin = '' THEN
    RAISE EXCEPTION 'pin_not_set';
  END IF;
  IF _pin <> profile_pin THEN
    RAISE EXCEPTION 'pin_diso';
  END IF;

  tid := public.tournament_ensure_current();
  PERFORM pg_advisory_xact_lock(hashtextextended('tourn_reg:'||tid::text, 0));

  SELECT * INTO t FROM public.tournaments WHERE id = tid FOR UPDATE;
  IF t.status <> 'registration' THEN RAISE EXCEPTION 'registration_closed'; END IF;
  IF now() >= t.reg_close THEN RAISE EXCEPTION 'registration_closed_time'; END IF;

  -- count active regs
  SELECT count(*) INTO current_count FROM public.tournament_registrations
    WHERE tournament_id = tid AND cancelled_at IS NULL;
  IF current_count >= 8 THEN RAISE EXCEPTION 'tournament_full'; END IF;

  IF EXISTS (SELECT 1 FROM public.tournament_registrations
             WHERE tournament_id = tid AND user_id = uid AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;

  -- assign group A/B/C/D by arrival
  group_letter := CASE
    WHEN current_count < 2 THEN 'A'
    WHEN current_count < 4 THEN 'B'
    WHEN current_count < 6 THEN 'C'
    ELSE 'D'
  END;
  slot := (current_count % 2) + 1;

  -- deduct wallet
  PERFORM public.allow_wallet_mutation();
  SELECT balance INTO bal FROM public.wallets WHERE user_id = uid FOR UPDATE;
  IF bal IS NULL OR bal < 5000 THEN RAISE EXCEPTION 'insufficient_balance'; END IF;
  UPDATE public.wallets SET balance = balance - 5000, updated_at = now() WHERE user_id = uid;

  INSERT INTO public.transactions(user_id, type, amount, status, admin_note)
  VALUES (uid, 'game_stake', 5000, 'completed', 'Tournoi du semaine — inscription');

  INSERT INTO public.tournament_registrations(tournament_id, user_id, nom, tel, id_card, paid_amount, group_letter, slot)
  VALUES (tid, uid, trim(_nom), trim(_tel), trim(_id_card), 5000, group_letter, slot);

  UPDATE public.tournaments SET total_collected = total_collected + 5000, updated_at = now() WHERE id = tid;

  RETURN jsonb_build_object('ok', true, 'group', group_letter, 'slot', slot);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_register(text,text,text,text) TO authenticated;

-- 11) Admin cancel a single registration (refund 5000)
CREATE OR REPLACE FUNCTION public.tournament_admin_cancel_registration(_reg_id uuid, _pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r RECORD;
  t public.tournaments%ROWTYPE;
BEGIN
  IF NOT public.has_role(uid, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;

  SELECT * INTO r FROM public.tournament_registrations WHERE id = _reg_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reg_not_found'; END IF;
  IF r.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'already_cancelled'; END IF;

  SELECT * INTO t FROM public.tournaments WHERE id = r.tournament_id FOR UPDATE;
  IF t.status IN ('finished','cancelled') THEN RAISE EXCEPTION 'tournament_closed'; END IF;

  PERFORM public.allow_wallet_mutation();
  UPDATE public.wallets SET balance = balance + r.paid_amount, updated_at = now() WHERE user_id = r.user_id;
  INSERT INTO public.transactions(user_id, type, amount, status, admin_note, processed_at, processed_by)
  VALUES (r.user_id, 'deposit', r.paid_amount, 'approved', 'Tournoi - annulation admin', now(), uid);

  UPDATE public.tournament_registrations SET cancelled_at = now(), cancelled_by = uid WHERE id = _reg_id;
  UPDATE public.tournaments SET total_collected = GREATEST(0, total_collected - r.paid_amount), updated_at = now()
    WHERE id = r.tournament_id;

  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (uid, r.user_id, 'Voafoana ny fisoratanao anarana amin''ny Tournoi du Semaine. Naverina ny 5 000 Ar.', false);

  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_admin_cancel_registration(uuid,text) TO authenticated;

-- 12) Admin cancel whole tournament (refund everyone)
CREATE OR REPLACE FUNCTION public.tournament_admin_cancel(_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  tid uuid;
  r RECORD;
  refunded int := 0;
BEGIN
  IF NOT public.has_role(uid, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;

  tid := public.tournament_ensure_current();
  PERFORM public.allow_wallet_mutation();

  FOR r IN SELECT * FROM public.tournament_registrations WHERE tournament_id = tid AND cancelled_at IS NULL FOR UPDATE LOOP
    UPDATE public.wallets SET balance = balance + r.paid_amount, updated_at = now() WHERE user_id = r.user_id;
    INSERT INTO public.transactions(user_id, type, amount, status, admin_note, processed_at, processed_by)
    VALUES (r.user_id, 'deposit', r.paid_amount, 'approved', 'Tournoi - annulation par ADM', now(), uid);
    UPDATE public.tournament_registrations SET cancelled_at = now(), cancelled_by = uid WHERE id = r.id;
    refunded := refunded + 1;
  END LOOP;

  -- cancel running games (if any) without refund (refund was via registration)
  UPDATE public.games SET status = 'cancelled', finished_at = now(), updated_at = now(), cash_pool = 0
  WHERE tournament_match_id IN (SELECT id FROM public.tournament_matches WHERE tournament_id = tid)
    AND status IN ('in_progress','waiting','blocked');

  UPDATE public.tournaments SET status = 'cancelled', total_collected = 0, updated_at = now() WHERE id = tid;
  RETURN jsonb_build_object('ok', true, 'refunded', refunded);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_admin_cancel(text) TO authenticated;

-- 13) Tournament advance — idempotent. Creates matches/games as time arrives, settles prizes when done.
CREATE OR REPLACE FUNCTION public.tournament_advance()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tid uuid;
  t public.tournaments%ROWTYPE;
  regs RECORD;
  qf_done int; sf_done int; third_done int; final_done int;
  p1 uuid; p2 uuid; gid uuid; m RECORD;
  winner_a uuid; winner_b uuid; winner_c uuid; winner_d uuid;
  winner_ab uuid; winner_cd uuid;
  loser_ab uuid; loser_cd uuid;
  active_count int;
  admin_user uuid;
BEGIN
  tid := public.tournament_ensure_current();
  PERFORM pg_advisory_xact_lock(hashtextextended('tourn_adv:'||tid::text, 0));
  SELECT * INTO t FROM public.tournaments WHERE id = tid FOR UPDATE;

  -- reset old finished/cancelled tournament once we're past its reset_at -> create fresh next week
  IF t.status IN ('finished','cancelled') AND now() >= t.reset_at THEN
    -- new week will be auto-created on next ensure call
    RETURN jsonb_build_object('ok', true, 'reset_pending', true);
  END IF;

  -- close registration at reg_close
  IF t.status = 'registration' AND now() >= t.reg_close THEN
    SELECT count(*) INTO active_count FROM public.tournament_registrations
      WHERE tournament_id = tid AND cancelled_at IS NULL;
    IF active_count < 8 THEN
      -- not enough players: cancel and refund
      PERFORM public.tournament_admin_cancel_auto(tid);
      RETURN jsonb_build_object('ok', true, 'auto_cancelled', true, 'reason', 'not_enough_players');
    END IF;
  END IF;

  -- Start QF
  IF t.status IN ('registration','running') AND now() >= t.qf_at
     AND NOT EXISTS (SELECT 1 FROM public.tournament_matches WHERE tournament_id = tid AND round = 'qf') THEN
    SELECT count(*) INTO active_count FROM public.tournament_registrations WHERE tournament_id = tid AND cancelled_at IS NULL;
    IF active_count <> 8 THEN
      PERFORM public.tournament_admin_cancel_auto(tid);
      RETURN jsonb_build_object('ok', true, 'auto_cancelled', true, 'reason', 'not_8_players');
    END IF;
    UPDATE public.tournaments SET status = 'running', updated_at = now() WHERE id = tid;
    -- create 4 QF matches A1vA2, B1vB2, C1vC2, D1vD2
    FOR regs IN
      SELECT group_letter,
        MAX(CASE WHEN slot=1 THEN user_id END) AS p1,
        MAX(CASE WHEN slot=2 THEN user_id END) AS p2
      FROM public.tournament_registrations
      WHERE tournament_id = tid AND cancelled_at IS NULL
      GROUP BY group_letter
      ORDER BY group_letter
    LOOP
      gid := public.tournament_create_match_game(tid, regs.p1, regs.p2);
      INSERT INTO public.tournament_matches(tournament_id, round, match_index, player1_id, player2_id, game_id, scheduled_at, started_at)
      VALUES (tid, 'qf',
        CASE regs.group_letter WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
        regs.p1, regs.p2, gid, t.qf_at, now());
      UPDATE public.games SET tournament_match_id = (SELECT id FROM public.tournament_matches WHERE game_id = gid LIMIT 1)
        WHERE id = gid;
    END LOOP;
  END IF;

  -- Sync winners from finished games into matches
  UPDATE public.tournament_matches m
    SET winner_id = g.winner_id, finished_at = COALESCE(m.finished_at, g.finished_at)
    FROM public.games g
    WHERE m.tournament_id = tid AND m.game_id = g.id
      AND g.status = 'finished' AND g.winner_id IS NOT NULL
      AND m.winner_id IS NULL;

  -- Check QF done
  SELECT count(*) INTO qf_done FROM public.tournament_matches WHERE tournament_id = tid AND round='qf' AND winner_id IS NOT NULL;

  -- Start SF when QF done and time arrived
  IF qf_done = 4 AND now() >= t.sf_at
     AND NOT EXISTS (SELECT 1 FROM public.tournament_matches WHERE tournament_id = tid AND round='sf') THEN
    SELECT winner_id INTO winner_a FROM public.tournament_matches WHERE tournament_id=tid AND round='qf' AND match_index=1;
    SELECT winner_id INTO winner_b FROM public.tournament_matches WHERE tournament_id=tid AND round='qf' AND match_index=2;
    SELECT winner_id INTO winner_c FROM public.tournament_matches WHERE tournament_id=tid AND round='qf' AND match_index=3;
    SELECT winner_id INTO winner_d FROM public.tournament_matches WHERE tournament_id=tid AND round='qf' AND match_index=4;

    gid := public.tournament_create_match_game(tid, winner_a, winner_b);
    INSERT INTO public.tournament_matches(tournament_id, round, match_index, player1_id, player2_id, game_id, scheduled_at, started_at)
    VALUES (tid, 'sf', 1, winner_a, winner_b, gid, t.sf_at, now());
    UPDATE public.games SET tournament_match_id = (SELECT id FROM public.tournament_matches WHERE game_id = gid LIMIT 1) WHERE id = gid;

    gid := public.tournament_create_match_game(tid, winner_c, winner_d);
    INSERT INTO public.tournament_matches(tournament_id, round, match_index, player1_id, player2_id, game_id, scheduled_at, started_at)
    VALUES (tid, 'sf', 2, winner_c, winner_d, gid, t.sf_at, now());
    UPDATE public.games SET tournament_match_id = (SELECT id FROM public.tournament_matches WHERE game_id = gid LIMIT 1) WHERE id = gid;
  END IF;

  -- Re-sync
  UPDATE public.tournament_matches m
    SET winner_id = g.winner_id, finished_at = COALESCE(m.finished_at, g.finished_at)
    FROM public.games g
    WHERE m.tournament_id = tid AND m.game_id = g.id
      AND g.status = 'finished' AND g.winner_id IS NOT NULL
      AND m.winner_id IS NULL;

  SELECT count(*) INTO sf_done FROM public.tournament_matches WHERE tournament_id = tid AND round='sf' AND winner_id IS NOT NULL;

  -- Petite finale (3rd place) — losers of SF
  IF sf_done = 2 AND now() >= t.third_at
     AND NOT EXISTS (SELECT 1 FROM public.tournament_matches WHERE tournament_id = tid AND round='third') THEN
    SELECT CASE WHEN winner_id = player1_id THEN player2_id ELSE player1_id END
      INTO loser_ab FROM public.tournament_matches WHERE tournament_id=tid AND round='sf' AND match_index=1;
    SELECT CASE WHEN winner_id = player1_id THEN player2_id ELSE player1_id END
      INTO loser_cd FROM public.tournament_matches WHERE tournament_id=tid AND round='sf' AND match_index=2;
    gid := public.tournament_create_match_game(tid, loser_ab, loser_cd);
    INSERT INTO public.tournament_matches(tournament_id, round, match_index, player1_id, player2_id, game_id, scheduled_at, started_at)
    VALUES (tid, 'third', 1, loser_ab, loser_cd, gid, t.third_at, now());
    UPDATE public.games SET tournament_match_id = (SELECT id FROM public.tournament_matches WHERE game_id = gid LIMIT 1) WHERE id = gid;
  END IF;

  -- Final
  IF sf_done = 2 AND now() >= t.final_at
     AND NOT EXISTS (SELECT 1 FROM public.tournament_matches WHERE tournament_id = tid AND round='final') THEN
    SELECT winner_id INTO winner_ab FROM public.tournament_matches WHERE tournament_id=tid AND round='sf' AND match_index=1;
    SELECT winner_id INTO winner_cd FROM public.tournament_matches WHERE tournament_id=tid AND round='sf' AND match_index=2;
    gid := public.tournament_create_match_game(tid, winner_ab, winner_cd);
    INSERT INTO public.tournament_matches(tournament_id, round, match_index, player1_id, player2_id, game_id, scheduled_at, started_at)
    VALUES (tid, 'final', 1, winner_ab, winner_cd, gid, t.final_at, now());
    UPDATE public.games SET tournament_match_id = (SELECT id FROM public.tournament_matches WHERE game_id = gid LIMIT 1) WHERE id = gid;
  END IF;

  -- Re-sync once more
  UPDATE public.tournament_matches m
    SET winner_id = g.winner_id, finished_at = COALESCE(m.finished_at, g.finished_at)
    FROM public.games g
    WHERE m.tournament_id = tid AND m.game_id = g.id
      AND g.status = 'finished' AND g.winner_id IS NOT NULL
      AND m.winner_id IS NULL;

  SELECT count(*) INTO final_done FROM public.tournament_matches WHERE tournament_id = tid AND round='final' AND winner_id IS NOT NULL;
  SELECT count(*) INTO third_done FROM public.tournament_matches WHERE tournament_id = tid AND round='third' AND winner_id IS NOT NULL;

  -- Settle when final is done
  IF final_done = 1 AND t.status = 'running' THEN
    PERFORM public.tournament_settle_prizes(tid);
  END IF;

  RETURN jsonb_build_object('ok', true, 'qf_done', qf_done, 'sf_done', sf_done, 'third_done', third_done, 'final_done', final_done);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_advance() TO authenticated, anon;

-- 14) Helper: create a game row for a tournament match
CREATE OR REPLACE FUNCTION public.tournament_create_match_game(_tid uuid, _p1 uuid, _p2 uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gid uuid; ticket text;
BEGIN
  ticket := 'T' || to_char(now(), 'YYYYMMDDHH24MISS');
  INSERT INTO public.games(player1_id, player2_id, stake, status, current_turn, turn_started_at,
                           is_tournament, ticket_number, commission, cash_pool, players_count, game_mode)
  VALUES (_p1, _p2, 0, 'in_progress', _p1, now(), true, ticket, 0, 0, 2, 'd120')
  RETURNING id INTO gid;
  RETURN gid;
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_create_match_game(uuid,uuid,uuid) TO authenticated;

-- 15) Settle prizes (1st 30k, 2nd 6k, admin 4k)
CREATE OR REPLACE FUNCTION public.tournament_settle_prizes(_tid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.tournaments%ROWTYPE;
  champion uuid; runner_up uuid;
  final_m RECORD; admin_user uuid;
BEGIN
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO t FROM public.tournaments WHERE id = _tid FOR UPDATE;
  IF t.status <> 'running' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;

  SELECT * INTO final_m FROM public.tournament_matches WHERE tournament_id = _tid AND round='final' AND match_index=1;
  IF final_m IS NULL OR final_m.winner_id IS NULL THEN RAISE EXCEPTION 'final_not_done'; END IF;

  champion := final_m.winner_id;
  runner_up := CASE WHEN final_m.player1_id = champion THEN final_m.player2_id ELSE final_m.player1_id END;

  -- 30 000 winner
  UPDATE public.wallets SET balance = balance + 30000, updated_at = now() WHERE user_id = champion;
  INSERT INTO public.transactions(user_id, type, amount, status, admin_note)
  VALUES (champion, 'game_win', 30000, 'completed', 'Tournoi du Semaine — Champion');

  -- 6 000 runner-up
  UPDATE public.wallets SET balance = balance + 6000, updated_at = now() WHERE user_id = runner_up;
  INSERT INTO public.transactions(user_id, type, amount, status, admin_note)
  VALUES (runner_up, 'game_win', 6000, 'completed', 'Tournoi du Semaine — 2ème place');

  -- 4 000 admin
  SELECT user_id INTO admin_user FROM public.user_roles WHERE role='admin' ORDER BY created_at ASC LIMIT 1;
  IF admin_user IS NOT NULL THEN
    INSERT INTO public.admin_wallets(admin_id, balance) VALUES (admin_user, 4000)
    ON CONFLICT (admin_id) DO UPDATE SET balance = admin_wallets.balance + 4000, updated_at = now();
  END IF;

  UPDATE public.tournaments
    SET status = 'finished', winner_id = champion, runner_up_id = runner_up,
        settled_at = now(), updated_at = now()
    WHERE id = _tid;

  -- Notify
  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (admin_user, champion, '🏆 Mpandresy Tournoi du Semaine! Loka 30 000 Ar tafiditra ao amin''ny solde.', false);
  INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
  VALUES (admin_user, runner_up, '🥈 Faharoa amin''ny Tournoi du Semaine! Loka 6 000 Ar tafiditra ao amin''ny solde.', false);

  RETURN jsonb_build_object('ok', true, 'champion', champion, 'runner_up', runner_up);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_settle_prizes(uuid) TO authenticated;

-- 16) Auto-cancel helper (when not enough players at start)
CREATE OR REPLACE FUNCTION public.tournament_admin_cancel_auto(_tid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  PERFORM public.allow_wallet_mutation();
  FOR r IN SELECT * FROM public.tournament_registrations WHERE tournament_id = _tid AND cancelled_at IS NULL FOR UPDATE LOOP
    UPDATE public.wallets SET balance = balance + r.paid_amount, updated_at = now() WHERE user_id = r.user_id;
    INSERT INTO public.transactions(user_id, type, amount, status, admin_note, processed_at)
    VALUES (r.user_id, 'deposit', r.paid_amount, 'approved', 'Tournoi — annulation auto (tsy ampy mpilalao)', now());
    UPDATE public.tournament_registrations SET cancelled_at = now() WHERE id = r.id;
  END LOOP;
  UPDATE public.tournaments SET status = 'cancelled', total_collected = 0, updated_at = now() WHERE id = _tid;
END $$;

-- 17) Override settle_game to handle tournament games (no pot, just record winner)
CREATE OR REPLACE FUNCTION public.settle_game(_game_id uuid, _winner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g RECORD;
  pot NUMERIC;
  caller uuid := auth.uid();
  winner_score numeric := 0;
  target_score numeric := 120;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('settle:'||_game_id::text, 0));
  PERFORM public.allow_wallet_mutation();

  SELECT * INTO g FROM public.games WHERE id = _game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status = 'finished' THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;

  IF _winner <> g.player1_id AND _winner <> g.player2_id
     AND _winner <> COALESCE(g.player3_id,'00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'invalid_winner';
  END IF;

  IF NOT public.has_role(caller, 'admin') THEN
    IF caller IS NULL OR caller NOT IN (g.player1_id, g.player2_id, COALESCE(g.player3_id, g.player1_id)) THEN
      RAISE EXCEPTION 'forbidden_caller';
    END IF;
  END IF;

  -- Tournament game: no money flow, just close game and let tournament_advance pick winner
  IF g.is_tournament = true THEN
    UPDATE public.games
      SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0
      WHERE id=g.id;
    -- mark tournament_matches
    UPDATE public.tournament_matches SET winner_id = _winner, finished_at = now()
      WHERE game_id = g.id AND winner_id IS NULL;
    RETURN jsonb_build_object('ok', true, 'tournament', true);
  END IF;

  IF g.game_mode = 'd80' THEN target_score := 80; ELSE target_score := 120; END IF;

  winner_score := CASE
    WHEN _winner = g.player1_id THEN COALESCE(g.score_p1, 0)
    WHEN _winner = g.player2_id THEN COALESCE(g.score_p2, 0)
    WHEN _winner = g.player3_id THEN COALESCE(g.score_p3, 0)
    ELSE 0
  END;

  IF NOT public.has_role(caller, 'admin') AND caller = _winner AND winner_score < target_score THEN
    RAISE EXCEPTION 'domino_target_not_reached';
  END IF;

  pot := g.cash_pool;
  IF pot <= 0 THEN RAISE EXCEPTION 'empty_cash_pool'; END IF;

  UPDATE public.wallets SET balance = balance + pot, updated_at = now() WHERE user_id = _winner;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id)
  VALUES (_winner,'game_win',pot,'completed',g.id);

  UPDATE public.games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0
  WHERE id=g.id;

  RETURN jsonb_build_object('ok', true, 'pot', pot, 'target_score', target_score, 'winner_score', winner_score);
END $$;
