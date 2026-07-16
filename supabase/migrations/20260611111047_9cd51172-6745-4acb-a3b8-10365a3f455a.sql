
-- 1) ENUM vaovao
DO $$ BEGIN
  CREATE TYPE public.tournament_game_type AS ENUM ('domino','ludo','petanque');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) game_type ao amin'ny tournaments + unique vaovao
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS game_type public.tournament_game_type NOT NULL DEFAULT 'domino';

ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_week_start_key;
DO $$ BEGIN
  ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_week_game_type_key UNIQUE (week_start, game_type);
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 3) is_tournament + tournament_match_id ho an'ny Ludo & Pétanque
ALTER TABLE public.ludo_games
  ADD COLUMN IF NOT EXISTS is_tournament boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tournament_match_id uuid;
ALTER TABLE public.petanque_games
  ADD COLUMN IF NOT EXISTS is_tournament boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tournament_match_id uuid;

CREATE INDEX IF NOT EXISTS idx_ludo_tournament_match ON public.ludo_games(tournament_match_id) WHERE tournament_match_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pet_tournament_match  ON public.petanque_games(tournament_match_id) WHERE tournament_match_id IS NOT NULL;

-- 4) Esorina ny RPC taloha mba ahafahana mamerina mamorona miaraka amin'ny signature vaovao
DROP FUNCTION IF EXISTS public.tournament_ensure_current();
DROP FUNCTION IF EXISTS public.tournament_get_current();
DROP FUNCTION IF EXISTS public.tournament_register(text,text,text,text);
DROP FUNCTION IF EXISTS public.tournament_advance();
DROP FUNCTION IF EXISTS public.tournament_admin_cancel(text);
DROP FUNCTION IF EXISTS public.tournament_create_match_game(uuid,uuid,uuid);

-- 5) tournament_ensure_current(_game_type)
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
        ws + interval '5 days',
        ws + interval '5 days' + interval '14 hours',
        ws + interval '5 days' + interval '14 hours 40 minutes',
        ws + interval '5 days' + interval '15 hours 20 minutes',
        ws + interval '5 days' + interval '16 hours',
        ws + interval '6 days')
      RETURNING id INTO rid;
      RETURN rid;
    END IF;
    IF st IN ('cancelled','finished') THEN
      ws := ws + interval '7 days';
      CONTINUE;
    END IF;
    RETURN rid;
  END LOOP;
  RETURN rid;
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_ensure_current(text) TO authenticated, anon;

-- 6) tournament_get_current(_game_type)
CREATE OR REPLACE FUNCTION public.tournament_get_current(_game_type text DEFAULT 'domino')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid; t public.tournaments%ROWTYPE; regs jsonb; matches jsonb; cnt int;
BEGIN
  tid := public.tournament_ensure_current(_game_type);
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
  RETURN jsonb_build_object('tournament', to_jsonb(t), 'registrations', regs, 'matches', matches, 'count', cnt);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_get_current(text) TO authenticated, anon;

