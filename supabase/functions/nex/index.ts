// NEX backend: API для мини-приложения + вебхук Telegram-бота + проверка уведомлений о курсе.
// Секреты: BOT_TOKEN, ADMIN_IDS (через запятую), WEBAPP_URL, CRON_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from 'npm:@simplewebauthn/server@13.3.3'
import { pushEndpointOk, pushToUser, vapidKey } from './push.ts'
import { adminApi, adminBotCallback, adminBotCommand, adminCleanup, initAdmin } from './admin.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

// Настройки берутся из секретов функции, а если их нет, из строки kv.config в базе (таблица закрыта RLS)
let BOT_TOKEN = ''
let ADMIN_IDS: number[] = []
let WEBAPP_URL = ''
let CRON_SECRET = ''
let KYC_KEY = ''
let configLoadedAt = 0
async function loadConfig() {
  if (Date.now() - configLoadedAt < 60_000) return
  const { data } = await db.from('kv').select('value').eq('key', 'config').maybeSingle()
  const c = (data?.value ?? {}) as Record<string, string>
  BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? c.BOT_TOKEN ?? ''
  ADMIN_IDS = String(Deno.env.get('ADMIN_IDS') ?? c.ADMIN_IDS ?? '').split(',').map((s) => Number(s.trim())).filter(Boolean)
  WEBAPP_URL = Deno.env.get('WEBAPP_URL') ?? c.WEBAPP_URL ?? ''
  CRON_SECRET = Deno.env.get('CRON_SECRET') ?? c.CRON_SECRET ?? ''
  KYC_KEY = Deno.env.get('KYC_KEY') ?? c.KYC_KEY ?? ''
  configLoadedAt = Date.now()
}

/* ---------------- настройки обмена ---------------- */
const FEE_PCT = 3
const MIN_KZT = 5_000
/** До этой суммы достаточно ФИО, телефона и даты рождения; выше нужна проверка документов */
const MAX_KZT = 300_000
const MAX_KZT_VERIFIED = 5_000_000
/* ---------------- программа лояльности ---------------- */
const TIERS = [
  { id: 'standard', name: 'Standard', min: 0, off: 0 },
  { id: 'silver', name: 'Silver', min: 1_000_000, off: 0.25 },
  { id: 'gold', name: 'Gold', min: 5_000_000, off: 0.5 },
  { id: 'black', name: 'Black', min: 20_000_000, off: 0.75 },
]
const LARGE = [
  { min: 3_000_000, off: 0.5 },
  { min: 1_000_000, off: 0.25 },
]
const WELCOME_OFF = 1 // скидка приглашённому на первый обмен
const MIN_FEE = 1.5
const REF_SHARE = 0.2 // доля комиссии, которая начисляется пригласившему бонусами
const BONUS_MAX_SHARE = 0.5 // бонусами можно оплатить не больше половины комиссии
const tierOf = (vol: number) => [...TIERS].reverse().find((t) => vol >= t.min)!
function pricing(volumeKzt: number, amountKzt: number, welcome: boolean) {
  const tier = tierOf(volumeKzt)
  const discounts: { id: string; label: string; off: number }[] = []
  if (tier.off) discounts.push({ id: 'tier', label: `Уровень ${tier.name}`, off: tier.off })
  const large = LARGE.find((l) => amountKzt >= l.min)
  if (large) discounts.push({ id: 'large', label: 'Крупная сумма', off: large.off })
  if (welcome) discounts.push({ id: 'welcome', label: 'Первый обмен по приглашению', off: WELCOME_OFF })
  const fee = Math.max(MIN_FEE, FEE_PCT - discounts.reduce((s, d) => s + d.off, 0))
  return { fee: round(fee, 2), discounts }
}
const MAX_ACTIVE_ORDERS = 3
const ORDER_COOLDOWN_SEC = 300
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
const fail = (msg: string, status = 400, extra: Record<string, unknown> = {}) => json({ error: msg, ...extra }, status)

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
/* ---------------- шифрование данных KYC (AES-256-GCM) ---------------- */
async function aesKey() {
  if (!KYC_KEY) throw new Error('KYC_KEY не задан')
  const raw = Uint8Array.from(atob(KYC_KEY), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function encryptBytes(data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), data as BufferSource))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}
async function decryptBytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, await aesKey(), data.slice(12)))
}
const toB64 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const encryptJson = async (o: unknown) => toB64(await encryptBytes(enc.encode(JSON.stringify(o))))
const decryptJson = async (s: string) => JSON.parse(new TextDecoder().decode(await decryptBytes(fromB64(s))))

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
    const u = JSON.parse(params.get('user') || 'null')
    if (u) u._start = params.get('start_param') ?? ''
    return u
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

const USER_FIELDS =
  'id, first_name, last_name, username, photo_url, phone, phone_verified, kyc_status, kyc_note, created_at, blocked, profile_enc, profile_done, ref_code, referred_by, bonus_kzt, volume_kzt, ref_earned_kzt'
async function getUser(id: number) {
  const { data } = await db.from('users').select(USER_FIELDS).eq('id', id).maybeSingle()
  if (data && !data.ref_code) {
    // Реферальный код создаётся при первом обращении
    for (let i = 0; i < 3 && !data.ref_code; i++) {
      const code = refCode()
      const { error } = await db.from('users').update({ ref_code: code }).eq('id', id).is('ref_code', null)
      if (!error) data.ref_code = code
    }
  }
  return data
}
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const refCode = () => [...crypto.getRandomValues(new Uint8Array(7))].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')

/** Нормализация телефона к виду +77011234567 */
function normPhone(s: unknown): string | null {
  let d = String(s ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1)
  if (d.length === 10 && d.startsWith('7')) d = '7' + d
  if (d.length < 10 || d.length > 15) return null
  return '+' + d
}
const maskPhone = (p: string) => p.slice(0, 2) + ' *** *** ' + p.slice(-4, -2) + ' ' + p.slice(-2)

// deno-lint-ignore no-explicit-any
async function readProfile(u: any): Promise<{ full_name?: string; birth_date?: string }> {
  if (!u?.profile_enc) return {}
  try {
    return await decryptJson(u.profile_enc)
  } catch {
    return {}
  }
}

/** Привязка приглашения: только для новых клиентов без обменов и не самому себе */
async function applyReferral(uid: number, code: string) {
  if (!code) return false
  const { data: ref } = await db.from('users').select('id').eq('ref_code', code.toUpperCase()).maybeSingle()
  if (!ref || ref.id === uid) return false
  const { count } = await db.from('orders').select('*', { count: 'exact', head: true }).eq('user_id', uid)
  if (count) return false
  const { data } = await db.from('users').update({ referred_by: ref.id }).eq('id', uid).is('referred_by', null).select('id').maybeSingle()
  return !!data
}

// deno-lint-ignore no-explicit-any
async function loyalty(u: any) {
  const [{ count: completed }, { count: referrals }] = await Promise.all([
    db.from('orders').select('*', { count: 'exact', head: true }).eq('user_id', u.id).eq('status', 'completed'),
    db.from('users').select('*', { count: 'exact', head: true }).eq('referred_by', u.id),
  ])
  const vol = Number(u.volume_kzt ?? 0)
  const tier = tierOf(vol)
  const next = TIERS.find((t) => t.min > vol) ?? null
  const { data: me } = await db.from('kv').select('value').eq('key', 'bot').maybeSingle()
  const bot = (me?.value as { username?: string } | null)?.username ?? 'noirexcbot'
  return {
    tier: tier.id,
    tier_name: tier.name,
    tier_off: tier.off,
    next_tier: next ? { id: next.id, name: next.name, min: next.min, off: next.off } : null,
    volume_kzt: vol,
    bonus_kzt: Number(u.bonus_kzt ?? 0),
    ref_code: u.ref_code,
    ref_link: `https://t.me/${bot}?start=ref_${u.ref_code}`,
    referrals: referrals ?? 0,
    ref_earned_kzt: Number(u.ref_earned_kzt ?? 0),
    welcome: !!u.referred_by && !completed,
    completed: completed ?? 0,
  }
}
// deno-lint-ignore no-explicit-any
async function publicUser(u: any) {
  const { profile_enc: _p, blocked: _b, ...rest } = u
  const prof = await readProfile(u)
  return { ...rest, full_name: prof.full_name ?? null, birth_date: prof.birth_date ?? null, loyalty: await loyalty(u) }
}

