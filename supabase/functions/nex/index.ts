// NEX backend: API для мини-приложения + вебхук Telegram-бота + проверка уведомлений о курсе.
// Секреты: BOT_TOKEN, ADMIN_IDS (через запятую), WEBAPP_URL, CRON_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

// Настройки берутся из секретов функции, а если их нет, из строки kv.config в базе (таблица закрыта RLS)
let BOT_TOKEN = ''
let ADMIN_IDS: number[] = []
let WEBAPP_URL = ''
let CRON_SECRET = ''
let configLoadedAt = 0
async function loadConfig() {
  if (Date.now() - configLoadedAt < 60_000) return
  const { data } = await db.from('kv').select('value').eq('key', 'config').maybeSingle()
  const c = (data?.value ?? {}) as Record<string, string>
  BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? c.BOT_TOKEN ?? ''
  ADMIN_IDS = String(Deno.env.get('ADMIN_IDS') ?? c.ADMIN_IDS ?? '').split(',').map((s) => Number(s.trim())).filter(Boolean)
  WEBAPP_URL = Deno.env.get('WEBAPP_URL') ?? c.WEBAPP_URL ?? ''
  CRON_SECRET = Deno.env.get('CRON_SECRET') ?? c.CRON_SECRET ?? ''
  configLoadedAt = Date.now()
}

/* ---------------- настройки обмена ---------------- */
const FEE_PCT = 3
const MIN_KZT = 10_000
const MAX_KZT = 1_000_000
const MAX_KZT_VERIFIED = 5_000_000
const MAX_ACTIVE_ORDERS = 3
const CUR: Record<string, { type: 'fiat' | 'crypto'; dp: number; gecko?: string; sym: string }> = {
  KZT: { type: 'fiat', dp: 2, sym: '₸' },
  USD: { type: 'fiat', dp: 2, sym: '$' },
  EUR: { type: 'fiat', dp: 2, sym: '€' },
  RUB: { type: 'fiat', dp: 2, sym: '₽' },
  USDT: { type: 'crypto', dp: 2, gecko: 'tether', sym: 'USDT' },
  BTC: { type: 'crypto', dp: 8, gecko: 'bitcoin', sym: 'BTC' },
  ETH: { type: 'crypto', dp: 6, gecko: 'ethereum', sym: 'ETH' },
  TON: { type: 'crypto', dp: 4, gecko: 'the-open-network', sym: 'TON' },
}

/* ---------------- утилиты ---------------- */
const enc = new TextEncoder()
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-nex-token, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
const fail = (msg: string, status = 400) => json({ error: msg }, status)

async function hmac(key: ArrayBuffer | Uint8Array | string, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', (typeof key === 'string' ? enc.encode(key) : key) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const b64u = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'))
function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const nf = (n: number, dp = 2) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: dp }).format(n).replace(/[\u202f\u00a0]/g, ' ')
const money = (n: number, c: string) => `${nf(n, CUR[c]?.type === 'fiat' ? 2 : CUR[c]?.dp ?? 2)} ${c}`
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp
const rateText = (from: string, to: string, r: number) => (r >= 1 ? `1 ${from} = ${nf(r, 4)} ${to}` : `1 ${to} = ${nf(1 / r, 4)} ${from}`)

/* ---------------- сессии ---------------- */
async function sessionKey() {
  return hmac('nex-session', BOT_TOKEN)
}
async function makeToken(uid: number) {
  const payload = b64u(JSON.stringify({ u: uid, e: Date.now() + 30 * 86400_000 }))
  return `${payload}.${hex(await hmac(await sessionKey(), payload))}`
}
async function readToken(t: string | null): Promise<number | null> {
  if (!t) return null
  const [p, sig] = t.split('.')
  if (!p || !sig || !safeEq(hex(await hmac(await sessionKey(), p)), sig)) return null
  try {
    const { u, e } = JSON.parse(unb64u(p))
    return e > Date.now() ? Number(u) : null
  } catch {
    return null
  }
}

/** Проверка подписи Telegram WebApp initData */
async function verifyInitData(initData: string) {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = await hmac('WebAppData', BOT_TOKEN)
  if (!safeEq(hex(await hmac(secret, dcs)), hash)) return null
  if (Date.now() / 1000 - Number(params.get('auth_date')) > 86400) return null
  try {
    return JSON.parse(params.get('user') || 'null')
  } catch {
    return null
  }
}

