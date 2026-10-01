-- Per-business integration credentials (M2).
-- Each business is its own merchant (Azul / Cardnet) and connects its own Google Calendar, so their
-- secrets live here, AES-256-GCM encrypted by the app (src/lib/crypto.ts) — never in global env vars.
-- The table has no rows yet, so the column is generalised in place.

alter table public.integrations rename column encrypted_refresh_token to encrypted_credentials;

do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.integrations'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%provider%'
  loop
    execute format('alter table public.integrations drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.integrations
  add constraint integrations_provider_check check (provider in ('google_calendar', 'azul', 'cardnet'));

alter table public.integrations add column updated_at timestamptz not null default now();

comment on column public.integrations.encrypted_credentials is
  'AES-256-GCM (ENCRYPTION_KEY) of a provider-specific JSON object: google_calendar {refreshToken, calendarId}; azul/cardnet merchant credentials.';

-- WhatsApp inbound dedupe (Track D1): Meta may deliver the same message more than once, even concurrently.
-- The webhook records one `whatsapp_inbound` row per wamid before processing; this makes that atomic.
create unique index activity_log_whatsapp_inbound_dedupe_idx
  on public.activity_log (business_id, entity_id)
  where action = 'whatsapp_inbound';
