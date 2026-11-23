// Демо-данные панели для локальной сборки без адреса API. В рабочую сборку не попадают реальные данные.
/* eslint-disable @typescript-eslint/no-explicit-any */

let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
const NAMES = ['Айгерим', 'Данияр', 'Алина', 'Ерлан', 'Мария', 'Тимур', 'Асель', 'Нурлан', 'Дина', 'Руслан', 'Камила', 'Арман', 'Жанна', 'Олжас', 'Сабина']
const SUR = ['Сапарова', 'Ахметов', 'Ким', 'Нуриев', 'Иванова', 'Жумабаев', 'Ли', 'Омаров', 'Касымова', 'Бекова']
const PAIRS: [string, string, number][] = [
  ['USDT', 'KZT', 520],
  ['KZT', 'USDT', 1 / 525],
  ['USD', 'KZT', 518],
  ['BTC', 'KZT', 54_000_000],
  ['RUB', 'KZT', 5.6],
  ['KZT', 'RUB', 0.176],
]
const DAY = 86400_000
const now = Date.now()

const users = Array.from({ length: 140 }, (_, i) => {
  const created = now - Math.floor(rnd() * 120 * DAY)
  const kyc = rnd() < 0.35 ? 'verified' : rnd() < 0.15 ? 'pending' : rnd() < 0.08 ? 'rejected' : 'none'
  const vol = Math.floor(rnd() ** 3 * 30_000_000)
  const fn = pick(NAMES)
  return {
    id: 500000000 + i * 7919,
    first_name: fn,
    last_name: rnd() < 0.6 ? pick(SUR) : null,
    username: rnd() < 0.7 ? fn.toLowerCase().replace(/[^a-z]/g, '') + 'user' + i : null,
    photo_url: null,
    phone: '+7 70' + Math.floor(1e7 + rnd() * 9e7),
    phone_verified: rnd() < 0.8,
    full_name: kyc !== 'none' || rnd() < 0.5 ? `${pick(SUR)} ${fn}` : null,
    birth_date: '1994-05-12',
    profile_done: rnd() < 0.7,
    kyc_status: kyc,
    kyc_note: kyc === 'rejected' ? 'Фото документа нечитаемо' : null,
    kyc_submitted_at: kyc !== 'none' ? new Date(now - Math.floor(rnd() * 5 * DAY)).toISOString() : null,
    blocked: rnd() < 0.03,
    created_at: new Date(created).toISOString(),
    last_seen_at: new Date(now - Math.floor(rnd() * 10 * DAY)).toISOString(),
    bonus_kzt: Math.floor(rnd() * 6000),
    volume_kzt: vol,
    ref_earned_kzt: Math.floor(rnd() * 20000),
    ref_code: 'NEX' + (1000 + i),
  }
})

const orders = Array.from({ length: 260 }, (_, i) => {
  const [f, t, rate] = pick(PAIRS)
  const created = now - Math.floor(rnd() ** 1.4 * 90 * DAY)
  const kzt = Math.floor(20_000 + rnd() ** 2 * 2_500_000)
  const amountFrom = f === 'KZT' ? kzt : +(kzt / (f === 'BTC' ? 54_000_000 : f === 'RUB' ? 5.6 : 520)).toFixed(f === 'BTC' ? 5 : 2)
  const age = now - created
  const status = age < 30 * 60_000 ? pick(['new', 'new', 'accepted']) : age < 3 * 3600_000 ? pick(['new', 'accepted', 'completed']) : rnd() < 0.82 ? 'completed' : rnd() < 0.5 ? 'rejected' : 'cancelled'
  const u = pick(users)
  return {
    id: 1000 + i,
    user_id: u.id,
    status,
    from_cur: f,
    to_cur: t,
    amount_from: amountFrom,
    amount_to: +(amountFrom * rate * 0.97).toFixed(2),
    amount_kzt: kzt,
    rate,
    fee_pct: 3,
    fee_amount: +(amountFrom * rate * 0.03).toFixed(2),
    bonus_used_kzt: rnd() < 0.2 ? Math.floor(rnd() * 2000) : 0,
    method: pick(['Kaspi', 'Halyk', 'Наличные', 'TRC-20', 'Freedom']),
    details: pick(['Kaspi Gold 4400 **** 1234', 'TRC-20 TXy7…9fQ2', 'Halyk 4405 **** 8812', null]),
    note: rnd() < 0.2 ? 'Прошу побыстрее' : null,
    admin_note: null,
    created_at: new Date(created).toISOString(),
    accepted_at: status !== 'new' ? new Date(created + 5 * 60_000).toISOString() : null,
    completed_at: status === 'completed' ? new Date(created + 40 * 60_000).toISOString() : null,
    rejected_at: status === 'rejected' ? new Date(created + 20 * 60_000).toISOString() : null,
    user: { id: u.id, first_name: u.first_name, last_name: u.last_name, username: u.username, phone: u.phone, kyc_status: u.kyc_status },
  }
}).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

