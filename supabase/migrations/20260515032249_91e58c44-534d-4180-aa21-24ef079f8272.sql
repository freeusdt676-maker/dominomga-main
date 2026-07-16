REVOKE ALL ON FUNCTION public.admin_cancel_domino_game(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_ludo_game(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_game_by_ticket(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_all_active_games(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_cancel_domino_game(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_ludo_game(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_game_by_ticket(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_all_active_games(uuid, text) TO authenticated;