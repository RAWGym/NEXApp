-- Атомарное создание заявки: защита от дублей и не чаще одной заявки в 5 минут на пользователя.
-- Блокировка по пользователю исключает гонку при одновременных нажатиях.
create or replace function public.create_order_guarded(p jsonb, cooldown_sec int default 300)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid bigint := (p->>'user_id')::bigint;
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

  insert into public.orders (user_id, from_cur, to_cur, amount_from, amount_to, rate, fee_pct, fee_amount, method, details, note)
  values (uid, p->>'from_cur', p->>'to_cur', (p->>'amount_from')::numeric, (p->>'amount_to')::numeric, (p->>'rate')::numeric,
          (p->>'fee_pct')::numeric, (p->>'fee_amount')::numeric, p->>'method', p->>'details', p->>'note')
  returning * into o;
  return jsonb_build_object('order', to_jsonb(o));
end $$;

revoke all on function public.create_order_guarded(jsonb, int) from public, anon, authenticated;
grant execute on function public.create_order_guarded(jsonb, int) to service_role;