// deno-lint-ignore no-explicit-any
async function upsertUser(u: any) {
  const row = {
    id: u.id,
    first_name: u.first_name ?? '',
    last_name: u.last_name ?? null,
    username: u.username ?? null,
    last_seen_at: new Date().toISOString(),
    ...(u.photo_url ? { photo_url: u.photo_url } : {}),
  }
  const { error } = await db.from('users').upsert(row, { onConflict: 'id' })
  if (error) throw error
}

const USER_FIELDS = 'id, first_name, last_name, username, photo_url, phone, kyc_status, kyc_note, created_at, blocked'
async function getUser(id: number) {
  const { data } = await db.from('users').select(USER_FIELDS).eq('id', id).maybeSingle()
  return data
}

/* ---------------- Telegram ---------------- */
// deno-lint-ignore no-explicit-any
async function tg(method: string, body: Record<string, unknown> | FormData): Promise<any> {
  const isForm = body instanceof FormData
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? body : JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!j.ok) console.error('tg', method, JSON.stringify(j))
  return j
}
const send = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
const appButton = (text: string, start?: string) => ({
  inline_keyboard: [[{ text, web_app: { url: WEBAPP_URL + (start ? `?startapp=${start}` : '') } }]],
})
const isAdmin = (id: number) => ADMIN_IDS.includes(id)
async function notifyAdmins(text: string, extra: Record<string, unknown> = {}) {
  const ids: number[] = []
  for (const a of ADMIN_IDS) {
    const r = await send(a, text, extra)
    if (r.ok) ids.push(r.result.message_id)
  }
  return ids
}

/* ---------------- курсы ---------------- */
type Market = { usd: Record<string, number>; change24h: Record<string, number | null>; spark: Record<string, number[]>; updated_at: string }
const FALLBACK_USD: Record<string, number> = { USD: 1, KZT: 1 / 500, EUR: 1.08, RUB: 1 / 90, USDT: 1, BTC: 95000, ETH: 3400, TON: 5 }

