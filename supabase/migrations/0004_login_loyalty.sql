-- Вход по номеру телефона с кодом из бота, личные данные, программа лояльности и рефералы.

alter table public.users add column if not exists phone_verified boolean not null default false;
alter table public.users add column if not exists profile_enc text;          -- ФИО и дата рождения, AES-256-GCM
alter table public.users add column if not exists profile_done boolean not null default false;
alter table public.users add column if not exists ref_code text;
alter table public.users add column if not exists referred_by bigint references public.users(id);
alter table public.users add column if not exists bonus_kzt numeric not null default 0 check (bonus_kzt >= 0);
alter table public.users add column if not exists volume_kzt numeric not null default 0;
alter table public.users add column if not exists ref_earned_kzt numeric not null default 0;
create unique index if not exists users_ref_code_idx on public.users (ref_code) where ref_code is not null;
create index if not exists users_phone_verified_idx on public.users (phone) where phone_verified;
create index if not exists users_referred_by_idx on public.users (referred_by);

alter table public.orders add column if not exists amount_kzt numeric;
alter table public.orders add column if not exists fee_base_pct numeric;
alter table public.orders add column if not exists discounts jsonb;
alter table public.orders add column if not exists bonus_used_kzt numeric not null default 0;
alter table public.orders add column if not exists bonus_used numeric not null default 0;  -- в валюте получения

-- Сессии входа по номеру: код хранится только в виде хэша
create table if not exists public.phone_logins (
  sid text primary key,
  phone text not null,
  ip_hash text,
  tg_user_id bigint,
  user_id bigint references public.users(id),
  otp_hash text,
  otp_sent_at timestamptz,
  sends int not null default 0,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.phone_logins enable row level security;
create index if not exists phone_logins_phone_idx on public.phone_logins (phone, created_at);
create index if not exists phone_logins_tg_idx on public.phone_logins (tg_user_id, created_at);

-- Начисления на баланс пользователя (бонусы и оборот) одной атомарной операцией
create or replace function public.user_credit(uid bigint, bonus numeric, volume numeric, ref_earned numeric default 0)
returns void language sql security definer set search_path = public as $$
  update public.users
     set bonus_kzt = greatest(0, bonus_kzt + bonus),
         volume_kzt = volume_kzt + volume,
         ref_earned_kzt = ref_earned_kzt + ref_earned
   where id = uid;
$$;
revoke all on function public.user_credit(bigint, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.user_credit(bigint, numeric, numeric, numeric) to service_role;

-- Атомарное создание заявки: защита от дублей, пауза между заявками, списание бонусов.
create or replace function public.create_order_guarded(p jsonb, cooldown_sec int default 300)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid bigint := (p->>'user_id')::bigint;
  bonus numeric := coalesce((p->>'bonus_used_kzt')::numeric, 0);
  dup record;
  last_at timestamptz;
  o public.orders;
begin
  perform pg_advisory_xact_lock(uid);

  select id, status into dup from public.orders
   where user_id = uid and status in ('new','accepted')
     and from_cur = p->>'from_cur' and to_cur = p->>'to_cur'
     and abs(amount_from - (p->>'amount_from')::numeric) <= greatest(0.01 * (p->>'amount_from')::numeric, 0.00000001)
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('error', 'duplicate', 'order_id', dup.id);
  end if;

  select max(created_at) into last_at from public.orders where user_id = uid;
  if last_at is not null and last_at > now() - make_interval(secs => cooldown_sec) then
    return jsonb_build_object('error', 'cooldown', 'retry_after', ceil(extract(epoch from (last_at + make_interval(secs => cooldown_sec) - now()))));
  end if;

  if bonus > 0 then
    update public.users set bonus_kzt = bonus_kzt - bonus where id = uid and bonus_kzt >= bonus;
    if not found then
      return jsonb_build_object('error', 'bonus');
    end if;
  end if;

  insert into public.orders (user_id, from_cur, to_cur, amount_from, amount_to, rate, fee_pct, fee_amount, method, details, note,
                             amount_kzt, fee_base_pct, discounts, bonus_used_kzt, bonus_used)
  values (uid, p->>'from_cur', p->>'to_cur', (p->>'amount_from')::numeric, (p->>'amount_to')::numeric, (p->>'rate')::numeric,
          (p->>'fee_pct')::numeric, (p->>'fee_amount')::numeric, p->>'method', p->>'details', p->>'note',
          (p->>'amount_kzt')::numeric, (p->>'fee_base_pct')::numeric, p->'discounts', bonus, coalesce((p->>'bonus_used')::numeric, 0))
  returning * into o;
  return jsonb_build_object('order', to_jsonb(o));
end $$;

revoke all on function public.create_order_guarded(jsonb, int) from public, anon, authenticated;
grant execute on function public.create_order_guarded(jsonb, int) to service_role;
