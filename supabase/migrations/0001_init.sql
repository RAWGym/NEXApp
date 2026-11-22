-- NEX: схема базы. Доступ к таблицам только через Edge Function (service role), RLS включён без политик.

create table if not exists public.users (
  id bigint primary key,                       -- Telegram user id
  first_name text not null default '',
  last_name text,
  username text,
  photo_url text,
  phone text,
  kyc_status text not null default 'none' check (kyc_status in ('none','pending','verified','rejected')),
  kyc_note text,
  kyc jsonb,
  kyc_submitted_at timestamptz,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create sequence if not exists public.orders_id_seq start 1001;
create table if not exists public.orders (
  id bigint primary key default nextval('public.orders_id_seq'),
  user_id bigint not null references public.users(id),
  from_cur text not null,
  to_cur text not null,
  amount_from numeric not null check (amount_from > 0),
  amount_to numeric not null,
  rate numeric not null,
  fee_pct numeric not null,
  fee_amount numeric not null,
  method text not null,
  details text,
  note text,
  status text not null default 'new' check (status in ('new','accepted','completed','rejected','cancelled')),
  admin_note text,
  admin_msg_id bigint,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz
);
create index if not exists orders_user_idx on public.orders(user_id, created_at desc);
create index if not exists orders_status_idx on public.orders(status);

create table if not exists public.login_codes (
  code text primary key,
  user_id bigint references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.rate_alerts (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.users(id),
  base text not null,
  quote text not null,
  target numeric not null check (target > 0),
  direction text not null check (direction in ('above','below')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  fired_at timestamptz
);
create index if not exists rate_alerts_active_idx on public.rate_alerts(active) where active;

-- кэш курсов, чтобы не упираться в лимиты внешних API
create table if not exists public.kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.orders enable row level security;
alter table public.login_codes enable row level security;
alter table public.rate_alerts enable row level security;
alter table public.kv enable row level security;

-- приватное хранилище для документов верификации
insert into storage.buckets (id, name, public) values ('kyc', 'kyc', false) on conflict (id) do nothing;