const team = [
  { id: 1, login: 'owner', name: 'Владелец', role: 'owner', tg_id: 1000001, active: true, locked_until: null, created_at: new Date(now - 20 * DAY).toISOString(), last_login_at: new Date(now - 3600_000).toISOString(), sessions: 1 },
  { id: 2, login: 'aliya.op', name: 'Алия', role: 'operator', tg_id: 1000002, active: true, locked_until: null, created_at: new Date(now - 10 * DAY).toISOString(), last_login_at: new Date(now - 7200_000).toISOString(), sessions: 1 },
  { id: 3, login: 'finance', name: 'Бухгалтерия', role: 'viewer', tg_id: 1000003, active: false, locked_until: null, created_at: new Date(now - 8 * DAY).toISOString(), last_login_at: null, sessions: 0 },
]
const audit = Array.from({ length: 40 }, (_, i) => ({
  id: 900 - i,
  action: pick(['login', 'order.accept', 'order.complete', 'kyc.approve', 'kyc.view', 'user.view', 'orders.export', 'user.bonus']),
  target: String(1000 + Math.floor(rnd() * 200)),
  meta: null,
  created_at: new Date(now - i * 47 * 60_000).toISOString(),
  admin_users: pick(team.slice(0, 2)),
}))

function stats(range: string) {
  const days = { week: 7, month: 30, quarter: 90, year: 365 }[range] ?? 30
  const bucket = days <= 30 ? 'day' : days <= 90 ? 'week' : 'month'
  const step = bucket === 'day' ? DAY : bucket === 'week' ? 7 * DAY : 30 * DAY
  const since = now - days * DAY
  const inRange = orders.filter((o) => Date.parse(o.created_at) >= since)
  const done = inRange.filter((o) => o.status === 'completed')
  const series = []
  for (let t = since; t < now; t += step) {
    const b = inRange.filter((o) => Date.parse(o.created_at) >= t && Date.parse(o.created_at) < t + step)
    const d = b.filter((o) => o.status === 'completed')
    const vol = d.reduce((s, o) => s + o.amount_kzt, 0)
    series.push({ t: new Date(t).toISOString(), orders: b.length, done: d.length, volume: vol, fee: vol * 0.03, bonus: d.reduce((s, o) => s + o.bonus_used_kzt, 0) })
  }
  const vol = done.reduce((s, o) => s + o.amount_kzt, 0)
  const pairs: Record<string, { n: number; volume: number }> = {}
  for (const o of done) {
    const k = `${o.from_cur} → ${o.to_cur}`
    pairs[k] = pairs[k] ?? { n: 0, volume: 0 }
    pairs[k].n++
    pairs[k].volume += o.amount_kzt
  }
  return {
    users_total: users.length,
    users_new: users.filter((u) => Date.parse(u.created_at) >= since).length,
    users_active: users.filter((u) => Date.parse(u.last_seen_at) >= since).length,
    users_profile: users.filter((u) => u.profile_done).length,
    users_verified: users.filter((u) => u.kyc_status === 'verified').length,
    users_blocked: users.filter((u) => u.blocked).length,
    kyc_pending: users.filter((u) => u.kyc_status === 'pending').length,
    orders_open: orders.filter((o) => o.status === 'new' || o.status === 'accepted').length,
    orders_new: orders.filter((o) => o.status === 'new').length,
    orders: inRange.length,
    orders_done: done.length,
    orders_rejected: inRange.filter((o) => o.status === 'rejected').length,
    orders_cancelled: inRange.filter((o) => o.status === 'cancelled').length,
    volume: vol,
    fee: vol * 0.03,
    bonus_spent: done.reduce((s, o) => s + o.bonus_used_kzt, 0),
    bonus_balance: users.reduce((s, u) => s + u.bonus_kzt, 0),
    ref_paid: users.reduce((s, u) => s + u.ref_earned_kzt, 0),
    avg_check: done.length ? vol / done.length : 0,
    series,
    users_series: series.map((s) => ({ t: s.t, n: users.filter((u) => Date.parse(u.created_at) >= Date.parse(s.t) && Date.parse(u.created_at) < Date.parse(s.t) + step).length })),
    pairs: Object.entries(pairs)
      .map(([pair, v]) => ({ pair, ...v }))
      .sort((a, b) => b.volume - a.volume),
    tiers: {
      standard: users.filter((u) => u.volume_kzt < 1e6).length,
      silver: users.filter((u) => u.volume_kzt >= 1e6 && u.volume_kzt < 5e6).length,
      gold: users.filter((u) => u.volume_kzt >= 5e6 && u.volume_kzt < 2e7).length,
      black: users.filter((u) => u.volume_kzt >= 2e7).length,
    },
    previous: { users_new: 18, orders: Math.round(inRange.length * 0.86), orders_done: Math.round(done.length * 0.9), volume: vol * 0.88, fee: vol * 0.03 * 0.88, bonus_spent: 1000 },
    range,
    bucket,
    since: new Date(since).toISOString(),
  }
}

