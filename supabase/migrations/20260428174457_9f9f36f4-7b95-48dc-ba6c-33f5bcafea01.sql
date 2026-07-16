
-- Famafana ireo mpisoratra anarana tsy admin (hanaovana test vaovao)
DO $$
DECLARE
  uid UUID;
BEGIN
  FOR uid IN
    SELECT u.id FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'admin')
  LOOP
    DELETE FROM public.transactions WHERE user_id = uid;
    DELETE FROM public.password_reset_requests WHERE user_id = uid;
    DELETE FROM public.matchmaking_queue WHERE user_id = uid;
    DELETE FROM public.challenges WHERE from_user = uid OR to_user = uid;
    DELETE FROM public.chat_messages WHERE sender_id = uid OR recipient_id = uid;
    DELETE FROM public.game_moves WHERE player_id = uid;
    DELETE FROM public.games WHERE player1_id = uid OR player2_id = uid;
    DELETE FROM public.wallets WHERE user_id = uid;
    DELETE FROM public.user_roles WHERE user_id = uid;
    DELETE FROM public.profiles WHERE user_id = uid;
    DELETE FROM auth.users WHERE id = uid;
  END LOOP;
END $$;
