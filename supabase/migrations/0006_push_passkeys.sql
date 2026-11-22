-- Push-уведомления на телефон и вход по Face ID / Touch ID (passkeys, WebAuthn).
-- Доступ только у Edge Function: RLS включён без политик.

create table if not exists public.push_subs (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subs_user_idx on public.push_subs(user_id);

create table if not exists public.passkeys (
  id text primary key,                                -- credential id (base64url)
  user_id bigint not null references public.users(id) on delete cascade,
  public_key text not null,                           -- COSE, base64
  counter bigint not null default 0,
  transports text[],
  device text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists passkeys_user_idx on public.passkeys(user_id);

create table if not exists public.webauthn_challenges (
  id text primary key,
  user_id bigint references public.users(id) on delete cascade,
  kind text not null check (kind in ('register','login')),
  challenge text not null,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists webauthn_challenges_ip_idx on public.webauthn_challenges(ip_hash, created_at);

alter table public.push_subs enable row level security;
alter table public.passkeys enable row level security;
alter table public.webauthn_challenges enable row level security;
