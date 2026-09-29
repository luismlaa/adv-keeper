# Deploy — Vercel + Supabase

## 1. Supabase (one project for all tenants)
1. Create a project (region: `us-east-1` is closest to RD).
2. Apply `supabase/migrations/*.sql` in order: SQL editor, or `npx supabase link --project-ref <ref> && npx supabase db push`.
3. Auth → Providers: keep Email enabled; disable public sign-ups (owners are invited by you).
4. Copy URL, anon key and service-role key into Vercel env.

## 2. Vercel
1. Import the GitHub repo; framework preset Next.js; Node 22+.
2. Environment variables: everything in `.env.example` (Production + Preview). Set `APP_URL` to the production URL.
3. Crons come from `vercel.json`. **Hobby allows only daily crons**. `holds-expiry` (every 10 min) and `reminders` (hourly) need **Pro**. On Hobby, schedule them with Supabase `pg_cron` + `pg_net` calling the same routes with the `CRON_SECRET` bearer.
4. After the first deploy: `npm run seed:demo` against production env (or wait for the `demo-reset` cron).

## 3. Demo tenant
- Owner login: `DEMO_OWNER_EMAIL` / `DEMO_OWNER_PASSWORD`. Share these with prospects; the nightly reset restores data and password.
- Client chat: `/chat/<DEMO_BUSINESS_SLUG>`.
- Claude cost guard: `DEMO_MAX_MESSAGES_PER_SESSION`, `DEMO_DAILY_MESSAGE_BUDGET`.

## 4. Custom domain
Add the domain in Vercel and update `APP_URL`. For live tenants, also update the WhatsApp webhook URL, the Google OAuth redirect URI and the gateway response/callback URLs.

## Checklist before a live tenant (P0)
- [ ] `npm run check` green on `main`
- [ ] RLS verified: an owner cannot read another business (two test users)
- [ ] Payment webhook signature verification enabled for the tenant's gateway
- [ ] WhatsApp templates approved
- [ ] Timeouts + retry/backoff on every external call (live adapters)
- [ ] Error alerting (Vercel log drain or Sentry)