/* ---------------- Telegram ---------------- */
// deno-lint-ignore no-explicit-any
async function tg(method: string, body: Record<string, unknown> | FormData): Promise<any> {
  const isForm = body instanceof FormData
  // deno-lint-ignore no-explicit-any
  let j: any = {}
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: isForm ? undefined : { 'Content-Type': 'application/json' },
        body: isForm ? body : JSON.stringify(body),
      })
      j = await r.json().catch(() => ({}))
    } catch (e) {
      j = { ok: false, description: String(e) }
    }
    if (j.ok) return j
    // лимит Telegram: ждём сколько попросили; сетевой сбой: короткая пауза
    const wait = j.parameters?.retry_after ? Math.min(j.parameters.retry_after, 5) * 1000 : j.error_code ? 0 : 700
    if (!wait) break
    await new Promise((r) => setTimeout(r, wait))
  }
  console.error('tg', method, JSON.stringify(j))
  return j
}
const send = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
const appButton = (text: string, start?: string) => ({
  inline_keyboard: [[{ text, web_app: { url: WEBAPP_URL + (start ? `?startapp=${start}` : '') } }]],
})
const isAdmin = (id: number) => ADMIN_IDS.includes(id)
/** Push на телефон (если клиент включил уведомления в приложении). Ошибки не мешают основному действию. */
async function pushU(uid: number, title: string, body: string, start?: string) {
  try {
    await pushToUser(db, uid, { title, body, url: start ? `/?startapp=${start}` : '/', tag: start }, WEBAPP_URL || 'mailto:support@nex.app')
  } catch (e) {
    console.error('push', e)
  }
}
const plain = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
async function notifyAdmins(text: string, extra: Record<string, unknown> = {}) {
  const ids: number[] = []
  for (const a of ADMIN_IDS) {
    const r = await send(a, text, extra)
    if (r.ok) ids.push(r.result.message_id)
  }
  return ids
}