async function getMarket(): Promise<Market> {
  const { data: cached } = await db.from('kv').select('value, updated_at').eq('key', 'market').maybeSingle()
  if (cached && Date.now() - new Date(cached.updated_at).getTime() < 60_000) return cached.value as Market
  const prev = (cached?.value as Market | undefined) ?? null
  const m: Market = { usd: { ...(prev?.usd ?? FALLBACK_USD) }, change24h: { ...(prev?.change24h ?? {}) }, spark: { ...(prev?.spark ?? {}) }, updated_at: new Date().toISOString() }
  const crypto = Object.entries(CUR).filter(([, c]) => c.gecko)
  const [fiat, cg] = await Promise.allSettled([
    fetch('https://open.er-api.com/v6/latest/USD').then((r) => r.json()),
    fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&sparkline=true&price_change_percentage=24h&ids=${crypto.map(([, c]) => c.gecko).join(',')}`).then((r) => r.json()),
  ])
  if (fiat.status === 'fulfilled' && fiat.value?.rates) for (const c of ['KZT', 'EUR', 'RUB']) if (fiat.value.rates[c]) m.usd[c] = 1 / fiat.value.rates[c]
  if (cg.status === 'fulfilled' && Array.isArray(cg.value)) {
    for (const [code, c] of crypto) {
      // deno-lint-ignore no-explicit-any
      const row = cg.value.find((x: any) => x.id === c.gecko)
      if (!row) continue
      m.usd[code] = row.current_price
      m.change24h[code] = row.price_change_percentage_24h ?? null
      m.spark[code] = (row.sparkline_in_7d?.price ?? []).filter((_: number, i: number) => i % 4 === 0)
    }
  }
  await db.from('kv').upsert({ key: 'market', value: m, updated_at: m.updated_at })
  return m
}
const cross = (m: Market, a: string, b: string) => m.usd[a] / m.usd[b]

/* ---------------- тексты для бота ---------------- */
// deno-lint-ignore no-explicit-any
function clientLine(u: any) {
  const name = esc([u.first_name, u.last_name].filter(Boolean).join(' ') || 'Клиент')
  return `<a href="tg://user?id=${u.id}">${name}</a>${u.username ? ' @' + esc(u.username) : ''}${u.kyc_status === 'verified' ? ' ✅' : ''}`
}
// deno-lint-ignore no-explicit-any
function orderText(o: any, u: any, head: string) {
  return [
    `<b>${head}</b>`,
    '',
    `👤 ${clientLine(u)}`,
    `ID: <code>${u.id}</code>${u.phone ? ` · 📞 ${esc(u.phone)}` : ''}`,
    `Верификация: ${{ none: 'не пройдена', pending: 'на проверке', verified: 'пройдена', rejected: 'отклонена' }[u.kyc_status as string]}`,
    '',
    `↗️ Отдаёт: <b>${money(+o.amount_from, o.from_cur)}</b>`,
    `↘️ Получает: <b>${money(+o.amount_to, o.to_cur)}</b>`,
    `Курс: ${rateText(o.from_cur, o.to_cur, +o.rate)}`,
    `Комиссия ${o.fee_pct}%: ${money(+o.fee_amount, o.to_cur)}`,
    `Способ: ${esc(o.method)}`,
    o.details ? `Детали: ${esc(o.details)}` : '',
    o.note ? `Комментарий: ${esc(o.note)}` : '',
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n')
}
// deno-lint-ignore no-explicit-any
function orderKeyboard(o: any, u: any) {
  const contact = u.username ? [{ text: '💬 Написать клиенту', url: `https://t.me/${u.username}` }] : []
  if (o.status === 'new')
    return { inline_keyboard: [[{ text: '✅ Принять', callback_data: `acc:${o.id}` }, { text: '✖️ Отклонить', callback_data: `rej:${o.id}` }], ...(contact.length ? [contact] : [])] }
  if (o.status === 'accepted')
    return { inline_keyboard: [...(contact.length ? [contact] : []), [{ text: '🤝 Подтвердить обмен', callback_data: `done:${o.id}` }], [{ text: '✖️ Отменить заявку', callback_data: `rej:${o.id}` }]] }
  return { inline_keyboard: [] }
}
const STATUS_HEAD: Record<string, string> = {
  new: '🆕 Новая заявка №',
  accepted: '🟦 В работе: заявка №',
  completed: '✅ Обмен завершён: заявка №',
  rejected: '✖️ Отклонена: заявка №',
  cancelled: '↩️ Отменена клиентом: заявка №',
}

/* ---------------- обработчики бота ---------------- */
// deno-lint-ignore no-explicit-any
async function onUpdate(up: any) {
  if (up.message) return onMessage(up.message)
  if (up.callback_query) return onCallback(up.callback_query)
}

// deno-lint-ignore no-explicit-any
async function onMessage(m: any) {
  const from = m.from
  if (!from || m.chat?.type !== 'private') return
  await upsertUser(from)

  if (m.contact) {
    if (m.contact.user_id === from.id) {
      await db.from('users').update({ phone: m.contact.phone_number }).eq('id', from.id)
      await send(from.id, 'Спасибо! Номер сохранён, оператор сможет с вами связаться.')
    }
    return
  }

  const text: string = m.text ?? ''
  const [cmd, arg] = text.split(/\s+/)

  if (cmd === '/start' && arg?.startsWith('login_')) {
    const code = arg.slice(6)
    const { data } = await db.from('login_codes').select('code, created_at, user_id').eq('code', code).maybeSingle()
    if (!data || Date.now() - new Date(data.created_at).getTime() > 10 * 60_000)
      return send(from.id, 'Ссылка для входа устарела. Нажмите «Войти через Telegram» в приложении ещё раз.')
    await db.from('login_codes').update({ user_id: from.id }).eq('code', code)
    return send(from.id, '✅ Вход подтверждён. Вернитесь в приложение NEX, оно откроется автоматически.')
  }

  if (cmd === '/start' || cmd === '/app') {
    await send(
      from.id,
      `Добро пожаловать в <b>NEX</b>, ${esc(from.first_name)}!\n\nОбмен валют и цифровых активов: актуальные курсы, комиссия ${FEE_PCT}% и живой оператор в Telegram.\n\nНажмите кнопку ниже, чтобы открыть приложение.`,
      { reply_markup: appButton('Открыть NEX') },
    )
    if (isAdmin(from.id)) await send(from.id, ADMIN_HELP)
    return
  }

  if (!isAdmin(from.id)) {
    return send(from.id, 'Чтобы создать заявку на обмен, откройте приложение.', { reply_markup: appButton('Открыть NEX') })
  }

  // ----- команды администратора -----
  if (cmd === '/orders') {
    const { data } = await db.from('orders').select('*, users(*)').in('status', ['new', 'accepted']).order('created_at').limit(20)
    if (!data?.length) return send(from.id, 'Активных заявок нет.')
    for (const o of data) {
      const r = await send(from.id, orderText(o, o.users, STATUS_HEAD[o.status] + o.id), { reply_markup: orderKeyboard(o, o.users) })
      if (r.ok) await db.from('orders').update({ admin_msg_id: r.result.message_id }).eq('id', o.id)
    }
    return
  }
  if (cmd === '/kyc') {
    const { data } = await db.from('users').select('*').eq('kyc_status', 'pending').limit(20)
    if (!data?.length) return send(from.id, 'Анкет на проверке нет.')
    for (const u of data) await sendKycToAdmin(from.id, u, false)
    return
  }
  if (cmd === '/stats') {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString()
    const [{ count: users }, { data: done }, { count: active }] = await Promise.all([
      db.from('users').select('*', { count: 'exact', head: true }),
      db.from('orders').select('from_cur, amount_from').eq('status', 'completed').gte('completed_at', since),
      db.from('orders').select('*', { count: 'exact', head: true }).in('status', ['new', 'accepted']),
    ])
    const m = await getMarket()
    const vol = (done ?? []).reduce((s, o) => s + +o.amount_from * cross(m, o.from_cur, 'KZT'), 0)
    return send(
      from.id,
      `📊 <b>Статистика NEX</b>\n\nПользователей: ${users}\nАктивных заявок: ${active}\n\nЗа 30 дней:\nОбменов: ${done?.length ?? 0}\nОборот: ${nf(vol, 0)} KZT\nКомиссия (~${FEE_PCT}%): ${nf((vol * FEE_PCT) / 100, 0)} KZT`,
    )
  }
  if (cmd === '/block' || cmd === '/unblock') {
    const id = Number(arg)
    if (!id) return send(from.id, `Использование: ${cmd} <ID пользователя>`)
    await db.from('users').update({ blocked: cmd === '/block' }).eq('id', id)
    return send(from.id, cmd === '/block' ? `Пользователь ${id} заблокирован.` : `Пользователь ${id} разблокирован.`)
  }
  return send(from.id, ADMIN_HELP)
}

const ADMIN_HELP = [
  '🛠 <b>Панель оператора</b>',
  '',
  'Новые заявки и анкеты приходят сюда автоматически.',
  '',
  '/orders: активные заявки',
  '/kyc: анкеты на проверке',
  '/stats: статистика за 30 дней',
  '/block ID и /unblock ID: блокировка пользователя',
].join('\n')

// deno-lint-ignore no-explicit-any
async function onCallback(q: any) {
  const answer = (text = '', alert = false) => tg('answerCallbackQuery', { callback_query_id: q.id, text, show_alert: alert })
  if (!isAdmin(q.from.id)) return answer('Недостаточно прав', true)
  const [action, idStr] = String(q.data).split(':')
  const id = Number(idStr)

  if (action === 'kyc_ok' || action === 'kyc_no') {
    const verified = action === 'kyc_ok'
    const { data: u } = await db
      .from('users')
      .update({ kyc_status: verified ? 'verified' : 'rejected', kyc_note: verified ? null : 'данные или фото не прошли проверку' })
      .eq('id', id)
      .select()
      .single()
    await tg('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } })
    await send(q.message.chat.id, `${verified ? '✅ Верификация одобрена' : '✖️ Верификация отклонена'}: ${clientLine(u)}`)
    await send(
      id,
      verified
        ? '✅ Ваш аккаунт подтверждён! В профиле появилась отметка «Подтверждён», лимит обмена увеличен.'
        : '✖️ Верификация не пройдена: данные или фото не прошли проверку. Проверьте анкету и отправьте её снова.',
      { reply_markup: appButton('Открыть профиль', 'kyc') },
    )
    return answer(verified ? 'Одобрено' : 'Отклонено')
  }

  const { data: o } = await db.from('orders').select('*, users(*)').eq('id', id).maybeSingle()
  if (!o) return answer('Заявка не найдена', true)
  const now = new Date().toISOString()
  let patch: Record<string, unknown> | null = null
  let userMsg = ''
  if (action === 'acc' && o.status === 'new') {
    patch = { status: 'accepted', accepted_at: now }
    userMsg = `🟦 Заявка №${o.id} принята!\n\nОператор NEX скоро напишет вам в Telegram, чтобы согласовать детали обмена. Передавайте средства только по реквизитам от оператора.`
  } else if (action === 'done' && o.status === 'accepted') {
    patch = { status: 'completed', completed_at: now }
    userMsg = `✅ Обмен по заявке №${o.id} завершён.\n\nВы получили ${money(+o.amount_to, o.to_cur)}. Спасибо, что выбрали NEX!`
  } else if (action === 'rej' && (o.status === 'new' || o.status === 'accepted')) {
    patch = { status: 'rejected' }
    userMsg = `✖️ Заявка №${o.id} отклонена оператором. Если есть вопросы, напишите в поддержку.`
  }
  if (!patch) return answer('Статус заявки уже изменён', true)

  const { data: upd } = await db.from('orders').update(patch).eq('id', o.id).eq('status', o.status).select().maybeSingle()
  if (!upd) return answer('Статус заявки уже изменён', true)
  await tg('editMessageText', {
    chat_id: q.message.chat.id,
    message_id: q.message.message_id,
    text: orderText(upd, o.users, STATUS_HEAD[upd.status] + upd.id),
    parse_mode: 'HTML',
    reply_markup: orderKeyboard(upd, o.users),
  })
  if (action === 'acc') {
    // Контакт клиента отдельным сообщением, чтобы было удобно написать
    const u = o.users
    await send(
      q.message.chat.id,
      `📇 Контакт клиента по заявке №${o.id}:\n${clientLine(u)}${u.phone ? `\n📞 ${esc(u.phone)}` : ''}\n\n${u.username ? 'Нажмите на имя или @username, чтобы написать.' : 'У клиента нет @username: нажмите на имя, чтобы открыть профиль.'}\nПосле обмена нажмите «🤝 Подтвердить обмен» в заявке выше.`,
    )
    if (u.phone && !u.username) await tg('sendContact', { chat_id: q.message.chat.id, phone_number: u.phone, first_name: u.first_name || 'Клиент' })
  }
  await send(o.user_id, userMsg, { reply_markup: appButton('Открыть заявку', `order_${o.id}`) })
  return answer('Готово')
}

// deno-lint-ignore no-explicit-any
async function sendKycToAdmin(chat: number, u: any, withPhotos = true) {
  const k = u.kyc ?? {}
  if (withPhotos && k.files?.length) {
    const fd = new FormData()
    fd.append('chat_id', String(chat))
    const media = []
    for (const [i, path] of (k.files as string[]).entries()) {
      const { data } = await db.storage.from('kyc').download(path)
      if (!data) continue
      fd.append(`f${i}`, data, `f${i}.jpg`)
      media.push({ type: 'photo', media: `attach://f${i}`, caption: i === 0 ? 'Документ' : 'Селфи с документом' })
    }
    if (media.length) {
      fd.append('media', JSON.stringify(media))
      await tg('sendMediaGroup', fd)
    }
  }
  return send(
    chat,
    [
      '🪪 <b>Анкета на верификацию</b>',
      '',
      `👤 ${clientLine(u)}  ID: <code>${u.id}</code>`,
      `ФИО: ${esc(k.full_name)}`,
      `Дата рождения: ${esc(k.birth_date)}`,
      `Гражданство: ${esc(k.citizenship)}`,
      `Документ: ${esc(k.doc_type)}, № ${esc(k.doc_number)}`,
      `Телефон: ${esc(k.phone)}`,
      `Адрес: ${esc(k.address)}`,
    ].join('\n'),
    { reply_markup: { inline_keyboard: [[{ text: '✅ Одобрить', callback_data: `kyc_ok:${u.id}` }, { text: '✖️ Отклонить', callback_data: `kyc_no:${u.id}` }]] } },
  )
}

/* ---------------- API приложения ---------------- */
async function api(req: Request, path: string): Promise<Response> {
  const method = req.method

  if (path === '/rates' && method === 'GET') return json(await getMarket())

  if (path === '/auth/telegram' && method === 'POST') {
    const { initData } = await req.json()
    const u = await verifyInitData(String(initData ?? ''))
    if (!u) return fail('Не удалось подтвердить вход через Telegram', 401)
    await upsertUser(u)
    return json({ token: await makeToken(u.id) })
  }
  if (path === '/auth/link/start' && method === 'POST') {
    const code = hex(crypto.getRandomValues(new Uint8Array(12)))
    await db.from('login_codes').insert({ code })
    const me = await tg('getMe', {})
    return json({ code, url: `https://t.me/${me.result?.username}?start=login_${code}` })
  }
  if (path === '/auth/link/poll' && method === 'GET') {
    const code = new URL(req.url).searchParams.get('code') ?? ''
    const { data } = await db.from('login_codes').select('user_id, created_at').eq('code', code).maybeSingle()
    if (!data || Date.now() - new Date(data.created_at).getTime() > 10 * 60_000) return fail('Код устарел', 410)
    if (!data.user_id) return json({})
    await db.from('login_codes').delete().eq('code', code)
    return json({ token: await makeToken(data.user_id) })
  }

  // ниже нужна авторизация
  const uid = await readToken(req.headers.get('x-nex-token'))
  if (!uid) return fail('Сессия истекла, войдите снова', 401)
  const user = await getUser(uid)
  if (!user) return fail('Пользователь не найден', 401)
  if (user.blocked) return fail('Доступ ограничен. Обратитесь в поддержку.', 403)

  if (path === '/me' && method === 'GET') return json(user)

  if (path === '/orders' && method === 'GET') {
    const { data } = await db
      .from('orders')
      .select('id, from_cur, to_cur, amount_from, amount_to, rate, fee_pct, fee_amount, method, details, note, status, admin_note, created_at, accepted_at, completed_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(200)
    return json((data ?? []).map(numify))
  }

  if (path === '/orders' && method === 'POST') {
    const b = await req.json()
    const from = String(b.from), to = String(b.to)
    const amount = Number(b.amount)
    if (!CUR[from] || !CUR[to] || from === to) return fail('Выберите разные валюты')
    if (!(amount > 0) || !isFinite(amount)) return fail('Введите сумму')
    const { count } = await db.from('orders').select('*', { count: 'exact', head: true }).eq('user_id', uid).in('status', ['new', 'accepted'])
    if ((count ?? 0) >= MAX_ACTIVE_ORDERS) return fail(`Не больше ${MAX_ACTIVE_ORDERS} активных заявок одновременно. Дождитесь завершения текущих.`)
    const m = await getMarket()
    const kzt = amount * cross(m, from, 'KZT')
    const max = user.kyc_status === 'verified' ? MAX_KZT_VERIFIED : MAX_KZT
    if (kzt < MIN_KZT) return fail(`Минимальная сумма заявки ${nf(MIN_KZT, 0)} ₸ в эквиваленте`)
    if (kzt > max) return fail(`Максимальная сумма заявки ${nf(max, 0)} ₸ в эквиваленте${user.kyc_status === 'verified' ? '' : '. Пройдите верификацию, чтобы увеличить лимит.'}`)
    const rate = cross(m, from, to)
    const gross = amount * rate
    const fee = (gross * FEE_PCT) / 100
    const row = {
      user_id: uid,
      from_cur: from,
      to_cur: to,
      amount_from: round(amount, CUR[from].dp),
      amount_to: round(gross - fee, CUR[to].dp),
      rate,
      fee_pct: FEE_PCT,
      fee_amount: round(fee, CUR[to].dp),
      method: String(b.method ?? 'Наличные').slice(0, 40),
      details: b.details ? String(b.details).slice(0, 200) : null,
      note: b.note ? String(b.note).slice(0, 500) : null,
    }
    const { data: o, error } = await db.from('orders').insert(row).select().single()
    if (error) return fail('Не удалось создать заявку', 500)
    const ids = await notifyAdmins(orderText(o, user, STATUS_HEAD.new + o.id), { reply_markup: orderKeyboard(o, user) })
    if (ids[0]) await db.from('orders').update({ admin_msg_id: ids[0] }).eq('id', o.id)
    await send(uid, `📨 Заявка №${o.id} отправлена.\n\nОтдаёте: ${money(+o.amount_from, from)}\nПолучите: ${money(+o.amount_to, to)}\n\nМы сообщим, как только оператор её примет.`)
    return json(numify(o))
  }

  const cancel = path.match(/^\/orders\/(\d+)\/cancel$/)
  if (cancel && method === 'POST') {
    const { data: o } = await db.from('orders').update({ status: 'cancelled' }).eq('id', Number(cancel[1])).eq('user_id', uid).eq('status', 'new').select().maybeSingle()
    if (!o) return fail('Заявку уже нельзя отменить')
    if (o.admin_msg_id)
      for (const a of ADMIN_IDS)
        await tg('editMessageText', { chat_id: a, message_id: o.admin_msg_id, text: orderText(o, user, STATUS_HEAD.cancelled + o.id), parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } })
    return json(numify(o))
  }

  if (path === '/kyc' && method === 'POST') {
    if (user.kyc_status === 'verified') return fail('Аккаунт уже подтверждён')
    const b = await req.json()
    const need = ['full_name', 'birth_date', 'citizenship', 'doc_type', 'doc_number', 'phone']
    for (const k of need) if (!String(b[k] ?? '').trim()) return fail('Заполните все поля анкеты')
    const files: string[] = []
    for (const [i, key] of ['doc_photo', 'selfie_photo'].entries()) {
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(b[key] ?? ''))
      if (!m) return fail('Добавьте оба фото')
      const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0))
      if (bytes.length > 6_000_000) return fail('Фото слишком большое')
      const path = `${uid}/${Date.now()}-${i ? 'selfie' : 'doc'}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`
      const { error } = await db.storage.from('kyc').upload(path, bytes, { contentType: `image/${m[1]}`, upsert: true })
      if (error) return fail('Не удалось загрузить фото', 500)
      files.push(path)
    }
    const kyc = Object.fromEntries([...need, 'address'].map((k) => [k, String(b[k] ?? '').slice(0, 200)]))
    const { data: u } = await db
      .from('users')
      .update({ kyc: { ...kyc, files }, kyc_status: 'pending', kyc_note: null, kyc_submitted_at: new Date().toISOString(), phone: user.phone ?? kyc.phone })
      .eq('id', uid)
      .select('*')
      .single()
    for (const a of ADMIN_IDS) await sendKycToAdmin(a, u)
    const { data: fresh } = await db.from('users').select(USER_FIELDS).eq('id', uid).single()
    return json(fresh)
  }

  if (path === '/alerts' && method === 'GET') {
    const { data } = await db.from('rate_alerts').select('*').eq('user_id', uid).order('created_at', { ascending: false })
    return json((data ?? []).map(numify))
  }
  if (path === '/alerts' && method === 'POST') {
    const b = await req.json()
    if (!CUR[b.base] || !CUR[b.quote] || b.base === b.quote || !(Number(b.target) > 0)) return fail('Проверьте параметры уведомления')
    const { count } = await db.from('rate_alerts').select('*', { count: 'exact', head: true }).eq('user_id', uid).eq('active', true)
    if ((count ?? 0) >= 10) return fail('Не больше 10 активных уведомлений')
    const { data } = await db
      .from('rate_alerts')
      .insert({ user_id: uid, base: b.base, quote: b.quote, target: Number(b.target), direction: b.direction === 'below' ? 'below' : 'above' })
      .select()
      .single()
    return json(numify(data))
  }
  const delAlert = path.match(/^\/alerts\/(\d+)$/)
  if (delAlert && method === 'DELETE') {
    await db.from('rate_alerts').delete().eq('id', Number(delAlert[1])).eq('user_id', uid)
    return json({ ok: true })
  }

  return fail('Не найдено', 404)
}

