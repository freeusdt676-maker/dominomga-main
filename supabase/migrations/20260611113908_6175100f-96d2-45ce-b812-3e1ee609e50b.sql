-- 1) tournaments: notified_phases ho an'ny idempotency
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS notified_phases jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2) tournament_notify_phase()
CREATE OR REPLACE FUNCTION public.tournament_notify_phase()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t RECORD; admin_id uuid; sent int := 0; msg_reg text; msg_qf text; already jsonb;
BEGIN
  SELECT user_id INTO admin_id FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  IF admin_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'no_admin', true); END IF;
  FOR t IN SELECT * FROM public.tournaments WHERE status IN ('registration','running') LOOP
    already := COALESCE(t.notified_phases, '{}'::jsonb);
    IF (already->>'reg_close_60') IS NULL
       AND now() >= t.reg_close - interval '60 minutes' AND now() < t.reg_close THEN
      msg_reg := format('⏰ Tornoi %s — Mikatona ato anatin''ny 1h ny inscription! (Mise: 5 000 Ar)', upper(t.game_type::text));
      INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
      SELECT admin_id, r.user_id, msg_reg, false
      FROM public.tournament_registrations r
      WHERE r.tournament_id = t.id AND r.cancelled_at IS NULL;
      UPDATE public.tournaments SET notified_phases = notified_phases || jsonb_build_object('reg_close_60', now()) WHERE id = t.id;
      sent := sent + 1;
    END IF;
    IF (already->>'qf_10') IS NULL
       AND now() >= t.qf_at - interval '10 minutes' AND now() < t.qf_at THEN
      msg_qf := format('🏆 Tornoi %s — Hanomboka ato anatin''ny 10mn! Mafofona automatique ao anaty table du jeu ianao.', upper(t.game_type::text));
      INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
      SELECT admin_id, r.user_id, msg_qf, false
      FROM public.tournament_registrations r
      WHERE r.tournament_id = t.id AND r.cancelled_at IS NULL;
      UPDATE public.tournaments SET notified_phases = notified_phases || jsonb_build_object('qf_10', now()) WHERE id = t.id;
      sent := sent + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'sent', sent);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_notify_phase() TO authenticated, anon;

-- 3) tournament_check_forfeit()
CREATE OR REPLACE FUNCTION public.tournament_check_forfeit()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m RECORD; g RECORD; forfeit_count int := 0; loser uuid; winner uuid;
        admin_id uuid; gt text;
BEGIN
  SELECT user_id INTO admin_id FROM public.user_roles WHERE role='admin' ORDER BY created_at LIMIT 1;
  FOR m IN
    SELECT tm.*, t.game_type::text AS gtype
    FROM public.tournament_matches tm
    JOIN public.tournaments t ON t.id = tm.tournament_id
    WHERE tm.winner_id IS NULL AND tm.started_at IS NOT NULL
      AND tm.started_at <= now() - interval '3 minutes' AND tm.game_id IS NOT NULL
  LOOP
    gt := m.gtype;
    loser := NULL; winner := NULL;
    IF gt = 'domino' THEN
      SELECT * INTO g FROM public.games WHERE id = m.game_id;
      IF g.status = 'in_progress' AND COALESCE(g.updated_at, m.started_at) <= now() - interval '3 minutes' THEN
        loser := COALESCE(g.current_turn, m.player1_id);
        winner := CASE WHEN loser = m.player1_id THEN m.player2_id ELSE m.player1_id END;
        UPDATE public.games SET status='cancelled', winner_id=winner, finished_at=now(), updated_at=now() WHERE id = g.id;
      END IF;
    ELSIF gt = 'ludo' THEN
      SELECT * INTO g FROM public.ludo_games WHERE id = m.game_id;
      IF g.status = 'in_progress' AND COALESCE(g.turn_started_at, m.started_at) <= now() - interval '3 minutes' THEN
        IF g.current_turn_seat = 1 THEN loser := g.player1_id;
        ELSIF g.current_turn_seat = 3 THEN loser := g.player2_id;
        ELSE loser := g.player1_id; END IF;
        winner := CASE WHEN loser = m.player1_id THEN m.player2_id ELSE m.player1_id END;
        UPDATE public.ludo_games SET status='finished', winner_id=winner, finished_at=now(), updated_at=now() WHERE id = g.id;
      END IF;
    ELSE
      SELECT * INTO g FROM public.petanque_games WHERE id = m.game_id;
      IF g.status = 'in_progress' AND COALESCE(g.updated_at, m.started_at) <= now() - interval '3 minutes' THEN
        loser := COALESCE(g.current_turn, m.player1_id);
        winner := CASE WHEN loser = m.player1_id THEN m.player2_id ELSE m.player1_id END;
        UPDATE public.petanque_games SET status='finished', winner_id=winner, finished_at=now(), updated_at=now() WHERE id = g.id;
      END IF;
    END IF;

    IF loser IS NOT NULL AND winner IS NOT NULL THEN
      UPDATE public.tournament_matches SET winner_id=winner, finished_at=now() WHERE id = m.id AND winner_id IS NULL;
      INSERT INTO public.audit_log(user_id, action, meta) VALUES (loser, 'tournament_forfeit',
        jsonb_build_object('tournament_id', m.tournament_id, 'match_id', m.id, 'round', m.round,
                           'game_type', gt, 'winner', winner, 'reason', 'no_activity_3min'));
      IF admin_id IS NOT NULL THEN
        INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
        VALUES (admin_id, loser, '❌ Forfait — Tsy nisy hetsika 3mn. Resy ianao.', false);
        INSERT INTO public.chat_messages(sender_id, recipient_id, content, is_admin_broadcast)
        VALUES (admin_id, winner, '✅ Mandresy noho ny forfait! Mandroso ianao.', false);
      END IF;
      forfeit_count := forfeit_count + 1;
    END IF;
  END LOOP;
  IF forfeit_count > 0 THEN PERFORM public.tournament_advance(NULL); END IF;
  RETURN jsonb_build_object('ok', true, 'forfeited', forfeit_count);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_check_forfeit() TO authenticated, anon;