/** Имя бота (кэшируется в kv, чтобы не спрашивать Telegram на каждый вход) */
async function botInfo(): Promise<string> {
  const { data } = await db.from('kv').select('value').eq('key', 'bot').maybeSingle()
  const u = (data?.value as { username?: string } | null)?.username
  if (u) return u
  const me = await tg('getMe', {})
  const name = me.result?.username ?? 'noirexcbot'
  if (me.ok) await db.from('kv').upsert({ key: 'bot', value: { username: name } })
  return name
}
// deno-lint-ignore no-explicit-any
async function withProfile(u: any) {
  if (u && !u._prof) u._prof = await readProfile(u)
  return u
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
    `ID: <code>${u.id}</code>${u.phone ? ` · 📞 ${esc(u.phone)}${u.phone_verified ? ' ✓' : ''}` : ''}`,
    u._prof?.full_name ? `ФИО: ${esc(u._prof.full_name)}, д.р. ${esc(u._prof.birth_date)}` : '',
    `Верификация: ${{ none: 'не пройдена', pending: 'на проверке', verified: 'пройдена', rejected: 'отклонена' }[u.kyc_status as string]}`,
    '',
    `↗️ Отдаёт: <b>${money(+o.amount_from, o.from_cur)}</b>`,
    `↘️ Получает: <b>${money(+o.amount_to, o.to_cur)}</b>`,
    `Курс: ${rateText(o.from_cur, o.to_cur, +o.rate)}`,
    `Комиссия ${o.fee_pct}%: ${money(+o.fee_amount, o.to_cur)}`,
    Array.isArray(o.discounts) && o.discounts.length ? `Скидки: ${o.discounts.map((d: { label: string; off: number }) => `${esc(d.label)} −${d.off}%`).join(', ')}` : '',
    +o.bonus_used > 0 ? `Оплачено бонусами: ${money(+o.bonus_used, o.to_cur)}` : '',
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

/* ---------------- вход по номеру: одноразовый код в Telegram ---------------- */
const OTP_TTL = 5 * 60_000
const otpHash = async (sid: string, code: string) => hex(await hmac(await sessionKey(), `otp:${sid}:${code}`))
async function sendOtp(sid: string, tgId: number) {
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000)
  const { data } = await db
    .from('phone_logins')
    .update({ otp_hash: await otpHash(sid, code), otp_sent_at: new Date().toISOString(), user_id: tgId, attempts: 0 })
    .eq('sid', sid)
    .select('sends')
    .maybeSingle()
  if (!data) return false
  await db.from('phone_logins').update({ sends: (data.sends ?? 0) + 1 }).eq('sid', sid)
  const r = await send(
    tgId,
    `🔐 Код для входа в NEX: <code>${code}</code>\n\nДействует 5 минут. Никому не сообщайте код, даже сотрудникам NEX.`,
    { protect_content: true, reply_markup: { inline_keyboard: [[{ text: '✖️ Это не я', callback_data: `otpno:${sid}` }]] } },
  )
  return !!r.ok
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
    if (m.contact.user_id !== from.id) return send(from.id, 'Отправьте, пожалуйста, свой номер кнопкой «📱 Поделиться номером».')
    const phone = normPhone(m.contact.phone_number)
    if (!phone) return
    // Номер подтверждён Telegram: он принадлежит этому аккаунту
    await db.from('users').update({ phone_verified: false }).eq('phone', phone).neq('id', from.id)
    await db.from('users').update({ phone, phone_verified: true }).eq('id', from.id)
    const { data: login } = await db
      .from('phone_logins')
      .select('sid, phone')
      .eq('tg_user_id', from.id)
      .is('otp_hash', null)
      .gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (login) {
      if (login.phone !== phone)
        return send(from.id, `Номер вашего Telegram (${esc(maskPhone(phone))}) не совпадает с введённым в приложении (${esc(maskPhone(login.phone))}). Введите в приложении номер, к которому привязан этот Telegram.`, { reply_markup: { remove_keyboard: true } })
      await send(from.id, '✅ Номер подтверждён.', { reply_markup: { remove_keyboard: true } })
      await sendOtp(login.sid, from.id)
      return
    }
    return send(from.id, '✅ Номер сохранён и подтверждён. Теперь вы можете входить в NEX по номеру телефона.', { reply_markup: { remove_keyboard: true } })
  }

  const text: string = m.text ?? ''
  const [cmd, arg] = text.split(/\s+/)

  if (cmd === '/start' && arg?.startsWith('login_')) {
    const code = arg.slice(6)
    const { data } = await db.from('login_codes').select('code, created_at, user_id, pin').eq('code', code).maybeSingle()
    if (!data || data.user_id || Date.now() - new Date(data.created_at).getTime() > 10 * 60_000)
      return send(from.id, 'Ссылка для входа устарела. Нажмите «Войти через Telegram» в приложении ещё раз.')
    // Вход подтверждается кнопкой, чтобы чужая ссылка не могла открыть доступ к аккаунту
    return send(
      from.id,
      `🔐 <b>Вход в NEX</b>\n\nКод на экране приложения: <b>${data.pin}</b>\n\nПодтверждайте, только если вы сами нажали «Войти» и код совпадает. Сотрудники NEX никогда не просят переслать эту ссылку.`,
      { reply_markup: { inline_keyboard: [[{ text: '✅ Подтвердить вход', callback_data: `login:${code}` }], [{ text: '✖️ Это не я', callback_data: `nologin:${code}` }]] } },
    )
  }

  if (cmd === '/start' && arg?.startsWith('ph_')) {
    const sid = arg.slice(3)
    const { data } = await db.from('phone_logins').select('sid, phone, tg_user_id, created_at, otp_hash').eq('sid', sid).maybeSingle()
    if (!data || data.otp_hash || Date.now() - new Date(data.created_at).getTime() > 15 * 60_000 || (data.tg_user_id && data.tg_user_id !== from.id))
      return send(from.id, 'Ссылка для входа устарела. Введите номер в приложении ещё раз.')
    await db.from('phone_logins').update({ tg_user_id: from.id }).eq('sid', sid)
    const { data: me } = await db.from('users').select('phone, phone_verified').eq('id', from.id).maybeSingle()
    if (me?.phone_verified && me.phone === data.phone) return sendOtp(sid, from.id)
    return send(
      from.id,
      `🔐 <b>Вход в NEX по номеру</b>\n\nВ приложении введён номер ${esc(maskPhone(data.phone))}. Нажмите кнопку ниже, чтобы подтвердить, что это ваш номер. Это нужно сделать один раз, дальше код будет приходить сразу.`,
      { reply_markup: { keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } },
    )
  }

  if (cmd === '/start' && arg?.startsWith('ref_')) {
    const ok = await applyReferral(from.id, arg.slice(4))
    if (ok) await send(from.id, `🎁 Вы пришли по приглашению. На первый обмен комиссия ниже на ${WELCOME_OFF}%.`)
  }

  if (cmd === '/start' || cmd === '/app') {
    await send(
      from.id,
      `Добро пожаловать в <b>NEX</b>, ${esc(from.first_name)}!\n\nОбмен валют и цифровых активов: актуальные курсы, комиссия ${FEE_PCT}% и живой оператор в Telegram.\n\nНажмите кнопку ниже, чтобы открыть приложение.`,
      { reply_markup: appButton('Открыть NEX') },
    )
    if (isAdmin(from.id)) {
      await tg('setMyCommands', { scope: { type: 'chat', chat_id: from.id }, commands: ADMIN_COMMANDS })
      await send(from.id, ADMIN_HELP)
    }
    return
  }

  if (!isAdmin(from.id)) {
    return send(from.id, 'Чтобы создать заявку на обмен, откройте приложение.', { reply_markup: appButton('Открыть NEX') })
  }

  // ----- команды администратора -----
  if (cmd === '/panel') return adminBotCommand(from, arg)
  if (cmd === '/orders') {
    const { data } = await db.from('orders').select('*, users(*)').in('status', ['new', 'accepted']).order('created_at').limit(20)
    if (!data?.length) return send(from.id, 'Активных заявок нет.')
    for (const o of data) {
      await withProfile(o.users)
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

const ADMIN_COMMANDS = [
  { command: 'panel', description: 'Панель управления' },
  { command: 'orders', description: 'Активные заявки' },
  { command: 'kyc', description: 'Анкеты на проверке' },
  { command: 'stats', description: 'Статистика' },
  { command: 'start', description: 'Открыть NEX' },
]

const ADMIN_HELP = [
  '🛠 <b>Панель оператора</b>',
  '',
  'Новые заявки и анкеты приходят сюда автоматически.',
  '',
  '/panel: ссылка на панель управления',
  '/orders: активные заявки',
  '/kyc: анкеты на проверке',
  '/stats: статистика за 30 дней',
  '/block ID и /unblock ID: блокировка пользователя',
].join('\n')

// deno-lint-ignore no-explicit-any
async function onCallback(q: any) {
  const answer = (text = '', alert = false) => tg('answerCallbackQuery', { callback_query_id: q.id, text, show_alert: alert })
  const [action, idStr] = String(q.data).split(':')

  if (action === 'otpno') {
    await db.from('phone_logins').delete().eq('sid', idStr)
    await tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: 'Код отменён. Никто не сможет им воспользоваться. Если вы не входили, просто проигнорируйте это сообщение.' })
    return answer('Код отменён')
  }

  if (action === 'login' || action === 'nologin') {
    const clear = () => tg('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } })
    if (action === 'nologin') {
      await db.from('login_codes').delete().eq('code', idStr).is('user_id', null)
      await clear()
      await send(q.from.id, 'Вход отменён. Если вы не пытались войти, просто проигнорируйте это сообщение: доступ к аккаунту никто не получил.')
      return answer('Отменено')
    }
    await upsertUser(q.from)
    const { data } = await db
      .from('login_codes')
      .update({ user_id: q.from.id })
      .eq('code', idStr)
      .is('user_id', null)
      .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
      .select('code')
      .maybeSingle()
    await clear()
    if (!data) return answer('Ссылка устарела, начните вход заново', true)
    await send(q.from.id, '✅ Вход подтверждён. Вернитесь в приложение NEX.')
    return answer('Готово')
  }

  if (await adminBotCallback(q, action, idStr)) return
  if (!isAdmin(q.from.id)) return answer('Недостаточно прав', true)
  const id = Number(idStr)

  if (action === 'kyc_ok' || action === 'kyc_no') {
    const verified = action === 'kyc_ok'
    const u = await kycDecide(id, verified, null, null)
    await tg('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } })
    if (!u) return answer('Анкета уже рассмотрена', true)
    await send(q.message.chat.id, `${verified ? '✅ Верификация одобрена' : '✖️ Верификация отклонена'}: ${clientLine(u)}`)
    return answer(verified ? 'Одобрено' : 'Отклонено')
  }

  const r = await orderTransition(id, action as OrderAction, null, { chat: q.message.chat.id, msg: q.message.message_id })
  if ('error' in r) return answer(r.error, true)
  const { o } = r
  if (action === 'acc') {
    // Контакт клиента отдельным сообщением, чтобы было удобно написать
    const u = o.users
    await send(
      q.message.chat.id,
      `📇 Контакт клиента по заявке №${o.id}:\n${clientLine(u)}${u.phone ? `\n📞 ${esc(u.phone)}` : ''}\n\n${u.username ? 'Нажмите на имя или @username, чтобы написать.' : 'У клиента нет @username: нажмите на имя, чтобы открыть профиль.'}\nПосле обмена нажмите «🤝 Подтвердить обмен» в заявке выше.`,
    )
    if (u.phone && !u.username) await tg('sendContact', { chat_id: q.message.chat.id, phone_number: u.phone, first_name: u.first_name || 'Клиент' })
  }
  return answer('Готово')
}

/* ---------------- общие действия оператора (бот и админ-панель) ---------------- */
export type OrderAction = 'acc' | 'done' | 'rej'
/** Смена статуса заявки с защитой от гонки: меняется, только если статус не изменился с момента чтения */
// deno-lint-ignore no-explicit-any
async function orderTransition(id: number, action: OrderAction, adminId: number | null, extraMsg: { chat: number; msg: number } | null = null): Promise<{ error: string } | { o: any; upd: any }> {
  const { data: o } = await db.from('orders').select('*, users(*)').eq('id', id).maybeSingle()
  if (!o) return { error: 'Заявка не найдена' }
  await withProfile(o.users)
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
    patch = { status: 'rejected', rejected_at: now }
    userMsg = `✖️ Заявка №${o.id} отклонена оператором. Если есть вопросы, напишите в поддержку.`
  }
  if (!patch) return { error: 'Статус заявки уже изменён' }
  if (adminId) patch.handled_by = adminId
  const { data: upd } = await db.from('orders').update(patch).eq('id', o.id).eq('status', o.status).select().maybeSingle()
  if (!upd) return { error: 'Статус заявки уже изменён' }
  if (upd.status === 'rejected' && +upd.bonus_used_kzt > 0) await db.rpc('user_credit', { uid: o.user_id, bonus: +upd.bonus_used_kzt, volume: 0 })
  if (upd.status === 'completed') await onCompleted(upd, o.users)
  // Сообщение о заявке в чате оператора обновляется, где бы её ни обработали
  const text = orderText(upd, o.users, STATUS_HEAD[upd.status] + upd.id)
  const edits: { chat: number; msg: number }[] = []
  if (o.admin_msg_id && ADMIN_IDS[0]) edits.push({ chat: ADMIN_IDS[0], msg: o.admin_msg_id })
  if (extraMsg && !edits.some((e) => e.chat === extraMsg.chat && e.msg === extraMsg.msg)) edits.push(extraMsg)
  for (const e of edits) await tg('editMessageText', { chat_id: e.chat, message_id: e.msg, text, parse_mode: 'HTML', reply_markup: orderKeyboard(upd, o.users) })
  await send(o.user_id, userMsg, { reply_markup: appButton('Открыть заявку', `order_${o.id}`) })
  const [head, ...rest] = plain(userMsg).split('\n\n')
  await pushU(o.user_id, head.replace(/^\S+\s/, ''), rest.join(' ') || 'Откройте заявку в NEX', `order_${o.id}`)
  return { o, upd }
}

/** Решение по анкете: только если она ещё на проверке */
async function kycDecide(uid: number, verified: boolean, note: string | null, adminId: number | null) {
  const { data: u } = await db
    .from('users')
    .update({
      kyc_status: verified ? 'verified' : 'rejected',
      kyc_note: verified ? null : note || 'данные или фото не прошли проверку',
      kyc_reviewed_at: new Date().toISOString(),
      ...(adminId ? { kyc_reviewed_by: adminId } : {}),
    })
    .eq('id', uid)
    .eq('kyc_status', 'pending')
    .select()
    .maybeSingle()
  if (!u) return null
  await send(
    uid,
    verified
      ? '✅ Ваш аккаунт подтверждён! В профиле появилась отметка «Подтверждён», лимит обмена увеличен.'
      : `✖️ Верификация не пройдена: ${esc(u.kyc_note)}. Проверьте анкету и отправьте её снова.`,
    { reply_markup: appButton('Открыть профиль', 'kyc') },
  )
  await pushU(uid, verified ? 'Аккаунт подтверждён' : 'Верификация не пройдена', verified ? 'Лимит обмена увеличен до 5 000 000 ₸.' : `${u.kyc_note}. Отправьте анкету снова.`, 'kyc')
  return u
}

/** Полный сброс верификации: анкета и зашифрованные сканы */
async function kycReset(uid: number) {
  const { data: list } = await db.storage.from('kyc').list(String(uid), { limit: 1000 })
  const paths = (list ?? []).map((f) => `${uid}/${f.name}`)
  if (paths.length) await db.storage.from('kyc').remove(paths)
  await db.from('users').update({ kyc_status: 'none', kyc: null, kyc_enc: null, kyc_note: null, kyc_submitted_at: null, kyc_reviewed_at: null, kyc_reviewed_by: null }).eq('id', uid)
  return paths.length
}

initAdmin({
  db,
  tg,
  send,
  esc,
  nf,
  hmacHex: async (key, msg) => hex(await hmac(key, msg)),
  secret: () => BOT_TOKEN,
  adminIds: () => ADMIN_IDS,
  webappUrl: () => WEBAPP_URL,
  decryptJson,
  decryptBytes,
  readProfile,
  loyalty,
  orderTransition,
  kycDecide,
  kycReset,
  numify,
})

/** Обмен завершён: оборот для уровня лояльности и бонус пригласившему */
// deno-lint-ignore no-explicit-any
async function onCompleted(o: any, u: any) {
  const m = await getMarket()
  const kzt = o.amount_kzt != null ? +o.amount_kzt : +o.amount_from * cross(m, o.from_cur, 'KZT')
  const before = tierOf(Number(u.volume_kzt ?? 0))
  await db.rpc('user_credit', { uid: o.user_id, bonus: 0, volume: kzt })
  const after = tierOf(Number(u.volume_kzt ?? 0) + kzt)
  if (after.id !== before.id) {
    await send(o.user_id, `🏆 Новый уровень: <b>${after.name}</b>! Теперь комиссия на ${after.off}% ниже на все обмены.`, { reply_markup: appButton('Открыть NEX') })
    await pushU(o.user_id, `Новый уровень: ${after.name}`, `Комиссия на ${after.off}% ниже на все обмены.`, 'loyalty')
  }
  if (u.referred_by) {
    const netFeeKzt = (+o.fee_amount - +(o.bonus_used ?? 0)) * cross(m, o.to_cur, 'KZT')
    const reward = Math.floor(Math.max(0, netFeeKzt) * REF_SHARE)
    if (reward > 0) {
      await db.rpc('user_credit', { uid: u.referred_by, bonus: reward, volume: 0, ref_earned: reward })
      await send(u.referred_by, `🎁 Ваш друг совершил обмен. Вам начислено ${nf(reward, 0)} ₸ бонусов: ими можно оплатить комиссию следующего обмена.`, { reply_markup: appButton('Открыть NEX') })
      await pushU(u.referred_by, 'Бонусы за друга', `Начислено ${nf(reward, 0)} ₸ бонусов.`, 'loyalty')
    }
  }
}

const DOC_NAME: Record<string, string> = { id_card: 'Удостоверение личности', passport: 'Паспорт', residence: 'Вид на жительство' }
const FILE_NAME: Record<string, string> = { doc_front: 'Документ, лицевая сторона', doc_back: 'Документ, оборотная сторона', selfie: 'Селфи с документом', face: 'Сканирование лица', doc_face: 'Фото из документа' }

// deno-lint-ignore no-explicit-any
async function sendKycToAdmin(chat: number, u: any, withPhotos = true) {
  // deno-lint-ignore no-explicit-any
  let k: any = u.kyc ?? {}
  if (u.kyc_enc) {
    try {
      k = await decryptJson(u.kyc_enc)
    } catch (e) {
      console.error('kyc decrypt', e)
    }
  }
  const files: Record<string, string> = Array.isArray(k.files) ? Object.fromEntries(k.files.map((p: string, i: number) => [i ? 'face' : 'doc_front', p])) : k.files ?? {}
  if (withPhotos && Object.keys(files).length) {
    const fd = new FormData()
    fd.append('chat_id', String(chat))
    const media = []
    for (const [key, path] of Object.entries(files)) {
      const { data } = await db.storage.from('kyc').download(path)
      if (!data) continue
      let bytes: Uint8Array = new Uint8Array(await data.arrayBuffer())
      if (path.endsWith('.bin')) bytes = await decryptBytes(bytes)
      fd.append(key, new Blob([bytes as BlobPart], { type: 'image/jpeg' }), `${key}.jpg`)
      media.push({ type: 'photo', media: `attach://${key}`, caption: FILE_NAME[key] ?? key })
    }
    if (media.length) {
      fd.append('media', JSON.stringify(media))
      await tg('sendMediaGroup', fd)
    }
  }
  const checks: { label: string; ok: boolean | null; note?: string }[] = Array.isArray(k.checks) ? k.checks : []
  const mark = (ok: boolean | null) => (ok === true ? '✅' : ok === false ? '❌' : '➖')
  const failed = checks.filter((c) => c.ok === false).length
  return send(
    chat,
    [
      '🪪 <b>Анкета на верификацию</b>',
      '',
      `👤 ${clientLine(u)}  ID: <code>${u.id}</code>`,
      checks.length ? (k.auto_passed ? '🟢 <b>Проверка данных пройдена</b>' : `🟠 <b>Проверка данных не пройдена</b> (${failed} из ${checks.length})`) : '',
      '',
      `ФИО: ${esc(k.full_name)}`,
      k.latin_name ? `Латиницей: ${esc(k.latin_name)}` : '',
      `Дата рождения: ${esc(k.birth_date)}`,
      `Гражданство: ${esc(k.citizenship)}`,
      `Документ: ${esc(DOC_NAME[k.doc_type] ?? k.doc_type)}, № ${esc(k.doc_number)}`,
      k.personal_number ? `ИИН / личный номер: ${esc(k.personal_number)}` : '',
      k.issued_by ? `Кем выдан: ${esc(k.issued_by)}` : '',
      k.issue_date ? `Дата выдачи: ${esc(k.issue_date)}` : '',
      k.expiry_date ? `Действителен до: ${esc(k.expiry_date)}` : '',
      k.birth_place ? `Место рождения: ${esc(k.birth_place)}` : '',
      `Телефон: ${esc(k.phone)}`,
      k.address ? `Адрес: ${esc(k.address)}` : '',
      ...(checks.length ? ['', '<b>Автоматическая проверка данных</b>', ...checks.map((c) => `${mark(c.ok)} ${esc(c.label)}${c.note ? ` (${esc(c.note)})` : ''}`)] : []),
      '',
      'Сверьте фото выше с данными: лицо на селфи совпадает с фото в документе, данные читаются и совпадают. Затем нажмите кнопку.',
    ]
      .filter((l, i, a) => l !== '' || a[i - 1] !== '')
      .join('\n'),
    { reply_markup: { inline_keyboard: [[{ text: '✅ Одобрить', callback_data: `kyc_ok:${u.id}` }, { text: '✖️ Отклонить', callback_data: `kyc_no:${u.id}` }]] } },
  )
}

/** Домен приложения для Face ID (WebAuthn): ключи привязаны к нему */
function rpInfo() {
  try {
    const u = new URL(WEBAPP_URL)
    return { id: u.hostname, origin: u.origin }
  } catch {
    return null
  }
}

/** Контрольный разряд ИИН РК */
function iinValid(s: string) {
  if (!/^\d{12}$/.test(s)) return false
  const d = s.split('').map(Number)
  let c = d.slice(0, 11).reduce((a, x, i) => a + x * (i + 1), 0) % 11
  if (c === 10) {
    c = d.slice(0, 11).reduce((a, x, i) => a + x * (((i + 2) % 11) + 1), 0) % 11
    if (c === 10) return false
  }
  return c === d[11]
}
function iinToBirth(s: string) {
  const c = +s[6]
  const century = c <= 2 ? 1800 : c <= 4 ? 1900 : 2000
  return `${century + +s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`
}
/** Сигнатура JPEG, PNG или WebP: на сервер принимаются только изображения */
function isImage(b: Uint8Array) {
  return (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45)
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
    if (String(u._start).startsWith('ref_')) await applyReferral(u.id, String(u._start).slice(4))
    return json({ token: await makeToken(u.id) })
  }
  if (path === '/auth/link/start' && method === 'POST') {
    // Ограничение частоты: не больше 5 попыток входа в минуту с одного адреса
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? ''
    const ipHash = hex(await hmac('nex-ip', ip)).slice(0, 32)
    const { count } = await db
      .from('login_codes')
      .select('*', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', new Date(Date.now() - 60_000).toISOString())
    if ((count ?? 0) >= 5) return fail('Слишком много попыток. Подождите минуту.', 429)
    const code = hex(crypto.getRandomValues(new Uint8Array(16)))
    const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 9000 + 1000)
    await db.from('login_codes').insert({ code, pin, ip_hash: ipHash })
    return json({ code, pin, url: `https://t.me/${await botInfo()}?start=login_${code}` })
  }
  if (path === '/auth/link/poll' && method === 'GET') {
    const code = new URL(req.url).searchParams.get('code') ?? ''
    const { data } = await db.from('login_codes').select('user_id, created_at').eq('code', code).maybeSingle()
    if (!data || Date.now() - new Date(data.created_at).getTime() > 10 * 60_000) return fail('Код устарел', 410)
    if (!data.user_id) return json({})
    await db.from('login_codes').delete().eq('code', code)
    return json({ token: await makeToken(data.user_id) })
  }

  if (path === '/auth/phone/start' && method === 'POST') {
    const b = await req.json().catch(() => ({}))
    const phone = normPhone(b.phone)
    if (!phone) return fail('Введите номер телефона полностью')
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? ''
    const ipHash = hex(await hmac('nex-ip', ip)).slice(0, 32)
    const since = new Date(Date.now() - 10 * 60_000).toISOString()
    const [{ count: byIp }, { count: byPhone }] = await Promise.all([
      db.from('phone_logins').select('*', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since),
      db.from('phone_logins').select('*', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since),
    ])
    if ((byIp ?? 0) >= 8 || (byPhone ?? 0) >= 4) return fail('Слишком много попыток. Попробуйте через 10 минут.', 429)
    const sid = hex(crypto.getRandomValues(new Uint8Array(16)))
    await db.from('phone_logins').insert({ sid, phone, ip_hash: ipHash })
    const { data: owner } = await db.from('users').select('id, blocked').eq('phone', phone).eq('phone_verified', true).maybeSingle()
    if (owner && !owner.blocked) {
      await db.from('phone_logins').update({ tg_user_id: owner.id }).eq('sid', sid)
      if (await sendOtp(sid, owner.id)) return json({ sid, sent: true })
    }
    // Номер ещё не привязан: один раз подтверждаем его в боте
    const me = await botInfo()
    return json({ sid, sent: false, url: `https://t.me/${me}?start=ph_${sid}` })
  }
  if (path === '/auth/phone/status' && method === 'GET') {
    const sid = new URL(req.url).searchParams.get('sid') ?? ''
    const { data } = await db.from('phone_logins').select('otp_sent_at, created_at').eq('sid', sid).maybeSingle()
    if (!data || Date.now() - new Date(data.created_at).getTime() > 15 * 60_000) return fail('Время входа истекло, начните заново', 410)
    return json({ sent: !!data.otp_sent_at })
  }
  if (path === '/auth/phone/resend' && method === 'POST') {
    const b = await req.json().catch(() => ({}))
    const { data } = await db.from('phone_logins').select('sid, tg_user_id, otp_sent_at, sends, created_at').eq('sid', String(b.sid ?? '')).maybeSingle()
    if (!data || !data.tg_user_id || Date.now() - new Date(data.created_at).getTime() > 15 * 60_000) return fail('Время входа истекло, начните заново', 410)
    if (data.otp_sent_at && Date.now() - new Date(data.otp_sent_at).getTime() < 60_000) return fail('Отправить код повторно можно через минуту', 429)
    if ((data.sends ?? 0) >= 3) return fail('Код уже отправлялся 3 раза. Начните вход заново.', 429)
    await sendOtp(data.sid, data.tg_user_id)
    return json({ sent: true })
  }
  if (path === '/auth/phone/verify' && method === 'POST') {
    const b = await req.json().catch(() => ({}))
    const sid = String(b.sid ?? '')
    const code = String(b.code ?? '').replace(/\D/g, '')
    const { data } = await db.from('phone_logins').select('*').eq('sid', sid).maybeSingle()
    if (!data || !data.otp_hash || Date.now() - new Date(data.otp_sent_at).getTime() > OTP_TTL) return fail('Код устарел. Запросите новый.', 410)
    if (data.attempts >= 5) {
      await db.from('phone_logins').delete().eq('sid', sid)
      return fail('Слишком много неверных попыток. Начните вход заново.', 429)
    }
    // Сначала засчитываем попытку, потом сверяем: перебор невозможен даже параллельными запросами
    const { data: upd } = await db.from('phone_logins').update({ attempts: data.attempts + 1 }).eq('sid', sid).eq('attempts', data.attempts).select('sid').maybeSingle()
    if (!upd) return fail('Попробуйте ещё раз', 409)
    if (!safeEq(await otpHash(sid, code), data.otp_hash)) return fail(`Неверный код. Осталось попыток: ${4 - data.attempts}`, 400, { code: 'bad_otp' })
    await db.from('phone_logins').delete().eq('sid', sid)
    const u = await getUser(data.user_id)
    if (!u || u.blocked) return fail('Доступ ограничен. Обратитесь в поддержку.', 403)
    await send(data.user_id, '✅ Выполнен вход в NEX по номеру телефона. Если это были не вы, напишите в поддержку.')
    return json({ token: await makeToken(data.user_id) })
  }

  /* ----- вход по Face ID / Touch ID (passkey) ----- */
  if (path === '/auth/passkey/login/options' && method === 'POST') {
    const rp = rpInfo()
    if (!rp) return fail('Вход по Face ID недоступен', 503)
    const ipHash = hex(await hmac('nex-ip', req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '')).slice(0, 32)
    const { count } = await db.from('webauthn_challenges').select('*', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
    if ((count ?? 0) >= 20) return fail('Слишком много попыток. Попробуйте через 10 минут.', 429)
    const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: 'required', timeout: 60_000 })
    const cid = hex(crypto.getRandomValues(new Uint8Array(16)))
    await db.from('webauthn_challenges').insert({ id: cid, kind: 'login', challenge: options.challenge, ip_hash: ipHash })
    return json({ cid, options })
  }
  if (path === '/auth/passkey/login/verify' && method === 'POST') {
    const rp = rpInfo()
    const b = await req.json().catch(() => ({}))
    // Вызов одноразовый: удаляем сразу, повторить тот же ответ нельзя
    const { data: ch } = await db.from('webauthn_challenges').delete().eq('id', String(b.cid ?? '')).eq('kind', 'login').select().maybeSingle()
    if (!rp || !ch || Date.now() - new Date(ch.created_at).getTime() > 2 * 60_000) return fail('Время ожидания истекло. Попробуйте ещё раз.', 410)
    const credId = String(b.response?.id ?? '')
    const { data: pk } = await db.from('passkeys').select('*').eq('id', credId).maybeSingle()
    if (!pk) return fail('Этот Face ID не привязан к аккаунту NEX. Войдите по номеру телефона и включите Face ID в профиле.', 404)
    let v
    try {
      v = await verifyAuthenticationResponse({
        response: b.response,
        expectedChallenge: ch.challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.id,
        requireUserVerification: true,
        credential: { id: pk.id, publicKey: fromB64(pk.public_key), counter: Number(pk.counter), transports: pk.transports ?? undefined },
      })
    } catch (e) {
      console.error('passkey login', e)
      return fail('Не удалось подтвердить Face ID', 401)
    }
    if (!v.verified) return fail('Не удалось подтвердить Face ID', 401)
    await db.from('passkeys').update({ counter: v.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq('id', pk.id)
    const u = await getUser(pk.user_id)
    if (!u || u.blocked) return fail('Доступ ограничен. Обратитесь в поддержку.', 403)
    return json({ token: await makeToken(pk.user_id) })
  }
  if (path === '/push/key' && method === 'GET') return json({ key: (await vapidKey(db)).pub })

  // ниже нужна авторизация
  const uid = await readToken(req.headers.get('x-nex-token'))
  if (!uid) return fail('Сессия истекла, войдите снова', 401)
  const user = await getUser(uid)
  if (!user) return fail('Пользователь не найден', 401)
  if (user.blocked) return fail('Доступ ограничен. Обратитесь в поддержку.', 403)

  if (path === '/me' && method === 'GET') return json(await publicUser(user))

  if (path === '/profile' && method === 'POST') {
    const b = await req.json()
    const full_name = String(b.full_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const birth_date = String(b.birth_date ?? '').trim()
    if (full_name.split(' ').length < 2 || !/^[\p{L}\s'.-]+$/u.test(full_name)) return fail('Укажите фамилию и имя полностью')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth_date)) return fail('Укажите дату рождения')
    const age = (Date.now() - new Date(birth_date).getTime()) / (365.25 * 86400_000)
    if (!(age >= 18 && age < 110)) return fail('Сервис доступен с 18 лет')
    const patch: Record<string, unknown> = { profile_enc: await encryptJson({ full_name, birth_date }) }
    if (!user.phone_verified) {
      const phone = normPhone(b.phone)
      if (!phone) return fail('Укажите номер телефона')
      patch.phone = phone
    }
    patch.profile_done = true
    await db.from('users').update(patch).eq('id', uid)
    return json(await publicUser(await getUser(uid)))
  }

  if (path === '/orders' && method === 'GET') {
    const { data } = await db
      .from('orders')
      .select('id, from_cur, to_cur, amount_from, amount_to, rate, fee_pct, fee_base_pct, discounts, fee_amount, bonus_used, bonus_used_kzt, method, details, note, status, admin_note, created_at, accepted_at, completed_at')
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
    if (!user.profile_done || !user.phone) return fail('Заполните ФИО, телефон и дату рождения', 400, { code: 'profile' })
    const { count } = await db.from('orders').select('*', { count: 'exact', head: true }).eq('user_id', uid).in('status', ['new', 'accepted'])
    if ((count ?? 0) >= MAX_ACTIVE_ORDERS) return fail(`Не больше ${MAX_ACTIVE_ORDERS} активных заявок одновременно. Дождитесь завершения текущих.`)
    const m = await getMarket()
    const kzt = amount * cross(m, from, 'KZT')
    const max = user.kyc_status === 'verified' ? MAX_KZT_VERIFIED : MAX_KZT
    if (kzt < MIN_KZT) return fail(`Минимальная сумма заявки ${nf(MIN_KZT, 0)} ₸ в эквиваленте`)
    if (kzt > max)
      return fail(
        user.kyc_status === 'verified' ? `Максимальная сумма заявки ${nf(max, 0)} ₸ в эквиваленте` : `Для суммы больше ${nf(max, 0)} ₸ нужно подтвердить документы`,
        400,
        user.kyc_status === 'verified' ? {} : { code: 'kyc' },
      )
    const loy = await loyalty(user)
    const price = pricing(loy.volume_kzt, kzt, loy.welcome)
    const rate = cross(m, from, to)
    const gross = amount * rate
    const fee = (gross * price.fee) / 100
    // Бонусы списываются в счёт комиссии, не больше половины
    const feeKzt = fee * cross(m, to, 'KZT')
    const bonusKzt = b.use_bonus ? Math.floor(Math.min(loy.bonus_kzt, feeKzt * BONUS_MAX_SHARE)) : 0
    const bonusTo = bonusKzt * cross(m, 'KZT', to)
    const row = {
      user_id: uid,
      from_cur: from,
      to_cur: to,
      amount_from: round(amount, CUR[from].dp),
      amount_to: round(gross - fee + bonusTo, CUR[to].dp),
      rate,
      fee_pct: price.fee,
      fee_base_pct: FEE_PCT,
      discounts: price.discounts,
      fee_amount: round(fee, CUR[to].dp),
      amount_kzt: round(kzt, 2),
      bonus_used_kzt: bonusKzt,
      bonus_used: round(bonusTo, CUR[to].dp),
      method: String(b.method ?? 'Наличные').slice(0, 40),
      details: b.details ? String(b.details).slice(0, 200) : null,
      note: b.note ? String(b.note).slice(0, 500) : null,
    }
    // Атомарно в базе: защита от дублей и не чаще одной заявки в 5 минут
    const { data: r, error } = await db.rpc('create_order_guarded', { p: row, cooldown_sec: ORDER_COOLDOWN_SEC })
    if (error || !r) return fail('Не удалось создать заявку', 500)
    if (r.error === 'bonus') return fail('Бонусный баланс изменился. Обновите страницу и попробуйте снова.', 409)
    if (r.error === 'duplicate') return fail(`Такая заявка №${r.order_id} уже на рассмотрении. Дождитесь ответа оператора.`, 409, { code: 'duplicate', order_id: r.order_id })
    if (r.error === 'cooldown') {
      const sec = Number(r.retry_after)
      return fail(`Новую заявку можно создать через ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, 429, { code: 'cooldown', retry_after: sec })
    }
    const o = r.order
    await withProfile(user)
    const ids = await notifyAdmins(orderText(o, user, STATUS_HEAD.new + o.id), { reply_markup: orderKeyboard(o, user) })
    if (ids[0]) await db.from('orders').update({ admin_msg_id: ids[0] }).eq('id', o.id)
    await send(uid, `📨 Заявка №${o.id} отправлена.\n\nОтдаёте: ${money(+o.amount_from, from)}\nПолучите: ${money(+o.amount_to, to)}\n\nМы сообщим, как только оператор её примет.`)
    return json(numify(o))
  }

  const cancel = path.match(/^\/orders\/(\d+)\/cancel$/)
  if (cancel && method === 'POST') {
    const { data: o } = await db.from('orders').update({ status: 'cancelled' }).eq('id', Number(cancel[1])).eq('user_id', uid).eq('status', 'new').select().maybeSingle()
    if (!o) return fail('Заявку уже нельзя отменить')
    if (+o.bonus_used_kzt > 0) await db.rpc('user_credit', { uid, bonus: +o.bonus_used_kzt, volume: 0 })
    await withProfile(user)
    if (o.admin_msg_id)
      for (const a of ADMIN_IDS)
        await tg('editMessageText', { chat_id: a, message_id: o.admin_msg_id, text: orderText(o, user, STATUS_HEAD.cancelled + o.id), parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } })
    return json(numify(o))
  }

  if (path === '/kyc' && method === 'POST') {
    if (user.kyc_status === 'verified') return fail('Аккаунт уже подтверждён')
    if (user.kyc_status === 'pending') return fail('Анкета уже на проверке')
    const b = await req.json()
    if (!['id_card', 'passport', 'residence'].includes(b.doc_type)) return fail('Выберите документ')
    const prof = await readProfile(user)
    if (!prof.full_name || !prof.birth_date) return fail('Сначала заполните личные данные', 400, { code: 'profile' })
    const str = (k: string, n = 120) => String(b[k] ?? '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, n)
    const date = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(str(k)) && !isNaN(Date.parse(str(k))) ? str(k) : '')
    const fields = {
      full_name: prof.full_name,
      birth_date: prof.birth_date,
      citizenship: str('citizenship', 60),
      doc_number: str('doc_number', 20).toUpperCase().replace(/[^A-ZА-Я0-9]/g, ''),
      personal_number: str('personal_number', 20).replace(/[^0-9A-Za-z]/g, ''),
      issue_date: date('issue_date'),
      expiry_date: date('expiry_date'),
      issued_by: str('issued_by', 120),
      birth_place: str('birth_place', 120),
      address: str('address', 200),
      phone: user.phone ?? '',
    }
    const today = new Date().toISOString().slice(0, 10)
    if (fields.doc_number.length < 5) return fail('Введите номер документа')
    if (!fields.issue_date || fields.issue_date > today) return fail('Проверьте дату выдачи')
    if (!fields.expiry_date) return fail('Укажите срок действия документа')
    if (fields.expiry_date <= today) return fail('Срок действия документа истёк')
    if (fields.issued_by.length < 2) return fail('Укажите, кем выдан документ')
    if (!fields.citizenship) return fail('Укажите гражданство')
    if (fields.address.length < 5) return fail('Укажите адрес проживания')
    const kz = /казах|kazakh|^kz$/i.test(fields.citizenship)
    if (kz && !iinValid(fields.personal_number)) return fail('Проверьте ИИН: 12 цифр без ошибок')
    const age = (Date.now() - new Date(fields.birth_date).getTime()) / (365.25 * 86400_000)
    if (!(age >= 18 && age < 110)) return fail('Сервис доступен с 18 лет')
    const needBack = b.doc_type !== 'passport'
    const keys = ['doc_front', ...(needBack ? ['doc_back'] : []), 'selfie']
    const files: Record<string, string> = {}
    for (const key of keys) {
      const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(b.files?.[key] ?? ''))
      if (!m) return fail(key === 'selfie' ? 'Добавьте селфи с документом' : 'Добавьте фото документа')
      const bytes = fromB64(m[2])
      if (bytes.length > 4_000_000) return fail('Изображение слишком большое')
      if (!isImage(bytes)) return fail('Файл не похож на фотографию')
      // Фото шифруются до записи в хранилище
      const path = `${uid}/${Date.now()}-${key}.bin`
      const { error } = await db.storage.from('kyc').upload(path, await encryptBytes(bytes), { contentType: 'application/octet-stream', upsert: true })
      if (error) return fail('Не удалось сохранить файлы', 500)
      files[key] = path
    }
    // Автоматические проверки введённых данных: оператору видно, что сошлось, а что нет
    const iinBirth = kz && fields.personal_number.length === 12 ? iinToBirth(fields.personal_number) : null
    const checks: { id: string; label: string; ok: boolean | null; note?: string }[] = [
      { id: 'adult', label: 'Возраст 18+', ok: age >= 18 },
      { id: 'expiry', label: 'Документ действителен', ok: fields.expiry_date > today, note: fields.expiry_date },
      { id: 'dates', label: 'Дата выдачи раньше срока действия', ok: fields.issue_date < fields.expiry_date },
      { id: 'issued_after_birth', label: 'Документ выдан после 14 лет', ok: (new Date(fields.issue_date).getTime() - new Date(fields.birth_date).getTime()) / (365.25 * 86400_000) >= 14 },
      ...(kz
        ? [
            { id: 'iin', label: 'ИИН корректен (контрольная цифра)', ok: iinValid(fields.personal_number) },
            { id: 'iin_dob', label: 'ИИН совпадает с датой рождения', ok: iinBirth === fields.birth_date, note: iinBirth ?? undefined },
            { id: 'doc_format', label: 'Формат номера документа', ok: b.doc_type === 'id_card' ? /^\d{9}$/.test(fields.doc_number) : b.doc_type === 'passport' ? /^N\d{8}$/.test(fields.doc_number) : null },
          ]
        : []),
      { id: 'phone', label: 'Телефон подтверждён Telegram', ok: !!user.phone_verified },
    ]
    const passed = checks.every((c) => c.ok !== false)
    const kyc: Record<string, unknown> = {
      ...fields,
      doc_type: b.doc_type,
      checks,
      auto_passed: passed,
      files,
      submitted_at: new Date().toISOString(),
    }
    const { data: u } = await db
      .from('users')
      .update({ kyc: null, kyc_enc: await encryptJson(kyc), kyc_status: 'pending', kyc_note: null, kyc_submitted_at: new Date().toISOString() })
      .eq('id', uid)
      .select('*')
      .single()
    for (const a of ADMIN_IDS) await sendKycToAdmin(a, u)
    return json(await publicUser(await getUser(uid)))
  }

  /* ----- push-подписки ----- */
  if (path === '/push/subscribe' && method === 'POST') {
    const b = await req.json().catch(() => ({}))
    const endpoint = String(b.endpoint ?? '')
    const p256dh = String(b.keys?.p256dh ?? '')
    const auth = String(b.keys?.auth ?? '')
    if (!pushEndpointOk(endpoint) || endpoint.length > 1000 || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,30}$/.test(auth)) return fail('Некорректная подписка')
    const { count } = await db.from('push_subs').select('*', { count: 'exact', head: true }).eq('user_id', uid)
    if ((count ?? 0) >= 10) {
      const { data: old } = await db.from('push_subs').select('id').eq('user_id', uid).order('created_at').limit(1)
      if (old?.[0]) await db.from('push_subs').delete().eq('id', old[0].id)
    }
    await db.from('push_subs').upsert({ user_id: uid, endpoint, p256dh, auth, ua: String(req.headers.get('user-agent') ?? '').slice(0, 200) }, { onConflict: 'endpoint' })
    return json({ ok: true })
  }
  if (path === '/push/unsubscribe' && method === 'POST') {
    const b = await req.json().catch(() => ({}))
    await db.from('push_subs').delete().eq('user_id', uid).eq('endpoint', String(b.endpoint ?? ''))
    return json({ ok: true })
  }
  if (path === '/push/test' && method === 'POST') {
    const n = await pushToUser(db, uid, { title: 'Уведомления включены', body: 'Сюда будут приходить статусы заявок и важные новости.', url: '/' }, WEBAPP_URL)
    return json({ sent: n })
  }

  /* ----- Face ID: привязка и список ----- */
  if (path === '/passkeys' && method === 'GET') {
    const { data } = await db.from('passkeys').select('id, device, created_at, last_used_at').eq('user_id', uid).order('created_at')
    return json((data ?? []).map((p) => ({ ...p, id: p.id.slice(0, 16) })))
  }
  if (path === '/passkeys/register/options' && method === 'POST') {
    const rp = rpInfo()
    if (!rp) return fail('Вход по Face ID недоступен', 503)
    const { data: existing } = await db.from('passkeys').select('id, transports').eq('user_id', uid)
    if ((existing?.length ?? 0) >= 5) return fail('Можно привязать не больше 5 устройств. Удалите старое.')
    const options = await generateRegistrationOptions({
      rpName: 'NEX',
      rpID: rp.id,
      userID: enc.encode(String(uid)),
      userName: user.phone ?? user.username ?? `NEX ${uid}`,
      userDisplayName: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'NEX',
      attestationType: 'none',
      excludeCredentials: (existing ?? []).map((p) => ({ id: p.id, transports: p.transports ?? undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
      timeout: 60_000,
    })
    const cid = hex(crypto.getRandomValues(new Uint8Array(16)))
    await db.from('webauthn_challenges').delete().eq('user_id', uid).eq('kind', 'register')
    await db.from('webauthn_challenges').insert({ id: cid, user_id: uid, kind: 'register', challenge: options.challenge })
    return json({ cid, options })
  }
  if (path === '/passkeys/register/verify' && method === 'POST') {
    const rp = rpInfo()
    const b = await req.json().catch(() => ({}))
    const { data: ch } = await db.from('webauthn_challenges').delete().eq('id', String(b.cid ?? '')).eq('user_id', uid).eq('kind', 'register').select().maybeSingle()
    if (!rp || !ch || Date.now() - new Date(ch.created_at).getTime() > 2 * 60_000) return fail('Время ожидания истекло. Попробуйте ещё раз.', 410)
    let v
    try {
      v = await verifyRegistrationResponse({ response: b.response, expectedChallenge: ch.challenge, expectedOrigin: rp.origin, expectedRPID: rp.id, requireUserVerification: true })
    } catch (e) {
      console.error('passkey register', e)
      return fail('Не удалось подключить Face ID')
    }
    if (!v.verified || !v.registrationInfo) return fail('Не удалось подключить Face ID')
    const c = v.registrationInfo.credential
    await db.from('passkeys').insert({ id: c.id, user_id: uid, public_key: toB64(c.publicKey), counter: c.counter, transports: c.transports ?? null, device: String(b.device ?? '').slice(0, 60) || null })
    await send(uid, '🔐 Вход по Face ID / Touch ID включён для NEX. Если это были не вы, напишите в поддержку.')
    return json({ ok: true })
  }
  const delPk = path.match(/^\/passkeys\/([A-Za-z0-9_-]{8,})$/)
  if (delPk && method === 'DELETE') {
    const { data } = await db.from('passkeys').select('id').eq('user_id', uid)
    const hitPk = (data ?? []).find((p) => p.id.startsWith(delPk[1]))
    if (hitPk) await db.from('passkeys').delete().eq('id', hitPk.id).eq('user_id', uid)
    return json({ ok: true })
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
  for (const k of ['amount_from', 'amount_to', 'rate', 'fee_pct', 'fee_base_pct', 'fee_amount', 'bonus_used', 'bonus_used_kzt', 'target']) if (o[k] != null) o[k] = Number(o[k])
  return o
}

/* ---------------- уведомления о курсе (cron) ---------------- */
/** Повторная отправка заявок, уведомление о которых не дошло до оператора (сбой сети, лимиты Telegram) */
async function resendUnnotified() {
  const { data } = await db
    .from('orders')
    .select('*, users(*)')
    .eq('status', 'new')
    .is('admin_msg_id', null)
    .lt('created_at', new Date(Date.now() - 60_000).toISOString())
    .limit(20)
  for (const o of data ?? []) {
    await withProfile(o.users)
    const ids = await notifyAdmins(orderText(o, o.users, '🔁 ' + STATUS_HEAD.new + o.id), { reply_markup: orderKeyboard(o, o.users) })
    if (ids[0]) await db.from('orders').update({ admin_msg_id: ids[0] }).eq('id', o.id)
  }
}

async function checkAlerts() {
  const { data } = await db.from('rate_alerts').select('*').eq('active', true).limit(1000)
  if (!data?.length) {
    await resendUnnotified()
    return { checked: 0, fired: 0 }
  }
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
      await pushU(a.user_id, `Курс ${a.base}/${a.quote}: ${nf(r, 4)}`, `${a.direction === 'above' ? 'Вырос' : 'Опустился'} до вашей цели ${nf(+a.target, 4)}.`)
      fired++
    }
  }
  await resendUnnotified()
  // чистим старые коды входа
  await db.from('login_codes').delete().lt('created_at', new Date(Date.now() - 86400_000).toISOString())
  await db.from('phone_logins').delete().lt('created_at', new Date(Date.now() - 86400_000).toISOString())
  await db.from('webauthn_challenges').delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString())
  await adminCleanup()
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
          commands: ADMIN_COMMANDS,
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
  const url = new URL(req.url)
  const path = url.pathname.replace(/^.*?\/nex(?=\/|$)/, '') || '/'
  if (path.startsWith('/admin/')) {
    try {
      await loadConfig()
      return await adminApi(req, path)
    } catch (e) {
      console.error('admin', e)
      return new Response(JSON.stringify({ error: 'Ошибка сервера' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    }
  }
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
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
