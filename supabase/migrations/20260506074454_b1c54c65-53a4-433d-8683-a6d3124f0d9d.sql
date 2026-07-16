REVOKE ALL ON FUNCTION public.player_update_game_state(uuid, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, integer, public.game_status) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_waiting_game(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.player_update_game_state(uuid, jsonb, jsonb, jsonb, jsonb, uuid, timestamptz, integer, public.game_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_waiting_game(uuid) TO authenticated;