DO $$
DECLARE u uuid;
BEGIN
  FOR u IN SELECT user_id FROM public.profiles WHERE account_status='blocked' LOOP
    DELETE FROM public.password_reset_requests WHERE user_id=u;
    DELETE FROM public.transactions WHERE user_id=u;
    DELETE FROM public.matchmaking_queue WHERE user_id=u;
    DELETE FROM public.chat_messages WHERE sender_id=u OR recipient_id=u;
    DELETE FROM public.user_roles WHERE user_id=u;
    DELETE FROM public.wallets WHERE user_id=u;
    DELETE FROM public.profiles WHERE user_id=u;
    DELETE FROM auth.users WHERE id=u;
  END LOOP;
END $$;