-- 7) tournament_register(_game_type, _nom, _tel, _id_card, _pin)
CREATE OR REPLACE FUNCTION public.tournament_register(_game_type text, _nom text, _tel text, _id_card text, _pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); tid uuid; t public.tournaments%ROWTYPE; current_count int;
        gl text; sl smallint; bal numeric; profile_pin text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF coalesce(trim(_nom),'')='' OR coalesce(trim(_tel),'')='' OR coalesce(trim(_id_card),'')='' THEN
    RAISE EXCEPTION 'fields_required'; END IF;
  SELECT pin_plain INTO profile_pin FROM public.profiles WHERE user_id = uid;
  IF profile_pin IS NULL OR profile_pin = '' THEN RAISE EXCEPTION 'pin_not_set'; END IF;
  IF _pin <> profile_pin THEN RAISE EXCEPTION 'pin_diso'; END IF;

  tid := public.tournament_ensure_current(_game_type);
  PERFORM pg_advisory_xact_lock(hashtextextended('tourn_reg:'||tid::text, 0));
  SELECT * INTO t FROM public.tournaments WHERE id = tid FOR UPDATE;
  IF t.status <> 'registration' THEN RAISE EXCEPTION 'registration_closed'; END IF;
  IF now() >= t.reg_close THEN RAISE EXCEPTION 'registration_closed_time'; END IF;

  SELECT count(*) INTO current_count FROM public.tournament_registrations
    WHERE tournament_id = tid AND cancelled_at IS NULL;
  IF current_count >= 8 THEN RAISE EXCEPTION 'tournament_full'; END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_registrations
             WHERE tournament_id = tid AND user_id = uid AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'already_registered'; END IF;

  gl := CASE WHEN current_count<2 THEN 'A' WHEN current_count<4 THEN 'B' WHEN current_count<6 THEN 'C' ELSE 'D' END;
  sl := (current_count % 2) + 1;

  PERFORM public.allow_wallet_mutation();
  SELECT balance INTO bal FROM public.wallets WHERE user_id = uid FOR UPDATE;
  IF bal IS NULL OR bal < 5000 THEN RAISE EXCEPTION 'insufficient_balance'; END IF;
  UPDATE public.wallets SET balance = balance - 5000, updated_at = now() WHERE user_id = uid;
  INSERT INTO public.transactions(user_id, type, amount, status, admin_note)
  VALUES (uid, 'game_stake', 5000, 'completed', 'Tournoi '||_game_type||' — inscription');

  INSERT INTO public.tournament_registrations(tournament_id, user_id, nom, tel, id_card, paid_amount, group_letter, slot)
  VALUES (tid, uid, trim(_nom), trim(_tel), trim(_id_card), 5000, gl, sl);

  UPDATE public.tournaments SET total_collected = total_collected + 5000, updated_at = now() WHERE id = tid;
  RETURN jsonb_build_object('ok', true, 'group', gl, 'slot', sl);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_register(text,text,text,text,text) TO authenticated;

