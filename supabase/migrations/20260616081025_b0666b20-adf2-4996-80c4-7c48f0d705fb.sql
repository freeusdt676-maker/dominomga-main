-- Fix petanque-autoplay: remove duplicate petanque_update_state overload (smallint version).
-- PostgREST fails with PGRST203 when two overloads match the same JSON args.
DROP FUNCTION IF EXISTS public.petanque_update_state(
  uuid, jsonb, uuid, timestamp with time zone, smallint, smallint, smallint
);

-- Increase cron tick frequency for both autoplay edge functions (2s instead of 5s)
-- so an expired turn fires within ~2s of the deadline.
DO $$
BEGIN
  PERFORM cron.unschedule('ludo-autoplay-tick');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('petanque-autoplay-tick');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'ludo-autoplay-tick',
  '2 seconds',
  $job$
  SELECT net.http_post(
    url := 'https://taucobvazpwzzhmapekh.supabase.co/functions/v1/ludo-autoplay',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhdWNvYnZhenB3enpobWFwZWtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNjE5NjksImV4cCI6MjA5MjkzNzk2OX0.nGwcrd200MVTTqoBaNqwQN4giMUGWTOH8-2ttyJOdcE"}'::jsonb,
    body := '{}'::jsonb
  );
  $job$
);

SELECT cron.schedule(
  'petanque-autoplay-tick',
  '2 seconds',
  $job$
  SELECT net.http_post(
    url := 'https://taucobvazpwzzhmapekh.supabase.co/functions/v1/petanque-autoplay',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhdWNvYnZhenB3enpobWFwZWtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNjE5NjksImV4cCI6MjA5MjkzNzk2OX0.nGwcrd200MVTTqoBaNqwQN4giMUGWTOH8-2ttyJOdcE"}'::jsonb,
    body := '{}'::jsonb
  );
  $job$
);