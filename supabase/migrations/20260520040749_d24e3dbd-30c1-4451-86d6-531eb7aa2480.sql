
-- Refund all stakes for active games (waiting + in_progress) and cancel them
DO $$
DECLARE
  g RECORD;
  uid uuid;
  pids uuid[];
BEGIN
  -- DOMINO (public.games)
  FOR g IN SELECT id, stake, player1_id, player2_id, player3_id, players_count
           FROM public.games
           WHERE status IN ('waiting','in_progress')
  LOOP
    pids := ARRAY(SELECT x FROM unnest(ARRAY[g.player1_id, g.player2_id, g.player3_id]) AS x WHERE x IS NOT NULL);
    FOREACH uid IN ARRAY pids LOOP
      UPDATE public.wallets SET balance = balance + g.stake WHERE user_id = uid;
      INSERT INTO public.transactions (user_id, type, amount, status, game_id, admin_note, processed_at)
      VALUES (uid, 'refund', g.stake, 'completed', g.id, 'Refund: domino game cancelled (admin reset)', now());
    END LOOP;
    UPDATE public.games SET status = 'cancelled', finished_at = now(), last_reason = 'admin_reset_refund' WHERE id = g.id;
  END LOOP;

  -- LUDO
  FOR g IN SELECT id, stake, player1_id, player2_id, player3_id, player4_id
           FROM public.ludo_games
           WHERE status IN ('waiting','in_progress')
  LOOP
    pids := ARRAY(SELECT x FROM unnest(ARRAY[g.player1_id, g.player2_id, g.player3_id, g.player4_id]) AS x WHERE x IS NOT NULL);
    FOREACH uid IN ARRAY pids LOOP
      UPDATE public.wallets SET balance = balance + g.stake WHERE user_id = uid;
      INSERT INTO public.transactions (user_id, type, amount, status, admin_note, processed_at)
      VALUES (uid, 'refund', g.stake, 'completed', 'Refund: ludo game cancelled (admin reset) - ' || g.id::text, now());
    END LOOP;
    UPDATE public.ludo_games SET status = 'cancelled', finished_at = now() WHERE id = g.id;
  END LOOP;

  -- PETANQUE
  FOR g IN SELECT id, stake, player1_id, player2_id
           FROM public.petanque_games
           WHERE status IN ('waiting','in_progress')
  LOOP
    pids := ARRAY(SELECT x FROM unnest(ARRAY[g.player1_id, g.player2_id]) AS x WHERE x IS NOT NULL);
    FOREACH uid IN ARRAY pids LOOP
      UPDATE public.wallets SET balance = balance + g.stake WHERE user_id = uid;
      INSERT INTO public.transactions (user_id, type, amount, status, admin_note, processed_at)
      VALUES (uid, 'refund', g.stake, 'completed', 'Refund: petanque game cancelled (admin reset) - ' || g.id::text, now());
    END LOOP;
    UPDATE public.petanque_games SET status = 'cancelled', finished_at = now() WHERE id = g.id;
  END LOOP;
END $$;
