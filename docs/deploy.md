# Deploy — Vercel + Supabase

## 1. Supabase (one project for all tenants)
1. Create a project (region: `us-east-1` is closest to RD).
2. Apply `supabase/migrations/*.sql` in order: SQL editor, or `npx supabase link --project-ref <ref> && npx supabase db push`.
3. Auth → Providers: keep Email enabled; disable public sign-ups (owners are invited by you).
4. Copy URL, anon key and service-role key into Vercel env.

## 2. Vercel
1. Import the GitHub repo; framework preset Next.js; Node 22+.
2. Environment variables: everything in `.env.example` (Production + Preview). Set `APP_URL` to the production URL.
3. Crons: **Hobby allows only daily crons**, so they are split (all routes require `Authorization: Bearer <CRON_SECRET>` and only touch `integration_mode = 'live'` businesses; the demo tenant is skipped):

   | Job | Schedule | Scheduler |
   |---|---|---|
   | `demo-reset` | daily 08:00 UTC | `vercel.json` |
   | `package-nudges` | daily 14:00 UTC (10:00 RD) | `vercel.json` |
   | `reactivation-scan` | Mondays 12:00 UTC (08:00 RD) | `vercel.json` |
   | `holds-expiry` | every 10 min | Supabase `pg_cron` (step 5) |
   | `reminders` | hourly at :05 | Supabase `pg_cron` (step 5) |

   Never add a sub-daily cron to `vercel.json`: the Hobby deploy fails.
4. After the first deploy: `npm run seed:demo` against production env (or wait for the `demo-reset` cron).

5. **pg_cron (one time, after the app is deployed).** In the Supabase SQL editor, create the two Vault secrets the jobs read, using the production `APP_URL` and the **same** `CRON_SECRET` as in Vercel:

   ```sql
   select vault.create_secret('https://adv-keeper.vercel.app', 'keeper_app_url', 'Keeper APP_URL for pg_cron jobs');
   select vault.create_secret('<CRON_SECRET from Vercel>', 'keeper_cron_secret', 'Bearer token for /api/cron/*');
   ```

   Then apply `supabase/migrations/20261001000000_pg_cron.sql` (paste it in the SQL editor, or `npx supabase db push`). It enables `pg_cron` + `pg_net` and (re)schedules `keeper-holds-expiry` and `keeper-reminders`; it is safe to run again.

   Check it works (wait ~10 min after applying):

   ```sql
   select jobname, schedule, active from cron.job where jobname like 'keeper-%';
   select jobid, status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
   select status_code, left(content, 200) as body, created from net._http_response order by created desc limit 5;
   ```

   `status_code` should be `200` with `"ok":true`. A `401` means the Vault secret differs from Vercel's `CRON_SECRET`.
   To rotate the secret or change the domain later (no migration needed):

   ```sql
   select vault.update_secret((select id from vault.secrets where name = 'keeper_cron_secret'), '<new CRON_SECRET>');
   select vault.update_secret((select id from vault.secrets where name = 'keeper_app_url'), 'https://<new domain>');
   ```

   To pause the jobs: `select cron.unschedule('keeper-holds-expiry'); select cron.unschedule('keeper-reminders');`

## 3. Demo tenant
- Owner login: `DEMO_OWNER_EMAIL` / `DEMO_OWNER_PASSWORD`. Share these with prospects; the nightly reset restores data and password.
- Client chat: `/chat/<DEMO_BUSINESS_SLUG>`.
- Claude cost guard: `DEMO_MAX_MESSAGES_PER_SESSION`, `DEMO_DAILY_MESSAGE_BUDGET`.

## 4. Custom domain
Add the domain in Vercel and update `APP_URL` (and the Vault secret `keeper_app_url`, see 2.5). For live tenants, also update the WhatsApp webhook URL, the Google OAuth redirect URI and the gateway response/callback URLs.

## Checklist before a live tenant (P0)
- [ ] `npm run check` green on `main`
- [ ] RLS verified: an owner cannot read another business (two test users)
- [ ] Payment webhook signature verification enabled for the tenant's gateway
- [ ] WhatsApp templates approved
- [ ] Timeouts + retry/backoff on every external call (live adapters)
- [ ] Error alerting (Vercel log drain or Sentry)