// numeric из Postgres приходит строкой
// deno-lint-ignore no-explicit-any
function numify(o: any) {
  if (!o) return o
  for (const k of ['amount_from', 'amount_to', 'rate', 'fee_pct', 'fee_amount', 'target']) if (o[k] != null) o[k] = Number(o[k])
  return o
}

/* ---------------- уведомления о курсе (cron) ---------------- */
async function checkAlerts() {
  const { data } = await db.from('rate_alerts').select('*').eq('active', true).limit(1000)
  if (!data?.length) return { checked: 0, fired: 0 }
  const m = await getMarket()
  let fired = 0
  for (const a of data) {
    const r = cross(m, a.base, a.quote)
    if ((a.direction === 'above' && r >= +a.target) || (a.direction === 'below' && r <= +a.target)) {
      await db.from('rate_alerts').update({ active: false, fired_at: new Date().toISOString() }).eq('id', a.id)
      await send(
        a.user_id,
        `🔔 Курс ${a.base}/${a.quote} ${a.direction === 'above' ? 'вырос до' : 'опустился до'} ${nf(r, 4)} (ваша цель ${nf(+a.target, 4)}).`,
        { reply_markup: appButton('Обменять в NEX') },
      )
      fired++
    }
  }
  // чистим старые коды входа
  await db.from('login_codes').delete().lt('created_at', new Date(Date.now() - 86400_000).toISOString())
  return { checked: data.length, fired }
}

