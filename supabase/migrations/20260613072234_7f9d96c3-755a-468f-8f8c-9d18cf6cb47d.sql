
CREATE OR REPLACE FUNCTION public.trg_block_locked_game()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.is_tournament, false) = true THEN RETURN NEW; END IF;
  IF (NEW.player1_id IS NOT NULL AND public.tournament_player_locked(NEW.player1_id))
     OR (NEW.player2_id IS NOT NULL AND public.tournament_player_locked(NEW.player2_id)) THEN
    RAISE EXCEPTION 'Mpisoratra anarana amin''ny Tornoi du Semaine — tsy afaka milalao lalao tsotra mandritra ny tornoi';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_block_locked_game_p3()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.is_tournament, false) = true THEN RETURN NEW; END IF;
  IF (NEW.player1_id IS NOT NULL AND public.tournament_player_locked(NEW.player1_id))
     OR (NEW.player2_id IS NOT NULL AND public.tournament_player_locked(NEW.player2_id))
     OR (NEW.player3_id IS NOT NULL AND public.tournament_player_locked(NEW.player3_id)) THEN
    RAISE EXCEPTION 'Mpisoratra anarana amin''ny Tornoi du Semaine — tsy afaka milalao lalao tsotra mandritra ny tornoi';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_block_locked_challenge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.tournament_player_locked(NEW.from_user) OR public.tournament_player_locked(NEW.to_user) THEN
    RAISE EXCEPTION 'Mpisoratra anarana amin''ny Tornoi du Semaine — tsy afaka milalao lalao tsotra mandritra ny tornoi';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_block_locked_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.tournament_player_locked(NEW.user_id) THEN
    RAISE EXCEPTION 'Mpisoratra anarana amin''ny Tornoi du Semaine — tsy afaka milalao lalao tsotra mandritra ny tornoi';
  END IF;
  RETURN NEW;
END $$;