const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const img = () =>
  new Response(
    new Blob(
      [
        `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#8f2434"/><stop offset="1" stop-color="#2a0c13"/></linearGradient></defs><rect width="640" height="420" rx="24" fill="url(#g)"/><rect x="40" y="110" width="150" height="190" rx="12" fill="#eae1d7" opacity=".25"/><g fill="#eae1d7" opacity=".55"><rect x="220" y="120" width="300" height="18" rx="9"/><rect x="220" y="160" width="240" height="18" rx="9"/><rect x="220" y="200" width="270" height="18" rx="9"/><rect x="220" y="240" width="180" height="18" rx="9"/></g><text x="40" y="70" fill="#eae1d7" font-family="sans-serif" font-size="26" font-weight="700">ДЕМО ДОКУМЕНТ</text></svg>`,
      ],
      { type: 'image/svg+xml' },
    ),
  )

let eventTick = 0
export async function demoApi(path: string, init: { method?: string; body?: any }): Promise<Response> {
  await new Promise((r) => setTimeout(r, 160 + rnd() * 200))
  const u = new URL(path, 'http://x')
  const p = u.pathname
  const q = u.searchParams
  const b = init.body ?? {}
  if (p === '/admin/auth/login') return b.password === 'wrong' ? ok({ error: 'Неверный логин или пароль' }, 401) : ok({ challenge: 'a'.repeat(32) })
  if (p === '/admin/auth/verify') return String(b.code) === '000000' ? ok({ error: 'Неверный код. Осталось попыток: 4' }, 400) : ok({ token: 'f'.repeat(64), admin: me })
  if (p === '/admin/auth/invite' && !init.method) return ok({ reset: false, login: null, name: 'Новый сотрудник', role: 'operator' })
  if (p === '/admin/auth/invite') return ok({ ok: true })
  if (p === '/admin/auth/logout') return ok({ ok: true })
  if (p === '/admin/me') return ok(me)
  if (p === '/admin/stats') return ok(stats(q.get('range') ?? 'month'))
  if (p === '/admin/events') {
    eventTick++
    const items = []
    if (q.get('since') && eventTick % 3 === 0) {
      const o = orders.find((x) => x.status === 'new') ?? orders[0]
      items.push({ type: 'order.new', id: o.id, at: new Date().toISOString(), who: '@' + (o.user.username ?? o.user.first_name), amount: o.amount_from, cur: o.from_cur, to: o.to_cur, kzt: o.amount_kzt })
    }
    return ok({ now: new Date().toISOString(), items, counts: { orders_new: orders.filter((o) => o.status === 'new').length, kyc_pending: users.filter((x) => x.kyc_status === 'pending').length } })
  }
  if (p === '/admin/orders') {
    let rows = orders
    const st = q.get('status')
    if (st && st !== 'all') rows = rows.filter((o) => (st === 'open' ? o.status === 'new' || o.status === 'accepted' : o.status === st))
    const term = q.get('q')
    if (term) rows = rows.filter((o) => String(o.id) === term || String(o.user_id) === term)
    const uid = Number(q.get('user') ?? 0)
    if (uid) rows = rows.filter((o) => o.user_id === uid)
    if (q.get('format') === 'csv') return new Response(new Blob(['id;status\n' + rows.map((r) => `${r.id};${r.status}`).join('\n')], { type: 'text/csv' }))
    const page = Number(q.get('page') ?? 0)
    return ok({ rows: rows.slice(page * 50, page * 50 + 50), total: rows.length, page, size: 50 })
  }
  let m = p.match(/^\/admin\/orders\/(\d+)\/(accept|complete|reject)$/)
  if (m) {
    const o = orders.find((x) => x.id === Number(m![1]))!
    o.status = m[2] === 'accept' ? 'accepted' : m[2] === 'complete' ? 'completed' : 'rejected'
    if (b.note) o.admin_note = b.note
    return ok(o)
  }
  m = p.match(/^\/admin\/orders\/(\d+)$/)
  if (m) {
    const o = orders.find((x) => x.id === Number(m![1]))!
    return ok({ ...o, user: { ...o.user, full_name: users.find((x) => x.id === o.user_id)?.full_name }, handled_by_name: o.status !== 'new' ? 'Алия' : null })
  }
  if (p === '/admin/users') {
    let rows = users.slice()
    const f = q.get('filter')
    if (f === 'verified' || f === 'pending') rows = rows.filter((x) => x.kyc_status === f)
    if (f === 'profile') rows = rows.filter((x) => x.profile_done)
    if (f === 'noprofile') rows = rows.filter((x) => !x.profile_done)
    if (f === 'blocked') rows = rows.filter((x) => x.blocked)
    if (f === 'vip') rows = rows.filter((x) => x.volume_kzt >= 1e6)
    const term = (q.get('q') ?? '').toLowerCase()
    if (term) rows = rows.filter((x) => `${x.first_name} ${x.last_name ?? ''} ${x.username ?? ''} ${x.id} ${x.phone}`.toLowerCase().includes(term.replace(/^@/, '')))
    const sort = q.get('sort')
    rows.sort((a, c) => (sort === 'volume' ? c.volume_kzt - a.volume_kzt : sort === 'seen' ? (c.last_seen_at > a.last_seen_at ? 1 : -1) : c.created_at > a.created_at ? 1 : -1))
    const page = Number(q.get('page') ?? 0)
    return ok({ rows: rows.slice(page * 50, page * 50 + 50), total: rows.length, page, size: 50 })
  }
  m = p.match(/^\/admin\/users\/(\d+)\/(block|unblock|bonus|kyc-reset)$/)
  if (m) {
    const x = users.find((y) => y.id === Number(m![1]))!
    if (m[2] === 'block' || m[2] === 'unblock') x.blocked = m[2] === 'block'
    if (m[2] === 'bonus') x.bonus_kzt += Number(b.delta)
    if (m[2] === 'kyc-reset') x.kyc_status = 'none'
    return ok({ ok: true, files: 3 })
  }
  m = p.match(/^\/admin\/users\/(\d+)$/)
  if (m) {
    const x = users.find((y) => y.id === Number(m![1]))!
    const tier = x.volume_kzt >= 2e7 ? ['black', 'Black', 1.5] : x.volume_kzt >= 5e6 ? ['gold', 'Gold', 1] : x.volume_kzt >= 1e6 ? ['silver', 'Silver', 0.5] : ['standard', 'Standard', 0]
    return ok({ ...x, loyalty: { tier: tier[0], tier_name: tier[1], tier_off: tier[2] }, referrals: Math.floor(rnd() * 6), orders: orders.filter((o) => o.user_id === x.id) })
  }
  if (p === '/admin/kyc') {
    const st = q.get('status') ?? 'pending'
    return ok({ rows: users.filter((x) => x.kyc_status === st).map((x) => ({ ...x, doc_type: pick(['id_card', 'passport']), auto_passed: rnd() < 0.7, checks_total: 7, checks_failed: rnd() < 0.7 ? 0 : 1 })) })
  }
  m = p.match(/^\/admin\/kyc\/(\d+)\/file\/\w+$/)
  if (m) return img()
  m = p.match(/^\/admin\/kyc\/(\d+)\/(approve|reject)$/)
  if (m) {
    users.find((y) => y.id === Number(m![1]))!.kyc_status = m[2] === 'approve' ? 'verified' : 'rejected'
    return ok({ ok: true })
  }
  m = p.match(/^\/admin\/kyc\/(\d+)$/)
  if (m) {
    const x = users.find((y) => y.id === Number(m![1]))!
    return ok({
      user: x,
      data: { full_name: x.full_name ?? `${x.last_name ?? 'Ахметов'} ${x.first_name}`, birth_date: '1990-01-01', citizenship: 'Казахстан', doc_type: 'id_card', doc_number: '049381726', personal_number: '900101300007', issue_date: '2019-03-14', expiry_date: '2029-03-13', issued_by: 'МВД РК', birth_place: 'г. Алматы', address: 'г. Алматы, пр. Абая 10, кв. 5', phone: x.phone },
      checks: [
        { label: 'Возраст 18+', ok: true },
        { label: 'Документ действителен', ok: true },
        { label: 'Дата выдачи раньше срока действия', ok: true },
        { label: 'ИИН корректен', ok: true },
        { label: 'ИИН совпадает с датой рождения', ok: true },
        { label: 'Формат номера документа', ok: true },
        { label: 'Телефон подтверждён', ok: x.phone_verified },
      ],
      auto_passed: x.phone_verified,
      files: ['doc_front', 'doc_back', 'selfie'],
    })
  }
  if (p === '/admin/audit') return ok({ rows: audit, total: audit.length, page: 0 })
  if (p === '/admin/team') return ok({ admins: team, sessions: [{ id: 'a1b2c3d4e5f6', admin_id: 1, ua: 'Chrome, macOS', created_at: new Date(now - 3600_000).toISOString(), last_seen_at: new Date().toISOString(), current: true }] })
  if (p === '/admin/team/invite') return ok({ link: location.origin + '/admin/#invite=' + 'd'.repeat(48), expires_in_min: 30 })
  m = p.match(/^\/admin\/team\/(\d+)\/(\w+)$/)
  if (m) return m[2] === 'reset' ? ok({ link: location.origin + '/admin/#invite=' + 'e'.repeat(48) }) : ok({ ok: true })
  if (p === '/admin/sessions/revoke-others') return ok({ ok: true })
  return ok({ error: 'Не найдено' }, 404)
}
const me = { id: 1, login: 'owner', name: 'Владелец', role: 'owner', perms: ['stats', 'finance', 'orders.read', 'orders.act', 'orders.export', 'users.read', 'users.pii', 'users.block', 'users.bonus', 'kyc.read', 'kyc.act', 'kyc.reset', 'audit.read', 'team.read', 'team.manage'] }
