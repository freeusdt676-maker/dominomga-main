-- Cancel all active/waiting/blocked games and refund stakes to players
DO $$
DECLARE
  g RECORD;
BEGIN
  FOR g IN SELECT * FROM public.games WHERE status IN ('waiting','in_progress','blocked') LOOP
    -- Refund player1
    IF g.player1_id IS NOT NULL AND g.stake IS NOT NULL THEN
      UPDATE public.wallets SET balance = balance + g.stake, updated_at = now() WHERE user_id = g.player1_id;
      INSERT INTO public.transactions (user_id, type, amount, status, game_id, admin_note)
      VALUES (g.player1_id, 'refund', g.stake, 'completed', g.id, 'Lalao nofoanan''ny admin');
    END IF;
    -- Refund player2
    IF g.player2_id IS NOT NULL AND g.stake IS NOT NULL THEN
      UPDATE public.wallets SET balance = balance + g.stake, updated_at = now() WHERE user_id = g.player2_id;
      INSERT INTO public.transactions (user_id, type, amount, status, game_id, admin_note)
      VALUES (g.player2_id, 'refund', g.stake, 'completed', g.id, 'Lalao nofoanan''ny admin');
    END IF;
    -- Mark cancelled
    UPDATE public.games
       SET status = 'cancelled',
           winner_id = NULL,
           current_turn = NULL,
           finished_at = now(),
           updated_at = now()
     WHERE id = g.id;
  END LOOP;
END $$;