-- 4) tournament_register: anti-duplicate + active match check + audit
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
  IF EXISTS (SELECT 1 FROM public.tournament_registrations
             WHERE tournament_id = tid AND lower(trim(id_card)) = lower(trim(_id_card)) AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'id_card_already_used'; END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_matches tm
             WHERE (tm.player1_id = uid OR tm.player2_id = uid)
               AND tm.winner_id IS NULL AND tm.game_id IS NOT NULL) THEN
    RAISE EXCEPTION 'has_active_tournament_match'; END IF;
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
  INSERT INTO public.audit_log(user_id, action, meta)
  VALUES (uid, 'tournament_register', jsonb_build_object('tournament_id', tid, 'game_type', _game_type, 'group', gl, 'slot', sl));
  RETURN jsonb_build_object('ok', true, 'group', gl, 'slot', sl);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_register(text,text,text,text,text) TO authenticated;

-- 5) Admin force tools
CREATE OR REPLACE FUNCTION public.tournament_admin_force_advance(_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;
  PERFORM public.tournament_advance(NULL);
  INSERT INTO public.audit_log(user_id, action, meta) VALUES (auth.uid(), 'tournament_force_advance', '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_admin_force_advance(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.tournament_admin_force_forfeit(_match_id uuid, _loser uuid, _pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m RECORD; winner uuid; admin_id uuid := auth.uid(); gt text;
BEGIN
  IF NOT public.has_role(admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;
  SELECT * INTO m FROM public.tournament_matches WHERE id = _match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'match_not_found'; END IF;
  IF m.winner_id IS NOT NULL THEN RAISE EXCEPTION 'already_finished'; END IF;
  IF _loser NOT IN (m.player1_id, m.player2_id) THEN RAISE EXCEPTION 'loser_not_in_match'; END IF;
  winner := CASE WHEN _loser = m.player1_id THEN m.player2_id ELSE m.player1_id END;
  SELECT t2.game_type::text INTO gt FROM public.tournaments t2 WHERE t2.id = m.tournament_id;
  IF gt = 'domino' THEN
    UPDATE public.games SET status='cancelled', winner_id=winner, finished_at=now(), updated_at=now() WHERE id = m.game_id;
  ELSIF gt = 'ludo' THEN
    UPDATE public.ludo_games SET status='finished', winner_id=winner, finished_at=now(), updated_at=now() WHERE id = m.game_id;
  ELSE
    UPDATE public.petanque_games SET status='finished', winner_id=winner, finished_at=now(), updated_at=now() WHERE id = m.game_id;
  END IF;
  UPDATE public.tournament_matches SET winner_id=winner, finished_at=now() WHERE id = m.id;
  INSERT INTO public.audit_log(user_id, action, meta) VALUES (admin_id, 'tournament_force_forfeit',
    jsonb_build_object('match_id', m.id, 'loser', _loser, 'winner', winner));
  PERFORM public.tournament_advance(NULL);
  RETURN jsonb_build_object('ok', true, 'winner', winner);
END $$;
GRANT EXECUTE ON FUNCTION public.tournament_admin_force_forfeit(uuid,uuid,text) TO authenticated;

-- 6) tournament_history
CREATE OR REPLACE FUNCTION public.tournament_history(_limit int DEFAULT 24, _game_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.week_start DESC), '[]'::jsonb)
  FROM (
    SELECT t.id, t.week_start, t.game_type, t.status, t.winner_id, t.runner_up_id, t.settled_at,
           (SELECT p.mvola_name FROM public.profiles p WHERE p.user_id = t.winner_id) AS winner_name,
           (SELECT p.mvola_name FROM public.profiles p WHERE p.user_id = t.runner_up_id) AS runner_up_name
    FROM public.tournaments t
    WHERE t.status IN ('finished','cancelled')
      AND (_game_type IS NULL OR t.game_type::text = _game_type)
    ORDER BY t.week_start DESC
    LIMIT _limit
  ) x;
$$;
GRANT EXECUTE ON FUNCTION public.tournament_history(int,text) TO authenticated, anon;

-- 7) tournament_leaderboard
CREATE OR REPLACE FUNCTION public.tournament_leaderboard(_game_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH wins AS (
    SELECT t.winner_id AS uid, count(*)::int AS trophies, (30000 * count(*))::int AS prize_w
    FROM public.tournaments t
    WHERE t.status='finished' AND t.winner_id IS NOT NULL
      AND (_game_type IS NULL OR t.game_type::text = _game_type)
    GROUP BY t.winner_id
  ),
  runners AS (
    SELECT t.runner_up_id AS uid, count(*)::int AS runner_ups, (6000 * count(*))::int AS prize_r
    FROM public.tournaments t
    WHERE t.status='finished' AND t.runner_up_id IS NOT NULL
      AND (_game_type IS NULL OR t.game_type::text = _game_type)
    GROUP BY t.runner_up_id
  ),
  match_wins AS (
    SELECT tm.winner_id AS uid, count(*)::int AS match_wins
    FROM public.tournament_matches tm
    JOIN public.tournaments t ON t.id = tm.tournament_id
    WHERE tm.winner_id IS NOT NULL
      AND (_game_type IS NULL OR t.game_type::text = _game_type)
    GROUP BY tm.winner_id
  ),
  all_users AS (
    SELECT uid FROM wins UNION SELECT uid FROM runners UNION SELECT uid FROM match_wins
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.trophies DESC, x.match_wins DESC, x.prize_total DESC), '[]'::jsonb)
  FROM (
    SELECT au.uid AS user_id,
           (SELECT mvola_name FROM public.profiles WHERE user_id = au.uid) AS name,
           (SELECT avatar_url FROM public.profiles WHERE user_id = au.uid) AS avatar_url,
           COALESCE(w.trophies, 0) AS trophies,
           COALESCE(r.runner_ups, 0) AS runner_ups,
           COALESCE(mw.match_wins, 0) AS match_wins,
           (COALESCE(w.prize_w,0) + COALESCE(r.prize_r,0))::int AS prize_total
    FROM all_users au
    LEFT JOIN wins w ON w.uid = au.uid
    LEFT JOIN runners r ON r.uid = au.uid
    LEFT JOIN match_wins mw ON mw.uid = au.uid
    ORDER BY trophies DESC, match_wins DESC, prize_total DESC
    LIMIT 20
  ) x;
$$;
GRANT EXECUTE ON FUNCTION public.tournament_leaderboard(text) TO authenticated, anon;

-- 8) Cron: notify + forfeit
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('tournament-notify-every-minute','tournament-forfeit-every-minute');
SELECT cron.schedule('tournament-notify-every-minute', '* * * * *', $$SELECT public.tournament_notify_phase();$$);
SELECT cron.schedule('tournament-forfeit-every-minute', '* * * * *', $$SELECT public.tournament_check_forfeit();$$);