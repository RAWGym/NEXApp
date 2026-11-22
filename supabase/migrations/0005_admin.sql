-- Админ-панель: учётные записи сотрудников, приглашения, вход в два шага, сессии и журнал действий.
-- Все таблицы закрыты RLS без политик: доступ только у Edge Function (service role).

create table if not exists public.admin_users (
  id bigint generated always as identity primary key,
  login text not null unique check (login ~ '^[a-z0-9._-]{3,32}$'),
  name text not null default '',
  pass_hash text,                                    -- pbkdf2-sha256$iter$salt$hash
  role text not null check (role in ('owner','admin','operator','viewer')),
  tg_id bigint not null unique,                      -- куда бот присылает коды входа
  active boolean not null default true,
  failed int not null default 0,
  locked_until timestamptz,
  created_by bigint references public.admin_users(id),
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  notify jsonb not null default '{"orders":true,"kyc":true,"users":false}'
);

create table if not exists public.admin_invites (
  token_hash text primary key,
  admin_id bigint references public.admin_users(id) on delete cascade,   -- сброс пароля существующему
  role text check (role in ('owner','admin','operator','viewer')),
  tg_id bigint,
  name text,
  created_by bigint references public.admin_users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists public.admin_challenges (
  id text primary key,
  admin_id bigint not null references public.admin_users(id) on delete cascade,
  code_hash text not null,
  attempts int not null default 0,
  ip_hash text,
  ua_hash text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.admin_sessions (
  id text primary key,                               -- sha-256 от токена, сам токен не хранится
  admin_id bigint not null references public.admin_users(id) on delete cascade,
  ip_hash text,
  ua_hash text,
  ua text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists admin_sessions_admin_idx on public.admin_sessions(admin_id);

create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  admin_id bigint references public.admin_users(id) on delete set null,
  action text not null,
  target text,
  meta jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit(created_at desc);

-- попытки входа для ограничения перебора (по IP и по логину)
create table if not exists public.admin_attempts (
  id bigint generated always as identity primary key,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_attempts_key_idx on public.admin_attempts(key, created_at);

alter table public.orders add column if not exists handled_by bigint references public.admin_users(id);
alter table public.orders add column if not exists rejected_at timestamptz;
alter table public.users add column if not exists kyc_reviewed_by bigint references public.admin_users(id);
alter table public.users add column if not exists kyc_reviewed_at timestamptz;
create index if not exists orders_created_idx on public.orders(created_at desc);
create index if not exists users_created_idx on public.users(created_at desc);

alter table public.admin_users enable row level security;
alter table public.admin_invites enable row level security;
alter table public.admin_challenges enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_audit enable row level security;
alter table public.admin_attempts enable row level security;

-- Журнал нельзя менять задним числом даже через API: только добавление
create or replace function public.admin_audit_readonly() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'admin_audit is append-only';
end $$;
drop trigger if exists admin_audit_no_change on public.admin_audit;
create trigger admin_audit_no_change before update or delete on public.admin_audit
  for each row execute function public.admin_audit_readonly();

-- Сводка для обзора и финансов одним запросом (суммы в тенге)
create or replace function public.admin_stats(since timestamptz, bucket text default 'day')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with o as (
    select * from orders where created_at >= since
  ),
  series as (
    select date_trunc(bucket, created_at) as t,
           count(*) as orders,
           count(*) filter (where status = 'completed') as done,
           coalesce(sum(amount_kzt) filter (where status = 'completed'), 0) as volume,
           coalesce(sum(amount_kzt * fee_pct / 100) filter (where status = 'completed'), 0) as fee,
           coalesce(sum(bonus_used_kzt) filter (where status = 'completed'), 0) as bonus
      from o group by 1 order by 1
  ),
  users_series as (
    select date_trunc(bucket, created_at) as t, count(*) as n from users where created_at >= since group by 1
  ),
  pairs as (
    select from_cur || '→' || to_cur as pair, count(*) as n, coalesce(sum(amount_kzt), 0) as volume
      from o where status = 'completed' group by 1 order by 3 desc limit 8
  )
  select jsonb_build_object(
    'users_total', (select count(*) from users),
    'users_new', (select count(*) from users where created_at >= since),
    'users_active', (select count(*) from users where last_seen_at >= since),
    'users_profile', (select count(*) from users where profile_done),
    'users_verified', (select count(*) from users where kyc_status = 'verified'),
    'users_blocked', (select count(*) from users where blocked),
    'kyc_pending', (select count(*) from users where kyc_status = 'pending'),
    'orders_open', (select count(*) from orders where status in ('new','accepted')),
    'orders_new', (select count(*) from orders where status = 'new'),
    'orders', (select count(*) from o),
    'orders_done', (select count(*) from o where status = 'completed'),
    'orders_rejected', (select count(*) from o where status = 'rejected'),
    'orders_cancelled', (select count(*) from o where status = 'cancelled'),
    'volume', (select coalesce(sum(amount_kzt), 0) from o where status = 'completed'),
    'fee', (select coalesce(sum(amount_kzt * fee_pct / 100), 0) from o where status = 'completed'),
    'bonus_spent', (select coalesce(sum(bonus_used_kzt), 0) from o where status = 'completed'),
    'bonus_balance', (select coalesce(sum(bonus_kzt), 0) from users),
    'ref_paid', (select coalesce(sum(ref_earned_kzt), 0) from users),
    'avg_check', (select coalesce(avg(amount_kzt), 0) from o where status = 'completed'),
    'series', coalesce((select jsonb_agg(jsonb_build_object('t', t, 'orders', orders, 'done', done, 'volume', volume, 'fee', fee, 'bonus', bonus)) from series), '[]'),
    'users_series', coalesce((select jsonb_agg(jsonb_build_object('t', t, 'n', n) order by t) from users_series), '[]'),
    'pairs', coalesce((select jsonb_agg(jsonb_build_object('pair', pair, 'n', n, 'volume', volume)) from pairs), '[]'),
    'tiers', (select jsonb_build_object(
        'standard', count(*) filter (where volume_kzt < 1000000),
        'silver', count(*) filter (where volume_kzt >= 1000000 and volume_kzt < 5000000),
        'gold', count(*) filter (where volume_kzt >= 5000000 and volume_kzt < 20000000),
        'black', count(*) filter (where volume_kzt >= 20000000)) from users)
  );
$$;
revoke all on function public.admin_stats(timestamptz, text) from public, anon, authenticated;