-- 8) tournament_create_match_game(_tid, _game_type, _p1, _p2)
CREATE OR REPLACE FUNCTION public.tournament_create_match_game(_tid uuid, _game_type text, _p1 uuid, _p2 uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gid uuid; ticket text; gt public.tournament_game_type;
BEGIN
  gt := _game_type::public.tournament_game_type;
  ticket := 'T'||upper(left(_game_type,3))||to_char(now(),'YYYYMMDDHH24MISS');
  IF gt = 'domino' THEN
    INSERT INTO public.games(player1_id, player2_id, stake, status, current_turn, turn_started_at,
                             is_tournament, ticket_number, commission, cash_pool, players_count, game_mode)
    VALUES (_p1, _p2, 0, 'in_progress', _p1, now(), true, ticket, 0, 0, 2, 'd120')
    RETURNING id INTO gid;
  ELSIF gt = 'ludo' THEN
    INSERT INTO public.ludo_games(player1_id, player2_id, players_count, stake, status,
                                  current_turn_seat, turn_started_at, ticket_number, commission, cash_pool,
                                  seat_assignment, pawns, is_tournament)
    VALUES (_p1, _p2, 2, 0, 'in_progress', 1, now(), ticket, 0, 0,
            '[1,3]'::jsonb, public.ludo_initial_pawns_for('[1,3]'::jsonb), true)
    RETURNING id INTO gid;
  ELSE
    INSERT INTO public.petanque_games(player1_id, player2_id, stake, status, current_turn, turn_started_at,
                                      ticket_number, commission, cash_pool, score_p1, score_p2, round_number,
                                      state, is_tournament)
    VALUES (_p1, _p2, 0, 'in_progress', _p1, now(), ticket, 0, 0, 0, 0, 1,
            jsonb_build_object('balls','[]'::jsonb,'jack',NULL,'phase','throw_jack','remaining', jsonb_build_object('p1',4,'p2',4)),
            true)
    RETURNING id INTO gid;
  END IF;
  RETURN gid;
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_create_match_game(uuid,text,uuid,uuid) TO authenticated;

-- 9) Helpers: link game id ho an'ny tournament_match + sync winner
CREATE OR REPLACE FUNCTION public.tournament_link_game_to_match(_game_type text, _game_id uuid, _tid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE mid uuid;
BEGIN
  SELECT id INTO mid FROM public.tournament_matches WHERE game_id = _game_id LIMIT 1;
  IF mid IS NULL THEN RETURN; END IF;
  IF _game_type = 'domino' THEN
    UPDATE public.games SET tournament_match_id = mid WHERE id = _game_id;
  ELSIF _game_type = 'ludo' THEN
    UPDATE public.ludo_games SET tournament_match_id = mid WHERE id = _game_id;
  ELSE
    UPDATE public.petanque_games SET tournament_match_id = mid WHERE id = _game_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.tournament_sync_match_winners(_game_type text, _tid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _game_type = 'domino' THEN
    UPDATE public.tournament_matches m
      SET winner_id = g.winner_id, finished_at = COALESCE(m.finished_at, g.finished_at)
      FROM public.games g
      WHERE m.tournament_id = _tid AND m.game_id = g.id
        AND g.status = 'finished' AND g.winner_id IS NOT NULL AND m.winner_id IS NULL;
  ELSIF _game_type = 'ludo' THEN
    UPDATE public.tournament_matches m
      SET winner_id = g.winner_id, finished_at = COALESCE(m.finished_at, g.finished_at)
      FROM public.ludo_games g
      WHERE m.tournament_id = _tid AND m.game_id = g.id
        AND g.status = 'finished' AND g.winner_id IS NOT NULL AND m.winner_id IS NULL;
  ELSE
    UPDATE public.tournament_matches m
      SET winner_id = g.winner_id, finished_at = COALESCE(m.finished_at, g.finished_at)
      FROM public.petanque_games g
      WHERE m.tournament_id = _tid AND m.game_id = g.id
        AND g.status = 'finished' AND g.winner_id IS NOT NULL AND m.winner_id IS NULL;
  END IF;
END $$;

-- 10) tournament_admin_cancel(_game_type, _pin)
CREATE OR REPLACE FUNCTION public.tournament_admin_cancel(_game_type text, _pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); tid uuid; r RECORD; refunded int := 0; gt public.tournament_game_type;
BEGIN
  IF NOT public.has_role(uid, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;
  gt := _game_type::public.tournament_game_type;
  tid := public.tournament_ensure_current(_game_type);
  PERFORM public.allow_wallet_mutation();
  FOR r IN SELECT * FROM public.tournament_registrations WHERE tournament_id = tid AND cancelled_at IS NULL FOR UPDATE LOOP
    UPDATE public.wallets SET balance = balance + r.paid_amount, updated_at = now() WHERE user_id = r.user_id;
    INSERT INTO public.transactions(user_id, type, amount, status, admin_note, processed_at, processed_by)
    VALUES (r.user_id, 'deposit', r.paid_amount, 'approved', 'Tournoi '||_game_type||' - annulation ADM', now(), uid);
    UPDATE public.tournament_registrations SET cancelled_at = now(), cancelled_by = uid WHERE id = r.id;
    refunded := refunded + 1;
  END LOOP;
  IF gt = 'domino' THEN
    UPDATE public.games SET status='cancelled', finished_at=now(), updated_at=now(), cash_pool=0
    WHERE tournament_match_id IN (SELECT id FROM public.tournament_matches WHERE tournament_id = tid)
      AND status IN ('in_progress','waiting','blocked');
  ELSIF gt = 'ludo' THEN
    UPDATE public.ludo_games SET status='cancelled', finished_at=now(), updated_at=now(), cash_pool=0
    WHERE tournament_match_id IN (SELECT id FROM public.tournament_matches WHERE tournament_id = tid)
      AND status IN ('in_progress','waiting');
  ELSE
    UPDATE public.petanque_games SET status='cancelled', finished_at=now(), updated_at=now(), cash_pool=0
    WHERE tournament_match_id IN (SELECT id FROM public.tournament_matches WHERE tournament_id = tid)
      AND status IN ('in_progress','waiting');
  END IF;
  UPDATE public.tournaments SET status='cancelled', total_collected=0, updated_at=now() WHERE id = tid;
  RETURN jsonb_build_object('ok', true, 'refunded', refunded);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_admin_cancel(text,text) TO authenticated;

-- 11) tournament_advance(_game_type) — raha NULL dia mandeha rehetra (3 karazana)
CREATE OR REPLACE FUNCTION public.tournament_advance(_game_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid; t public.tournaments%ROWTYPE; regs RECORD;
        qf_done int; sf_done int; third_done int; final_done int;
        gid uuid;
        wa uuid; wb uuid; wc uuid; wd uuid;
        wab uuid; wcd uuid; lab uuid; lcd uuid;
        active_count int; gt_text text;
        types text[] := ARRAY['domino','ludo','petanque'];
BEGIN
  IF _game_type IS NULL THEN
    FOREACH gt_text IN ARRAY types LOOP
      PERFORM public.tournament_advance(gt_text);
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'all', true);
  END IF;

  tid := public.tournament_ensure_current(_game_type);
  PERFORM pg_advisory_xact_lock(hashtextextended('tourn_adv:'||tid::text, 0));
  SELECT * INTO t FROM public.tournaments WHERE id = tid FOR UPDATE;

  IF t.status IN ('finished','cancelled') AND now() >= t.reset_at THEN
    RETURN jsonb_build_object('ok', true, 'reset_pending', true);
  END IF;

  IF t.status = 'registration' AND now() >= t.reg_close THEN
    SELECT count(*) INTO active_count FROM public.tournament_registrations
      WHERE tournament_id = tid AND cancelled_at IS NULL;
    IF active_count < 8 THEN
      PERFORM public.tournament_admin_cancel_auto(tid);
      RETURN jsonb_build_object('ok', true, 'auto_cancelled', true);
    END IF;
  END IF;

  -- Start QF
  IF t.status IN ('registration','running') AND now() >= t.qf_at
     AND NOT EXISTS (SELECT 1 FROM public.tournament_matches WHERE tournament_id = tid AND round='qf') THEN
    SELECT count(*) INTO active_count FROM public.tournament_registrations WHERE tournament_id = tid AND cancelled_at IS NULL;
    IF active_count <> 8 THEN
      PERFORM public.tournament_admin_cancel_auto(tid);
      RETURN jsonb_build_object('ok', true, 'auto_cancelled', true);
    END IF;
    UPDATE public.tournaments SET status='running', updated_at=now() WHERE id = tid;
    FOR regs IN
      SELECT group_letter,
        MAX(CASE WHEN slot=1 THEN user_id END) AS p1,
        MAX(CASE WHEN slot=2 THEN user_id END) AS p2
      FROM public.tournament_registrations
      WHERE tournament_id = tid AND cancelled_at IS NULL
      GROUP BY group_letter ORDER BY group_letter
    LOOP
      gid := public.tournament_create_match_game(tid, _game_type, regs.p1, regs.p2);
      INSERT INTO public.tournament_matches(tournament_id, round, match_index, player1_id, player2_id, game_id, scheduled_at, started_at)
      VALUES (tid, 'qf', CASE regs.group_letter WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
              regs.p1, regs.p2, gid, t.qf_at, now());
      PERFORM public.tournament_link_game_to_match(_game_type, gid, tid);
    END LOOP;
  END IF;

  PERFORM public.tournament_sync_match_winners(_game_type, tid);
  SELECT count(*) INTO qf_done FROM public.tournament_matches WHERE tournament_id=tid AND round='qf' AND winner_id IS NOT NULL;

  IF qf_done = 4 AND now() >= t.sf_at
     AND NOT EXISTS (SELECT 1 FROM public.tournament_matches WHERE tournament_id=tid AND round='sf') THEN
    SELECT winner_id INTO wa FROM public.tournament_matches WHERE tournament_id=tid AND round='qf' AND match_index=1;
    SELECT winner_id INTO wb FROM public.tournament_matches WHERE tournament_id=tid AND round='qf' AND match_index=2;
    SELECT winner_id INTO wc FROM public.tournament_matches WHERE tournament_id=tid AND round='qf' AND match_index=3;
    SELECT winner_id INTO wd FROM public.tournament_matches WHERE tournament_id=tid AND round='qf' AND match_index=4;
    gid := public.tournament_create_match_game(tid, _game_type, wa, wb);
    INSERT INTO public.tournament_matches(tournament_id, round, match_index, player1_id, player2_id, game_id, scheduled_at, started_at)
      VALUES (tid, 'sf', 1, wa, wb, gid, t.sf_at, now());
    PERFORM public.tournament_link_game_to_match(_game_type, gid, tid);
    gid := public.tournament_create_match_game(tid, _game_type, wc, wd);
    INSERT INTO public.tournament_matches(tournament_id, round, match_index, player1_id, player2_id, game_id, scheduled_at, started_at)
      VALUES (tid, 'sf', 2, wc, wd, gid, t.sf_at, now());
    PERFORM public.tournament_link_game_to_match(_game_type, gid, tid);
  END IF;

  PERFORM public.tournament_sync_match_winners(_game_type, tid);
  SELECT count(*) INTO sf_done FROM public.tournament_matches WHERE tournament_id=tid AND round='sf' AND winner_id IS NOT NULL;

  IF sf_done = 2 AND now() >= t.third_at
     AND NOT EXISTS (SELECT 1 FROM public.tournament_matches WHERE tournament_id=tid AND round='third') THEN
    SELECT CASE WHEN winner_id=player1_id THEN player2_id ELSE player1_id END INTO lab
      FROM public.tournament_matches WHERE tournament_id=tid AND round='sf' AND match_index=1;
    SELECT CASE WHEN winner_id=player1_id THEN player2_id ELSE player1_id END INTO lcd
      FROM public.tournament_matches WHERE tournament_id=tid AND round='sf' AND match_index=2;
    gid := public.tournament_create_match_game(tid, _game_type, lab, lcd);
    INSERT INTO public.tournament_matches(tournament_id, round, match_index, player1_id, player2_id, game_id, scheduled_at, started_at)
      VALUES (tid, 'third', 1, lab, lcd, gid, t.third_at, now());
    PERFORM public.tournament_link_game_to_match(_game_type, gid, tid);
  END IF;

  IF sf_done = 2 AND now() >= t.final_at
     AND NOT EXISTS (SELECT 1 FROM public.tournament_matches WHERE tournament_id=tid AND round='final') THEN
    SELECT winner_id INTO wab FROM public.tournament_matches WHERE tournament_id=tid AND round='sf' AND match_index=1;
    SELECT winner_id INTO wcd FROM public.tournament_matches WHERE tournament_id=tid AND round='sf' AND match_index=2;
    gid := public.tournament_create_match_game(tid, _game_type, wab, wcd);
    INSERT INTO public.tournament_matches(tournament_id, round, match_index, player1_id, player2_id, game_id, scheduled_at, started_at)
      VALUES (tid, 'final', 1, wab, wcd, gid, t.final_at, now());
    PERFORM public.tournament_link_game_to_match(_game_type, gid, tid);
  END IF;

  PERFORM public.tournament_sync_match_winners(_game_type, tid);
  SELECT count(*) INTO final_done FROM public.tournament_matches WHERE tournament_id=tid AND round='final' AND winner_id IS NOT NULL;
  SELECT count(*) INTO third_done FROM public.tournament_matches WHERE tournament_id=tid AND round='third' AND winner_id IS NOT NULL;
  IF final_done = 1 AND t.status = 'running' THEN
    PERFORM public.tournament_settle_prizes(tid);
  END IF;

  RETURN jsonb_build_object('ok', true, 'game_type', _game_type,
    'qf_done', qf_done, 'sf_done', sf_done, 'third_done', third_done, 'final_done', final_done);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_advance(text) TO authenticated, anon;

-- 12) Manova ny ludo_settle & petanque_settle ho an'ny tournoi (tsy vola mifindra)
CREATE OR REPLACE FUNCTION public.ludo_settle(_game_id uuid, _winner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g RECORD; pot numeric; caller uuid := auth.uid(); is_system boolean := (COALESCE(auth.role(),'')='service_role');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ludo_settle:'||_game_id::text, 0));
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.ludo_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status='finished' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF _winner NOT IN (g.player1_id, g.player2_id, g.player3_id, g.player4_id) THEN
    RAISE EXCEPTION 'invalid_winner'; END IF;
  IF NOT is_system AND NOT public.has_role(caller,'admin') THEN
    IF caller IS NULL OR caller NOT IN (g.player1_id, g.player2_id, COALESCE(g.player3_id,g.player1_id), COALESCE(g.player4_id,g.player1_id)) THEN
      RAISE EXCEPTION 'forbidden_caller';
    END IF;
  END IF;
  IF g.is_tournament = true THEN
    UPDATE public.ludo_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=_game_id;
    UPDATE public.tournament_matches SET winner_id=_winner, finished_at=now()
      WHERE game_id = _game_id AND winner_id IS NULL;
    RETURN jsonb_build_object('ok',true,'tournament',true);
  END IF;
  pot := g.cash_pool;
  IF pot <= 0 THEN RAISE EXCEPTION 'empty_cash_pool'; END IF;
  UPDATE public.wallets SET balance=balance+pot, updated_at=now() WHERE user_id=_winner;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (_winner,'game_win',pot,'completed',_game_id);
  UPDATE public.ludo_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'pot',pot);
