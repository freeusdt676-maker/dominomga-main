
REVOKE EXECUTE ON FUNCTION public.start_game_deduct(UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.settle_game(UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.start_game_deduct(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_game(UUID, UUID) TO authenticated;