/* ---------------- первоначальная настройка бота ---------------- */
async function setup(origin: string) {
  const hook = `${origin}/functions/v1/nex/bot`
  const secret = hex(await hmac('nex-webhook', BOT_TOKEN)).slice(0, 48)
  const res = {
    webhook: await tg('setWebhook', { url: hook, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true }),
    commands: await tg('setMyCommands', { commands: [{ command: 'start', description: 'Открыть NEX' }] }),
    adminCommands: await Promise.all(
      ADMIN_IDS.map((id) =>
        tg('setMyCommands', {
          scope: { type: 'chat', chat_id: id },
          commands: [
            { command: 'orders', description: 'Активные заявки' },
            { command: 'kyc', description: 'Анкеты на проверке' },
            { command: 'stats', description: 'Статистика' },
            { command: 'start', description: 'Открыть NEX' },
          ],
        }),
      ),
    ),
    menu: await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'NEX', web_app: { url: WEBAPP_URL } } }),
    description: await tg('setMyDescription', { description: `NEX: обмен валют и цифровых активов. Актуальные курсы, комиссия ${FEE_PCT}%, живой оператор. Нажмите «Запустить», чтобы открыть приложение.` }),
    short: await tg('setMyShortDescription', { short_description: 'Обмен валют и криптовалют. Курсы, заявки, поддержка.' }),
  }
  return res
}

/* ---------------- роутер ---------------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  const url = new URL(req.url)
  const path = url.pathname.replace(/^.*?\/nex(?=\/|$)/, '') || '/'
  try {
    await loadConfig()
    if (path === '/bot' && req.method === 'POST') {
      const secret = hex(await hmac('nex-webhook', BOT_TOKEN)).slice(0, 48)
      if (req.headers.get('x-telegram-bot-api-secret-token') !== secret) return new Response('forbidden', { status: 403 })
      await onUpdate(await req.json())
      return new Response('ok')
    }
    if (path === '/cron/alerts') {
      if (!CRON_SECRET || req.headers.get('x-cron-key') !== CRON_SECRET) return new Response('forbidden', { status: 403 })
      return json(await checkAlerts())
    }
    if (path === '/setup') {
      if (!CRON_SECRET || url.searchParams.get('key') !== CRON_SECRET) return new Response('forbidden', { status: 403 })
      const origin = `https://${Deno.env.get('SUPABASE_URL')!.replace(/^https?:\/\//, '')}`
      return json(await setup(origin))
    }
    return await api(req, path)
  } catch (e) {
    console.error(e)
    return fail('Ошибка сервера. Попробуйте позже.', 500)
  }
})
