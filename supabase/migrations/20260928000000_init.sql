-- Keeper — initial schema (multi-tenant, RLS on every table).
-- Money is integer minor units (centavos). Timestamps are timestamptz (UTC); local time lives in business settings.

create extension if not exists btree_gist;

-- ─────────────────────────── tenancy ───────────────────────────
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,48}$'),
  name text not null,
  integration_mode text not null default 'demo' check (integration_mode in ('demo', 'live')),
  payment_provider text not null default 'fake' check (payment_provider in ('fake', 'azul', 'cardnet')),
  google_calendar_id text,
  whatsapp_phone_number_id text unique,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);

-- SECURITY DEFINER so policies can consult memberships without recursive RLS evaluation.
create or replace function public.is_member(target_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.business_id = target_business and m.user_id = auth.uid()
  );
$$;

-- ─────────────────────────── catalog ───────────────────────────
create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  description text not null default '',
  category text not null default 'general',
  duration_min integer not null check (duration_min > 0),
  price_minor integer not null check (price_minor >= 0),
  deposit_override_minor integer check (deposit_override_minor >= 0),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index services_business_idx on public.services (business_id) where active;

create table public.package_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete restrict,
  name text not null,
  sessions_total integer not null check (sessions_total > 0),
  price_minor integer not null check (price_minor >= 0),
  interval_days integer not null check (interval_days > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─────────────────────────── clients ───────────────────────────
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text,
  phone text not null,
  email text,
  notes text,
  last_visit_at timestamptz,
  last_reengaged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, phone)
);
create index clients_last_visit_idx on public.clients (business_id, last_visit_at);

create table public.client_packages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  package_template_id uuid not null references public.package_templates (id) on delete restrict,
  sessions_total integer not null check (sessions_total > 0),
  sessions_used integer not null default 0 check (sessions_used >= 0),
  status text not null default 'active' check (status in ('active', 'completed', 'expired')),
  purchased_at timestamptz not null default now(),
  expires_at timestamptz,
  check (sessions_used <= sessions_total)
);
create index client_packages_client_idx on public.client_packages (business_id, client_id);

-- ─────────────────────────── bookings ───────────────────────────
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete restrict,
  client_package_id uuid references public.client_packages (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('hold_pending_deposit', 'confirmed', 'completed', 'no_show', 'cancelled', 'expired')),
  price_minor integer not null check (price_minor >= 0),
  deposit_minor integer not null check (deposit_minor >= 0),
  hold_expires_at timestamptz,
  calendar_event_id text,
  source text not null default 'chat' check (source in ('chat', 'whatsapp', 'owner')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- MVP: one resource (cabin/professional) per business — no two live bookings may overlap.
  constraint appointments_no_overlap exclude using gist (
    business_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('hold_pending_deposit', 'confirmed'))
);
create unique index appointments_idempotency_idx
  on public.appointments (business_id, client_id, starts_at)
  where status in ('hold_pending_deposit', 'confirmed');
create index appointments_range_idx on public.appointments (business_id, starts_at);
create index appointments_holds_idx on public.appointments (hold_expires_at) where status = 'hold_pending_deposit';

create table public.deposits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  provider text not null check (provider in ('fake', 'azul', 'cardnet')),
  link_id text not null unique,
  url text not null,
  amount_minor integer not null check (amount_minor > 0),
  currency char(3) not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'refunded')),
  provider_txn_id text unique,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index deposits_appointment_idx on public.deposits (business_id, appointment_id);

-- ─────────────────────────── conversations ───────────────────────────
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  channel text not null check (channel in ('web', 'whatsapp')),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index conversations_client_idx on public.conversations (business_id, client_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('client', 'assistant', 'owner', 'system')),
  content text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ─────────────────────────── owner workflow ───────────────────────────
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  kind text not null check (kind in ('discount', 'off_menu_price', 'cancellation', 'refund', 'other')),
  details text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id)
);
create index approval_requests_pending_idx on public.approval_requests (business_id) where status = 'pending';

create table public.notifications_sent (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  kind text not null check (kind in ('day_before_reminder', 'package_nudge', 'reactivation', 'deposit_link')),
  dedupe_key text not null unique,
  channel text not null,
  sent_at timestamptz not null default now()
);

-- Google OAuth refresh tokens, encrypted by the app (AES-256-GCM, ENCRYPTION_KEY). Service role only.
create table public.integrations (
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null check (provider in ('google_calendar')),
  encrypted_refresh_token text not null,
  account_email text,
  connected_at timestamptz not null default now(),
  primary key (business_id, provider)
);

create table public.activity_log (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  actor text not null,
  entity text not null,
  entity_id text,
  action text not null,
  reason text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_business_idx on public.activity_log (business_id, created_at desc);

-- ─────────────────────────── triggers ───────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger appointments_touch before update on public.appointments
  for each row execute function public.touch_updated_at();

-- A completed visit updates the client's last visit (drives the reactivation list).
create or replace function public.bump_last_visit()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.clients
      set last_visit_at = greatest(coalesce(last_visit_at, new.starts_at), new.starts_at)
      where id = new.client_id;
  end if;
  return new;
end;
$$;

create trigger appointments_bump_last_visit after update on public.appointments
  for each row execute function public.bump_last_visit();

-- ─────────────────────────── RLS ───────────────────────────
alter table public.businesses enable row level security;
alter table public.memberships enable row level security;
alter table public.services enable row level security;
alter table public.package_templates enable row level security;
alter table public.clients enable row level security;
alter table public.client_packages enable row level security;
alter table public.appointments enable row level security;
alter table public.deposits enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.approval_requests enable row level security;
alter table public.notifications_sent enable row level security;
alter table public.integrations enable row level security;
alter table public.activity_log enable row level security;

create policy businesses_member_select on public.businesses for select using (public.is_member(id));
create policy businesses_member_update on public.businesses for update using (public.is_member(id)) with check (public.is_member(id));

create policy memberships_own_select on public.memberships for select using (user_id = auth.uid());

-- Owner dashboard: full read/write within her own business.
create policy services_member_all on public.services for all using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy package_templates_member_all on public.package_templates for all using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy clients_member_all on public.clients for all using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy client_packages_member_all on public.client_packages for all using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy appointments_member_all on public.appointments for all using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy approval_requests_member_all on public.approval_requests for all using (public.is_member(business_id)) with check (public.is_member(business_id));

-- Read-only for owners; written by the server (service role) only.
create policy deposits_member_select on public.deposits for select using (public.is_member(business_id));
create policy conversations_member_select on public.conversations for select using (public.is_member(business_id));
create policy messages_member_select on public.messages for select using (public.is_member(business_id));
create policy notifications_member_select on public.notifications_sent for select using (public.is_member(business_id));
create policy activity_log_member_select on public.activity_log for select using (public.is_member(business_id));

-- integrations: no policies → only the service role can read/write tokens.
