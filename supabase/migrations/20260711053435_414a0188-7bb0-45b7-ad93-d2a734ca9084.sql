
DROP POLICY IF EXISTS ludo_games_select_spectator ON public.ludo_games;
CREATE POLICY ludo_games_select_spectator ON public.ludo_games
FOR SELECT TO authenticated USING (true);
