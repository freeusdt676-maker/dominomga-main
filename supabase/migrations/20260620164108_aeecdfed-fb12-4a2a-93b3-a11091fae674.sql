CREATE OR REPLACE FUNCTION public.trg_push_game()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  kind text := TG_ARGV[0];
BEGIN
  PERFORM public.notify_push('admins', NULL,
    '🎲 Lalao vaovao',
    kind||' • mise '||COALESCE(NEW.stake::text, '?')||' Ar',
    '/admin', kind||'-'||NEW.id::text);
  RETURN NEW;
END;
$$;