END $$;

CREATE OR REPLACE FUNCTION public.petanque_settle(_game_id uuid, _winner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g RECORD; pot numeric; caller uuid := auth.uid();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('petanque_settle:'||_game_id::text, 0));
  PERFORM public.allow_wallet_mutation();
  SELECT * INTO g FROM public.petanque_games WHERE id=_game_id FOR UPDATE;
  IF g IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF g.status='finished' THEN RETURN jsonb_build_object('ok',true,'already',true); END IF;
  IF _winner NOT IN (g.player1_id, g.player2_id) THEN RAISE EXCEPTION 'invalid_winner'; END IF;
  IF NOT public.has_role(caller,'admin') THEN
    IF caller IS NULL OR caller NOT IN (g.player1_id, g.player2_id) THEN RAISE EXCEPTION 'forbidden_caller'; END IF;
  END IF;
  IF g.is_tournament = true THEN
    UPDATE public.petanque_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=_game_id;
    UPDATE public.tournament_matches SET winner_id=_winner, finished_at=now()
      WHERE game_id = _game_id AND winner_id IS NULL;
    RETURN jsonb_build_object('ok',true,'tournament',true);
  END IF;
  pot := g.cash_pool;
  IF pot <= 0 THEN RAISE EXCEPTION 'empty_cash_pool'; END IF;
  UPDATE public.wallets SET balance=balance+pot, updated_at=now() WHERE user_id=_winner;
  INSERT INTO public.transactions(user_id,type,amount,status,game_id) VALUES (_winner,'game_win',pot,'completed',_game_id);
  UPDATE public.petanque_games SET status='finished', winner_id=_winner, finished_at=now(), updated_at=now(), cash_pool=0 WHERE id=_game_id;
  RETURN jsonb_build_object('ok',true,'pot',pot);
END $$;
