-- Schedule tournament_advance every minute for all 3 game types via pg_cron
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'tournament-advance-every-minute';

SELECT cron.schedule(
  'tournament-advance-every-minute',
  '* * * * *',
  $$SELECT public.tournament_advance(NULL);$$
);