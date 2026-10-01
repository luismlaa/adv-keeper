-- Keeper — frequent crons on Supabase (Vercel Hobby only allows daily crons).
--   keeper-holds-expiry : every 10 minutes → GET <APP_URL>/api/cron/holds-expiry
--   keeper-reminders    : hourly at :05     → GET <APP_URL>/api/cron/reminders
-- Both send `Authorization: Bearer <CRON_SECRET>`. The URL and the secret are read from Supabase Vault
-- at run time (secrets `keeper_app_url` and `keeper_cron_secret`), so nothing secret lives in git.
-- Create the two Vault secrets BEFORE applying this migration (docs/deploy.md → "pg_cron").
-- Idempotent: re-running it unschedules and re-creates both jobs.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  job text;
begin
  foreach job in array array['keeper-holds-expiry', 'keeper-reminders'] loop
    if exists (select 1 from cron.job where jobname = job) then
      perform cron.unschedule(job);
    end if;
  end loop;
end
$$;

select cron.schedule(
  'keeper-holds-expiry',
  '*/10 * * * *',
  $job$
  select net.http_get(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'keeper_app_url'), '/') || '/api/cron/holds-expiry',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'keeper_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $job$
);

select cron.schedule(
  'keeper-reminders',
  '5 * * * *',
  $job$
  select net.http_get(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'keeper_app_url'), '/') || '/api/cron/reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'keeper_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $job$
);
