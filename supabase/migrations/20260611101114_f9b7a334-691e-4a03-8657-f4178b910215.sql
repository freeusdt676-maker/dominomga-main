CREATE OR REPLACE FUNCTION public.tournament_ensure_current()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ws timestamptz;
  rid uuid;
  st public.tournament_status;
  guard int := 0;
BEGIN
  ws := public.tournament_week_start_for(now());
  LOOP
    guard := guard + 1;
    EXIT WHEN guard > 8;

    SELECT id, status INTO rid, st FROM public.tournaments WHERE week_start = ws;

    IF rid IS NULL THEN
      INSERT INTO public.tournaments(week_start, reg_close, qf_at, sf_at, third_at, final_at, reset_at)
      VALUES (
        ws,
        ws + interval '5 days',
        ws + interval '5 days' + interval '14 hours',
        ws + interval '5 days' + interval '14 hours' + interval '40 minutes',
        ws + interval '5 days' + interval '15 hours' + interval '20 minutes',
        ws + interval '5 days' + interval '16 hours',
        ws + interval '6 days'
      )
      RETURNING id INTO rid;
      RETURN rid;
    END IF;

    IF st IN ('cancelled','finished') THEN
      ws := ws + interval '7 days';
      CONTINUE;
    END IF;

    RETURN rid;
  END LOOP;

  RETURN rid;
END $function$;