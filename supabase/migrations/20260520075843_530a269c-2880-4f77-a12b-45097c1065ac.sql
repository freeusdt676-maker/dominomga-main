
CREATE OR REPLACE FUNCTION public.admin_cancel_game_by_ticket(_ticket text, _admin_id uuid, _pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g_id uuid;
  lg_id uuid;
  pg_id uuid;
BEGIN
  IF _ticket IS NULL OR length(trim(_ticket)) = 0 THEN
    RAISE EXCEPTION 'ticket_required';
  END IF;

  SELECT id INTO g_id FROM public.games
  WHERE ticket_number = trim(_ticket) ORDER BY created_at DESC LIMIT 1;
  IF g_id IS NOT NULL THEN
    RETURN public.admin_cancel_domino_game(g_id, _admin_id, _pin);
  END IF;

  SELECT id INTO lg_id FROM public.ludo_games
  WHERE ticket_number = trim(_ticket) ORDER BY created_at DESC LIMIT 1;
  IF lg_id IS NOT NULL THEN
    RETURN public.admin_cancel_ludo_game(lg_id, _admin_id, _pin);
  END IF;

  SELECT id INTO pg_id FROM public.petanque_games
  WHERE ticket_number = trim(_ticket) ORDER BY created_at DESC LIMIT 1;
  IF pg_id IS NOT NULL THEN
    RETURN public.admin_cancel_petanque_game(pg_id, _admin_id, _pin);
  END IF;

  RAISE EXCEPTION 'ticket_not_found';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_cancel_all_active_games(_admin_id uuid, _pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g RECORD;
  domino_count integer := 0;
  ludo_count integer := 0;
  pet_count integer := 0;
BEGIN
  IF NOT public.has_role(_admin_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _pin <> '2583' THEN RAISE EXCEPTION 'pin_diso'; END IF;

  FOR g IN SELECT id FROM public.games WHERE status IN ('waiting', 'in_progress', 'blocked') LOOP
    PERFORM public.admin_cancel_domino_game(g.id, _admin_id, _pin);
    domino_count := domino_count + 1;
  END LOOP;

  FOR g IN SELECT id FROM public.ludo_games WHERE status IN ('waiting', 'in_progress', 'blocked') LOOP
    PERFORM public.admin_cancel_ludo_game(g.id, _admin_id, _pin);
    ludo_count := ludo_count + 1;
  END LOOP;

  FOR g IN SELECT id FROM public.petanque_games WHERE status IN ('waiting', 'in_progress', 'blocked') LOOP
    PERFORM public.admin_cancel_petanque_game(g.id, _admin_id, _pin);
    pet_count := pet_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'domino_cancelled', domino_count,
    'ludo_cancelled', ludo_count,
    'petanque_cancelled', pet_count,
    'total_cancelled', domino_count + ludo_count + pet_count
  );
END;
$function$;
