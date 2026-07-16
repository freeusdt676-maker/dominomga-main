DO $$
BEGIN
  PERFORM cron.unschedule('domino-autoplay-tick');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'domino-autoplay-tick',
  '2 seconds',
  $job$
  SELECT net.http_post(
    url := 'https://taucobvazpwzzhmapekh.supabase.co/functions/v1/domino-autoplay',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhdWNvYnZhenB3enpobWFwZWtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNjE5NjksImV4cCI6MjA5MjkzNzk2OX0.nGwcrd200MVTTqoBaNqwQN4giMUGWTOH8-2ttyJOdcE"}'::jsonb,
    body := '{}'::jsonb
  );
  $job$
);