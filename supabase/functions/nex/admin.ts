// Админ-панель NEX: вход в два шага (пароль и код в Telegram), роли, сессии, журнал действий.
// Все проверки прав выполняются здесь, на сервере. Интерфейс только показывает то, что разрешено.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'

export interface AdminCtx {
  db: SupabaseClient
  tg: (method: string, body: Record<string, unknown>) => Promise<any>
  send: (chat: number, text: string, extra?: Record<string, unknown>) => Promise<any>
  esc: (s: unknown) => string
  nf: (n: number, dp?: number) => string
  hmacHex: (key: string, msg: string) => Promise<string>
  secret: () => string // BOT_TOKEN, из него выводятся ключи подписи
  adminIds: () => number[]
  webappUrl: () => string
  decryptJson: (s: string) => Promise<any>
  decryptBytes: (b: Uint8Array) => Promise<Uint8Array>
  readProfile: (u: any) => Promise<{ full_name?: string; birth_date?: string }>
  loyalty: (u: any) => Promise<any>
  orderTransition: (id: number, action: 'acc' | 'done' | 'rej', adminId: number | null) => Promise<{ error: string } | { o: any; upd: any }>
  kycDecide: (uid: number, verified: boolean, note: string | null, adminId: number | null) => Promise<any>
  kycReset: (uid: number) => Promise<number>
  numify: (o: any) => any
}

let C: AdminCtx
export function initAdmin(ctx: AdminCtx) {
  C = ctx
}

/* ---------------- роли и права ---------------- */
export const ROLES = ['owner', 'admin', 'operator', 'viewer'] as const
type Role = (typeof ROLES)[number]
const PERMS: Record<Role, string[]> = {
  owner: ['*'],
  admin: ['stats', 'finance', 'orders.read', 'orders.act', 'orders.export', 'users.read', 'users.pii', 'users.block', 'users.bonus', 'kyc.read', 'kyc.act', 'kyc.reset', 'audit.read', 'team.read'],
  operator: ['stats', 'orders.read', 'orders.act', 'users.read', 'users.pii', 'kyc.read', 'kyc.act'],
  viewer: ['stats', 'finance', 'orders.read', 'users.read'],
}
const can = (role: Role, p: string) => PERMS[role]?.includes('*') || PERMS[role]?.includes(p)
const permsOf = (role: Role) =>
  PERMS[role].includes('*')
    ? ['stats', 'finance', 'orders.read', 'orders.act', 'orders.export', 'users.read', 'users.pii', 'users.block', 'users.bonus', 'kyc.read', 'kyc.act', 'kyc.reset', 'audit.read', 'team.read', 'team.manage']
    : PERMS[role]

/* ---------------- параметры безопасности ---------------- */
const SESSION_IDLE = 30 * 60_000 // без активности
const SESSION_MAX = 12 * 3600_000 // абсолютный срок
const CODE_TTL = 5 * 60_000
const INVITE_TTL = 30 * 60_000
const PBKDF2_ITER = 210_000
const LOCK_AFTER = 5
const LOCK_FOR = 15 * 60_000

/* ---------------- криптография ---------------- */
const enc = new TextEncoder()
const hexOf = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const rand = (n: number) => hexOf(crypto.getRandomValues(new Uint8Array(n)))
const sha256 = async (s: string) => hexOf(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))))
function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
async function pbkdf2(password: string, salt: string, iter: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: iter }, key, 256)
  return hexOf(new Uint8Array(bits))
}
async function hashPassword(p: string) {
  const salt = rand(16)
  return `pbkdf2-sha256$${PBKDF2_ITER}$${salt}$${await pbkdf2(p, salt, PBKDF2_ITER)}`
}
// Для несуществующего логина считаем такой же хеш, чтобы время ответа не выдавало, есть ли логин
const DUMMY = `pbkdf2-sha256$${PBKDF2_ITER}$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000`
async function checkPassword(p: string, stored: string | null) {
  const [, iter, salt, h] = (stored || DUMMY).split('$')
  const got = await pbkdf2(p, salt, Number(iter))
  return !!stored && safeEq(got, h)
}
const codeHash = async (id: string, code: string) => C.hmacHex(await C.hmacHex('nex-admin-2fa', C.secret()), `${id}:${code}`)
const netHash = async (s: string) => (await C.hmacHex('nex-admin-net', s)).slice(0, 32)

function passwordProblem(p: string, login: string): string | null {
  if (p.length < 10) return 'Пароль должен быть не короче 10 символов'
  if (p.length > 128) return 'Пароль слишком длинный'
  if (!/[a-zа-я]/i.test(p) || !/\d/.test(p)) return 'В пароле должны быть буквы и цифры'
  if (p.toLowerCase().includes(login.toLowerCase())) return 'Пароль не должен содержать логин'
  if (/^(.)\1+$/.test(p) || /^(?:0123456789|1234567890|qwertyuiop)/i.test(p)) return 'Пароль слишком простой'
  return null
}

/* ---------------- HTTP ---------------- */
function allowedOrigin(req: Request) {
  const origin = req.headers.get('origin') ?? ''
  let app = ''
  try {
    app = new URL(C.webappUrl()).origin
  } catch {
    /* ignore */
  }
  return origin && origin === app ? origin : ''
}
function headers(req: Request, extra: Record<string, string> = {}) {
  const o = allowedOrigin(req)
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
    ...(o ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'content-type, x-admin-token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600' } : {}),
    ...extra,
  }
}
const out = (req: Request, data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: headers(req) })
const bad = (req: Request, msg: string, status = 400, extra: Record<string, unknown> = {}) => out(req, { error: msg, ...extra }, status)

const clientIp = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? ''
function shortUa(ua: string) {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /YaBrowser/.test(ua) ? 'Яндекс Браузер' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Браузер'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua) ? 'macOS' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${b}, ${os}` : b
}
function maskIp(ip: string) {
  if (ip.includes('.')) return ip.split('.').slice(0, 2).join('.') + '.x.x'
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + ':…'
  return 'неизвестен'
}

async function audit(adminId: number | null, action: string, target: string | null, meta: Record<string, unknown> | null, req?: Request) {
  await C.db.from('admin_audit').insert({ admin_id: adminId, action, target, meta, ip_hash: req ? await netHash(clientIp(req)) : null })
}

/** Ограничение частоты: не больше max событий с ключом за окно */
async function limited(key: string, max: number, windowMs: number) {
  const since = new Date(Date.now() - windowMs).toISOString()
  const { count } = await C.db.from('admin_attempts').select('*', { count: 'exact', head: true }).eq('key', key).gte('created_at', since)
  return (count ?? 0) >= max
}
const hit = (key: string) => C.db.from('admin_attempts').insert({ key })

/* ---------------- сессии ---------------- */
interface Admin {
  id: number
  login: string
  name: string
  role: Role
  tg_id: number
  active: boolean
}
async function readSession(req: Request): Promise<{ admin: Admin; sid: string } | { error: string; status: number }> {
  const token = req.headers.get('x-admin-token') ?? ''
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: 'Войдите в панель', status: 401 }
  const sid = await sha256(token)
  const { data: s } = await C.db.from('admin_sessions').select('*, admin_users(*)').eq('id', sid).maybeSingle()
  const now = Date.now()
  if (!s || s.revoked_at || new Date(s.expires_at).getTime() < now || now - new Date(s.last_seen_at).getTime() > SESSION_IDLE) return { error: 'Сессия завершена, войдите снова', status: 401 }
  // Сессия привязана к браузеру: украденный токен не сработает в другом
  if (s.ua_hash !== (await netHash(req.headers.get('user-agent') ?? ''))) {
    await C.db.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', sid)
    await audit(s.admin_id, 'session.ua_mismatch', null, null, req)
    return { error: 'Сессия завершена, войдите снова', status: 401 }
  }
  const a = s.admin_users
  if (!a || !a.active) return { error: 'Доступ отключён', status: 403 }
  if (now - new Date(s.last_seen_at).getTime() > 30_000) await C.db.from('admin_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', sid)
  return { admin: { id: a.id, login: a.login, name: a.name, role: a.role, tg_id: a.tg_id, active: a.active }, sid }
}
async function createSession(req: Request, adminId: number) {
  const token = rand(32)
  const ua = req.headers.get('user-agent') ?? ''
  await C.db.from('admin_sessions').insert({
    id: await sha256(token),
    admin_id: adminId,
    ip_hash: await netHash(clientIp(req)),
    ua_hash: await netHash(ua),
    ua: shortUa(ua),
    expires_at: new Date(Date.now() + SESSION_MAX).toISOString(),
  })
  return token
}
const publicAdmin = (a: Admin) => ({ id: a.id, login: a.login, name: a.name, role: a.role, perms: permsOf(a.role) })

/* ---------------- приглашения ---------------- */
async function makeInvite(fields: { role?: Role; tg_id?: number; name?: string; admin_id?: number; created_by?: number | null }) {
  const token = rand(24)
  await C.db.from('admin_invites').insert({ token_hash: await sha256(token), ...fields, expires_at: new Date(Date.now() + INVITE_TTL).toISOString() })
  const base = C.webappUrl().replace(/\/$/, '')
  return `${base}/admin/#invite=${token}`
}

/* ---------------- бот: команда /panel и кнопка «Это не я» ---------------- */
export async function adminBotCommand(from: { id: number; first_name?: string }, arg: string | undefined) {
  const { data: me } = await C.db.from('admin_users').select('id, login, active').eq('tg_id', from.id).maybeSingle()
  const base = C.webappUrl().replace(/\/$/, '')
  if (me && arg !== 'reset') {
    return C.send(
      from.id,
      `🖥 <b>Панель управления NEX</b>\n\n${base}/admin/\n\nВаш логин: <code>${C.esc(me.login)}</code>\nЗабыли пароль? Отправьте <code>/panel reset</code>.`,
      { disable_web_page_preview: true },
    )
  }
  const link = me
    ? await makeInvite({ admin_id: me.id, created_by: me.id })
    : await makeInvite({ role: 'owner', tg_id: from.id, name: from.first_name ?? '' })
  await audit(me?.id ?? null, me ? 'invite.reset_self' : 'invite.owner', String(from.id), null)
  return C.send(
    from.id,
    `🔐 ${me ? 'Ссылка для смены пароля' : 'Ссылка для создания учётной записи владельца'} панели NEX:\n\n${link}\n\nДействует 30 минут и только один раз. Никому её не пересылайте.`,
    { protect_content: true, disable_web_page_preview: true },
  )
}

export async function adminBotCallback(q: any, action: string, id: string) {
  const answer = (text = '', alert = false) => C.tg('answerCallbackQuery', { callback_query_id: q.id, text, show_alert: alert })
  if (action !== 'admno') return false
  const { data: ch } = await C.db.from('admin_challenges').select('admin_id').eq('id', id).maybeSingle()
  const { data: me } = await C.db.from('admin_users').select('id').eq('tg_id', q.from.id).maybeSingle()
  if (ch && me && ch.admin_id === me.id) {
    await C.db.from('admin_challenges').delete().eq('admin_id', me.id)
    await C.db.from('admin_users').update({ locked_until: new Date(Date.now() + LOCK_FOR).toISOString() }).eq('id', me.id)
    await audit(me.id, 'login.denied_by_owner', null, null)
  }
  await C.tg('editMessageText', {
    chat_id: q.message.chat.id,
    message_id: q.message.message_id,
    text: '🛑 Вход отменён, учётная запись заблокирована на 15 минут. Кто-то знает ваш пароль: смените его командой /panel reset.',
  })
  await answer('Вход отменён')
  return true
}

/* ---------------- данные ---------------- */
const RANGES: Record<string, { days: number; bucket: string }> = {
  week: { days: 7, bucket: 'day' },
  month: { days: 30, bucket: 'day' },
  quarter: { days: 90, bucket: 'week' },
  year: { days: 365, bucket: 'month' },
}
const maskPhone = (p: string | null) => (p ? p.slice(0, 4) + ' *** ** ' + p.slice(-2) : null)

async function userRow(u: any, pii: boolean) {
  const prof = pii ? await C.readProfile(u) : {}
  return {
    id: u.id,
    first_name: u.first_name,
    last_name: u.last_name,
    username: u.username,
    photo_url: u.photo_url,
    phone: pii ? u.phone : maskPhone(u.phone),
    phone_verified: u.phone_verified,
    full_name: pii ? prof.full_name ?? null : null,
    birth_date: pii ? prof.birth_date ?? null : null,
    profile_done: u.profile_done,
    kyc_status: u.kyc_status,
    kyc_note: u.kyc_note,
    kyc_submitted_at: u.kyc_submitted_at,
    blocked: u.blocked,
    created_at: u.created_at,
    last_seen_at: u.last_seen_at,
    bonus_kzt: Number(u.bonus_kzt ?? 0),
    volume_kzt: Number(u.volume_kzt ?? 0),
    ref_earned_kzt: Number(u.ref_earned_kzt ?? 0),
    ref_code: u.ref_code,
    referred_by: u.referred_by,
  }
}
function orderRow(o: any, pii: boolean) {
  const u = o.users
  return {
    ...C.numify({ ...o, users: undefined }),
    amount_kzt: o.amount_kzt != null ? Number(o.amount_kzt) : null,
    user: u ? { id: u.id, first_name: u.first_name, last_name: u.last_name, username: u.username, phone: pii ? u.phone : maskPhone(u.phone), kyc_status: u.kyc_status } : null,
  }
}
async function decryptKyc(u: any) {
  let k: any = u.kyc ?? {}
  if (u.kyc_enc) k = await C.decryptJson(u.kyc_enc)
  return k
}

/* ---------------- роутер ---------------- */
export async function adminApi(req: Request, path: string): Promise<Response> {
  const method = req.method
  if (method === 'OPTIONS') return new Response(null, { status: allowedOrigin(req) ? 204 : 403, headers: headers(req) })
  // Панель работает только со своего адреса: запросы с чужих сайтов отклоняются
  if (!allowedOrigin(req)) return bad(req, 'forbidden', 403)
  const body = method === 'POST' ? await req.json().catch(() => ({})) : {}
  const ip = clientIp(req)
  const ipKey = 'ip:' + (await netHash(ip))

  /* ----- вход ----- */
  if (path === '/admin/auth/login' && method === 'POST') {
    const login = String(body.login ?? '').trim().toLowerCase().slice(0, 32)
    const password = String(body.password ?? '').slice(0, 128)
    if (await limited(ipKey, 10, 15 * 60_000)) return bad(req, 'Слишком много попыток. Подождите 15 минут.', 429)
    await hit(ipKey)
    const { data: a } = await C.db.from('admin_users').select('*').eq('login', login).maybeSingle()
    const okPass = await checkPassword(password, a?.pass_hash ?? null)
    if (!a || !a.active || !okPass) {
      if (a) {
        const failed = a.failed + 1
        await C.db.from('admin_users').update({ failed, ...(failed >= LOCK_AFTER ? { locked_until: new Date(Date.now() + LOCK_FOR).toISOString(), failed: 0 } : {}) }).eq('id', a.id)
        await audit(a.id, 'login.bad_password', null, { failed }, req)
        if (failed >= LOCK_AFTER)
          await C.send(a.tg_id, `⚠️ ${LOCK_AFTER} неверных паролей подряд при входе в панель NEX (IP ${maskIp(ip)}). Вход заблокирован на 15 минут. Если это были не вы, смените пароль: /panel reset`)
      }
      return bad(req, 'Неверный логин или пароль', 401)
    }
    if (a.locked_until && new Date(a.locked_until).getTime() > Date.now()) return bad(req, 'Вход временно заблокирован. Попробуйте через 15 минут.', 423)
    const loginKey = 'login:' + a.id
    if (await limited(loginKey, 5, 10 * 60_000)) return bad(req, 'Код уже отправлялся несколько раз. Подождите 10 минут.', 429)
    await hit(loginKey)
    await C.db.from('admin_challenges').delete().eq('admin_id', a.id)
    const id = rand(16)
    const code = String((crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000)
    await C.db.from('admin_challenges').insert({
      id,
      admin_id: a.id,
      code_hash: await codeHash(id, code),
      ip_hash: await netHash(ip),
      ua_hash: await netHash(req.headers.get('user-agent') ?? ''),
      expires_at: new Date(Date.now() + CODE_TTL).toISOString(),
    })
    const r = await C.send(
      a.tg_id,
      `🔐 Код входа в панель NEX: <code>${code}</code>\n\nЛогин: ${C.esc(a.login)}\nУстройство: ${C.esc(shortUa(req.headers.get('user-agent') ?? ''))}\nIP: ${maskIp(ip)}\n\nДействует 5 минут. Если входите не вы, нажмите кнопку ниже.`,
      { protect_content: true, reply_markup: { inline_keyboard: [[{ text: '🛑 Это не я', callback_data: `admno:${id}` }]] } },
    )
    if (!r?.ok) return bad(req, 'Не удалось отправить код. Откройте бота и нажмите «Запустить», затем попробуйте снова.', 502)
    return out(req, { challenge: id })
  }

  if (path === '/admin/auth/verify' && method === 'POST') {
    const id = String(body.challenge ?? '')
    const code = String(body.code ?? '').replace(/\D/g, '')
    if (!/^[0-9a-f]{32}$/.test(id)) return bad(req, 'Начните вход заново', 410)
    const { data: ch } = await C.db.from('admin_challenges').select('*').eq('id', id).maybeSingle()
    if (!ch || new Date(ch.expires_at).getTime() < Date.now()) return bad(req, 'Код устарел. Войдите заново.', 410)
    if (ch.ua_hash !== (await netHash(req.headers.get('user-agent') ?? ''))) return bad(req, 'Начните вход заново', 410)
    if (ch.attempts >= 5) {
      await C.db.from('admin_challenges').delete().eq('id', id)
      return bad(req, 'Слишком много неверных кодов. Войдите заново.', 429)
    }
    // Попытка засчитывается до сравнения: параллельный перебор невозможен
    const { data: upd } = await C.db.from('admin_challenges').update({ attempts: ch.attempts + 1 }).eq('id', id).eq('attempts', ch.attempts).select('id').maybeSingle()
    if (!upd) return bad(req, 'Попробуйте ещё раз', 409)
    if (!safeEq(await codeHash(id, code), ch.code_hash)) {
      await audit(ch.admin_id, 'login.bad_code', null, null, req)
      return bad(req, `Неверный код. Осталось попыток: ${4 - ch.attempts}`, 400)
    }
    await C.db.from('admin_challenges').delete().eq('id', id)
    const { data: a } = await C.db.from('admin_users').select('*').eq('id', ch.admin_id).single()
    if (!a.active) return bad(req, 'Доступ отключён', 403)
    await C.db.from('admin_users').update({ failed: 0, locked_until: null, last_login_at: new Date().toISOString() }).eq('id', a.id)
    const token = await createSession(req, a.id)
    await audit(a.id, 'login', null, { ua: shortUa(req.headers.get('user-agent') ?? '') }, req)
    await C.send(a.tg_id, `✅ Выполнен вход в панель NEX (${C.esc(shortUa(req.headers.get('user-agent') ?? ''))}, IP ${maskIp(ip)}).`)
    return out(req, { token, admin: publicAdmin(a) })
  }

  /* ----- приглашение и смена пароля ----- */
  if (path === '/admin/auth/invite' && method === 'GET') {
    const token = new URL(req.url).searchParams.get('token') ?? ''
    if (await limited(ipKey, 30, 15 * 60_000)) return bad(req, 'Слишком много попыток', 429)
    await hit(ipKey)
    const { data: inv } = await C.db.from('admin_invites').select('*, admin_users!admin_invites_admin_id_fkey(login, name)').eq('token_hash', await sha256(token)).maybeSingle()
    if (!inv || inv.used_at || new Date(inv.expires_at).getTime() < Date.now()) return bad(req, 'Ссылка недействительна или устарела', 410)
    return out(req, { reset: !!inv.admin_id, login: inv.admin_users?.login ?? null, name: inv.admin_users?.name ?? inv.name ?? '', role: inv.role })
  }
  if (path === '/admin/auth/invite' && method === 'POST') {
    if (await limited(ipKey, 30, 15 * 60_000)) return bad(req, 'Слишком много попыток', 429)
    await hit(ipKey)
    const hash = await sha256(String(body.token ?? ''))
    const { data: inv } = await C.db.from('admin_invites').select('*').eq('token_hash', hash).maybeSingle()
    if (!inv || inv.used_at || new Date(inv.expires_at).getTime() < Date.now()) return bad(req, 'Ссылка недействительна или устарела', 410)
    const password = String(body.password ?? '')
    let adminId: number
    if (inv.admin_id) {
      const { data: a } = await C.db.from('admin_users').select('login').eq('id', inv.admin_id).maybeSingle()
      if (!a) return bad(req, 'Ссылка недействительна', 410)
      const p = passwordProblem(password, a.login)
      if (p) return bad(req, p)
      // Ссылка одноразовая: помечаем использованной атомарно
      const { data: used } = await C.db.from('admin_invites').update({ used_at: new Date().toISOString() }).eq('token_hash', hash).is('used_at', null).select('token_hash').maybeSingle()
      if (!used) return bad(req, 'Ссылка уже использована', 410)
      await C.db.from('admin_users').update({ pass_hash: await hashPassword(password), failed: 0, locked_until: null }).eq('id', inv.admin_id)
      await C.db.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('admin_id', inv.admin_id).is('revoked_at', null)
      adminId = inv.admin_id
      await audit(adminId, 'password.reset', null, null, req)
    } else {
      const login = String(body.login ?? '').trim().toLowerCase()
      if (!/^[a-z0-9._-]{3,32}$/.test(login)) return bad(req, 'Логин: от 3 до 32 символов, латиница, цифры, точка, дефис или подчёркивание')
      const p = passwordProblem(password, login)
      if (p) return bad(req, p)
      const { data: exists } = await C.db.from('admin_users').select('id').or(`login.eq.${login},tg_id.eq.${Number(inv.tg_id)}`).limit(1)
      if (exists?.length) return bad(req, 'Такой логин или Telegram уже используется')
      const { data: used } = await C.db.from('admin_invites').update({ used_at: new Date().toISOString() }).eq('token_hash', hash).is('used_at', null).select('token_hash').maybeSingle()
      if (!used) return bad(req, 'Ссылка уже использована', 410)
      const name = String(body.name ?? inv.name ?? '').trim().slice(0, 60)
      const { data: a, error } = await C.db
        .from('admin_users')
        .insert({ login, name, pass_hash: await hashPassword(password), role: inv.role, tg_id: inv.tg_id, created_by: inv.created_by })
        .select()
        .single()
      if (error || !a) return bad(req, 'Не удалось создать учётную запись', 500)
      adminId = a.id
      await audit(adminId, 'account.created', login, { role: inv.role }, req)
      await C.send(inv.tg_id, `✅ Учётная запись панели NEX создана. Логин: <code>${C.esc(login)}</code>. Коды для входа будут приходить сюда.`)
    }
    return out(req, { ok: true })
  }

  /* ----- всё ниже только с действующей сессией ----- */
  const s = await readSession(req)
  if ('error' in s) return bad(req, s.error, s.status)
  const me = s.admin
  const need = (p: string) => (can(me.role, p) ? null : bad(req, 'Недостаточно прав', 403))
  const pii = can(me.role, 'users.pii')
  const url = new URL(req.url)
  const q = url.searchParams

  if (path === '/admin/me' && method === 'GET') return out(req, publicAdmin(me))
  if (path === '/admin/auth/logout' && method === 'POST') {
    await C.db.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', s.sid)
    await audit(me.id, 'logout', null, null, req)
    return out(req, { ok: true })
  }

  /* ----- обзор и финансы ----- */
  if (path === '/admin/stats' && method === 'GET') {
    const denied = need('stats')
    if (denied) return denied
    const r = RANGES[q.get('range') ?? 'month'] ?? RANGES.month
    const since = new Date(Date.now() - r.days * 86400_000)
    const prev = new Date(since.getTime() - r.days * 86400_000)
    const [{ data: cur }, { data: before }] = await Promise.all([
      C.db.rpc('admin_stats', { since: since.toISOString(), bucket: r.bucket }),
      C.db.rpc('admin_stats', { since: prev.toISOString(), bucket: r.bucket }),
    ])
    // предыдущий период = (prev..since): вычитаем текущий из суммы за двойной срок
    const keys = ['users_new', 'orders', 'orders_done', 'volume', 'fee', 'bonus_spent']
    const previous: Record<string, number> = {}
    for (const k of keys) previous[k] = Number(before?.[k] ?? 0) - Number(cur?.[k] ?? 0)
    const finance = can(me.role, 'finance')
    if (!finance) for (const k of ['fee', 'bonus_spent', 'bonus_balance', 'ref_paid']) delete cur[k]
    return out(req, { ...cur, previous, range: q.get('range') ?? 'month', bucket: r.bucket, since })
  }

  /* ----- лента событий для автообновления и уведомлений ----- */
  if (path === '/admin/events' && method === 'GET') {
    const sinceRaw = q.get('since')
    const since = sinceRaw && !isNaN(Date.parse(sinceRaw)) ? new Date(Math.max(Date.parse(sinceRaw), Date.now() - 86400_000)).toISOString() : new Date(Date.now() - 86400_000).toISOString()
    const now = new Date().toISOString()
    const items: any[] = []
    const [{ data: orders }, { data: kyc }, { data: users }, { count: ordersNew }, { count: kycPending }] = await Promise.all([
      can(me.role, 'orders.read') ? C.db.from('orders').select('id, status, from_cur, to_cur, amount_from, amount_kzt, created_at, accepted_at, completed_at, rejected_at, user_id, users(first_name, username)').or(`created_at.gt.${since},accepted_at.gt.${since},completed_at.gt.${since},rejected_at.gt.${since}`).order('created_at', { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
      can(me.role, 'kyc.read') ? C.db.from('users').select('id, first_name, username, kyc_submitted_at').eq('kyc_status', 'pending').gt('kyc_submitted_at', since).limit(50) : Promise.resolve({ data: [] }),
      C.db.from('users').select('id, first_name, username, created_at').gt('created_at', since).order('created_at', { ascending: false }).limit(50),
      C.db.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'new'),
      can(me.role, 'kyc.read') ? C.db.from('users').select('*', { count: 'exact', head: true }).eq('kyc_status', 'pending') : Promise.resolve({ count: 0 }),
    ])
    for (const o of (orders ?? []) as any[]) {
      const who = o.users?.username ? '@' + o.users.username : o.users?.first_name ?? ''
      const stamp = (t: string | null) => t && t > since
      if (stamp(o.created_at)) items.push({ type: 'order.new', id: o.id, at: o.created_at, who, amount: Number(o.amount_from), cur: o.from_cur, to: o.to_cur, kzt: Number(o.amount_kzt ?? 0) })
      if (stamp(o.completed_at)) items.push({ type: 'order.completed', id: o.id, at: o.completed_at, who, kzt: Number(o.amount_kzt ?? 0) })
    }
    for (const u of (kyc ?? []) as any[]) items.push({ type: 'kyc.new', id: u.id, at: u.kyc_submitted_at, who: u.username ? '@' + u.username : u.first_name })
    for (const u of (users ?? []) as any[]) items.push({ type: 'user.new', id: u.id, at: u.created_at, who: u.username ? '@' + u.username : u.first_name })
    items.sort((a, b) => (a.at < b.at ? 1 : -1))
    return out(req, { now, items: items.slice(0, 60), counts: { orders_new: ordersNew ?? 0, kyc_pending: kycPending ?? 0 } })
  }

  /* ----- заявки ----- */
  if (path === '/admin/orders' && method === 'GET') {
    const denied = need('orders.read')
    if (denied) return denied
    const csv = q.get('format') === 'csv'
    if (csv) {
      const d2 = need('orders.export')
      if (d2) return d2
    }
    const page = Math.max(0, Number(q.get('page') ?? 0) | 0)
    const size = csv ? 5000 : Math.min(100, Math.max(10, Number(q.get('size') ?? 50) | 0))
    let qb = C.db.from('orders').select('*, users(id, first_name, last_name, username, phone, kyc_status)', { count: 'exact' })
    const st = q.get('status')
    if (st && st !== 'all') qb = st === 'open' ? qb.in('status', ['new', 'accepted']) : qb.eq('status', st)
    const uid = Number(q.get('user') ?? 0)
    if (uid) qb = qb.eq('user_id', uid)
    const term = (q.get('q') ?? '').trim()
    if (/^\d{1,9}$/.test(term)) qb = qb.or(`id.eq.${term},user_id.eq.${term}`)
    const from = q.get('from')
    if (from && !isNaN(Date.parse(from))) qb = qb.gte('created_at', new Date(from).toISOString())
    const { data, count } = await qb.order('created_at', { ascending: false }).range(page * size, page * size + size - 1)
    const rows = (data ?? []).map((o) => orderRow(o, pii))
    if (csv) {
      await audit(me.id, 'orders.export', null, { rows: rows.length }, req)
      const cell = (v: unknown) => {
        let t = v == null ? '' : String(v)
        if (/^[=+\-@\t\r]/.test(t)) t = "'" + t // защита от формул в Excel
        return `"${t.replace(/"/g, '""')}"`
      }
      const head = ['id', 'created_at', 'status', 'user_id', 'username', 'from', 'to', 'amount_from', 'amount_to', 'amount_kzt', 'fee_pct', 'fee_amount', 'bonus_used_kzt', 'method']
      const lines = [head.join(';'), ...rows.map((r: any) => [r.id, r.created_at, r.status, r.user_id, r.user?.username, r.from_cur, r.to_cur, r.amount_from, r.amount_to, r.amount_kzt, r.fee_pct, r.fee_amount, r.bonus_used_kzt, r.method].map(cell).join(';'))]
      return new Response('﻿' + lines.join('\n'), { headers: { ...headers(req), 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="nex-orders.csv"' } })
    }
    return out(req, { rows, total: count ?? 0, page, size })
  }
  const oAct = path.match(/^\/admin\/orders\/(\d+)\/(accept|complete|reject)$/)
  if (oAct && method === 'POST') {
    const denied = need('orders.act')
    if (denied) return denied
    const action = ({ accept: 'acc', complete: 'done', reject: 'rej' } as const)[oAct[2] as 'accept' | 'complete' | 'reject']
    const r = await C.orderTransition(Number(oAct[1]), action, me.id)
    if ('error' in r) return bad(req, r.error, 409)
    const note = String(body.note ?? '').trim().slice(0, 500)
    if (note) await C.db.from('orders').update({ admin_note: note }).eq('id', r.upd.id)
    await audit(me.id, 'order.' + oAct[2], String(oAct[1]), note ? { note } : null, req)
    return out(req, orderRow({ ...r.upd, admin_note: note || r.upd.admin_note, users: r.o.users }, pii))
  }
  const oOne = path.match(/^\/admin\/orders\/(\d+)$/)
  if (oOne && method === 'GET') {
    const denied = need('orders.read')
    if (denied) return denied
    const { data: o } = await C.db.from('orders').select('*, users(*)').eq('id', Number(oOne[1])).maybeSingle()
    if (!o) return bad(req, 'Заявка не найдена', 404)
    const { data: handler } = o.handled_by ? await C.db.from('admin_users').select('login, name').eq('id', o.handled_by).maybeSingle() : { data: null }
    const row: any = orderRow(o, pii)
    if (pii) {
      const prof = await C.readProfile(o.users)
      row.user.full_name = prof.full_name ?? null
    }
    row.handled_by_name = handler ? handler.name || handler.login : null
    return out(req, row)
  }

  /* ----- пользователи ----- */
  if (path === '/admin/users' && method === 'GET') {
    const denied = need('users.read')
    if (denied) return denied
    const page = Math.max(0, Number(q.get('page') ?? 0) | 0)
    const size = Math.min(100, Math.max(10, Number(q.get('size') ?? 50) | 0))
    let qb = C.db.from('users').select('*', { count: 'exact' })
    const f = q.get('filter')
    if (f === 'verified') qb = qb.eq('kyc_status', 'verified')
    else if (f === 'pending') qb = qb.eq('kyc_status', 'pending')
    else if (f === 'profile') qb = qb.eq('profile_done', true)
    else if (f === 'noprofile') qb = qb.eq('profile_done', false)
    else if (f === 'blocked') qb = qb.eq('blocked', true)
    else if (f === 'vip') qb = qb.gte('volume_kzt', 1_000_000)
    const term = (q.get('q') ?? '').trim().replace(/[%,()*]/g, '').slice(0, 40)
    if (term) {
      const digits = term.replace(/\D/g, '')
      const parts = [`username.ilike.%${term.replace(/^@/, '')}%`, `first_name.ilike.%${term}%`, `last_name.ilike.%${term}%`]
      if (/^\d{4,15}$/.test(digits) && digits === term.replace(/[\s+()-]/g, '')) {
        parts.push(`id.eq.${digits}`)
        if (pii) parts.push(`phone.ilike.%${digits}%`)
      }
      if (/^[A-Z0-9]{4,10}$/i.test(term)) parts.push(`ref_code.eq.${term.toUpperCase()}`)
      qb = qb.or(parts.join(','))
    }
    const sort = q.get('sort') === 'volume' ? 'volume_kzt' : q.get('sort') === 'seen' ? 'last_seen_at' : 'created_at'
    const { data, count } = await qb.order(sort, { ascending: false }).range(page * size, page * size + size - 1)
    const rows = await Promise.all((data ?? []).map((u) => userRow(u, false)))
    if (pii) for (let i = 0; i < rows.length; i++) rows[i].phone = (data as any[])[i].phone
    return out(req, { rows, total: count ?? 0, page, size })
  }
  const uOne = path.match(/^\/admin\/users\/(\d+)$/)
  if (uOne && method === 'GET') {
    const denied = need('users.read')
    if (denied) return denied
    const id = Number(uOne[1])
    const { data: u } = await C.db.from('users').select('*').eq('id', id).maybeSingle()
    if (!u) return bad(req, 'Пользователь не найден', 404)
    const [{ data: orders }, { count: refs }, loy] = await Promise.all([
      C.db.from('orders').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
      C.db.from('users').select('*', { count: 'exact', head: true }).eq('referred_by', id),
      C.loyalty(u),
    ])
    if (pii) await audit(me.id, 'user.view', String(id), null, req)
    return out(req, { ...(await userRow(u, pii)), loyalty: { tier: loy.tier, tier_name: loy.tier_name, tier_off: loy.tier_off }, referrals: refs ?? 0, orders: (orders ?? []).map((o) => C.numify(o)) })
  }
  const uBlock = path.match(/^\/admin\/users\/(\d+)\/(block|unblock)$/)
  if (uBlock && method === 'POST') {
    const denied = need('users.block')
    if (denied) return denied
    const blocked = uBlock[2] === 'block'
    await C.db.from('users').update({ blocked }).eq('id', Number(uBlock[1]))
    await audit(me.id, 'user.' + uBlock[2], uBlock[1], body.reason ? { reason: String(body.reason).slice(0, 200) } : null, req)
    return out(req, { ok: true, blocked })
  }
  const uBonus = path.match(/^\/admin\/users\/(\d+)\/bonus$/)
  if (uBonus && method === 'POST') {
    const denied = need('users.bonus')
    if (denied) return denied
    const delta = Math.trunc(Number(body.delta))
    const reason = String(body.reason ?? '').trim().slice(0, 200)
    if (!delta || Math.abs(delta) > 1_000_000) return bad(req, 'Укажите сумму бонусов до 1 000 000 ₸')
    if (!reason) return bad(req, 'Укажите причину')
    const { error } = await C.db.rpc('user_credit', { uid: Number(uBonus[1]), bonus: delta, volume: 0 })
    if (error) return bad(req, 'Списать больше, чем есть на счёте, нельзя')
    await audit(me.id, 'user.bonus', uBonus[1], { delta, reason }, req)
    if (delta > 0) await C.send(Number(uBonus[1]), `🎁 Вам начислено ${C.nf(delta, 0)} ₸ бонусов. Ими можно оплатить часть комиссии при обмене.`)
    return out(req, { ok: true })
  }
  const uReset = path.match(/^\/admin\/users\/(\d+)\/kyc-reset$/)
  if (uReset && method === 'POST') {
    const denied = need('kyc.reset')
    if (denied) return denied
    const files = await C.kycReset(Number(uReset[1]))
    await audit(me.id, 'kyc.reset', uReset[1], { files }, req)
    return out(req, { ok: true, files })
  }

  /* ----- верификация ----- */
  if (path === '/admin/kyc' && method === 'GET') {
    const denied = need('kyc.read')
    if (denied) return denied
    const st = q.get('status') ?? 'pending'
    const { data } = await C.db
      .from('users')
      .select('*')
      .eq('kyc_status', ['pending', 'verified', 'rejected'].includes(st) ? st : 'pending')
      .order(st === 'pending' ? 'kyc_submitted_at' : 'kyc_reviewed_at', { ascending: st === 'pending', nullsFirst: false })
      .limit(100)
    const rows = []
    for (const u of data ?? []) {
      let k: any = {}
      try {
        k = await decryptKyc(u)
      } catch {
        /* повреждённая анкета */
      }
      const checks = Array.isArray(k.checks) ? k.checks : []
      rows.push({
        ...(await userRow(u, false)),
        doc_type: k.doc_type ?? null,
        auto_passed: !!k.auto_passed,
        checks_total: checks.length,
        checks_failed: checks.filter((c: any) => c.ok !== true).length,
        face_score: k.face_match?.score ?? null,
      })
    }
    return out(req, { rows })
  }
  const kOne = path.match(/^\/admin\/kyc\/(\d+)$/)
  if (kOne && method === 'GET') {
    const denied = need('kyc.read')
    if (denied) return denied
    const { data: u } = await C.db.from('users').select('*').eq('id', Number(kOne[1])).maybeSingle()
    if (!u) return bad(req, 'Пользователь не найден', 404)
    let k: any = {}
    try {
      k = await decryptKyc(u)
    } catch {
      return bad(req, 'Анкету не удалось расшифровать', 500)
    }
    const files = Array.isArray(k.files) ? Object.fromEntries(k.files.map((p: string, i: number) => [i ? 'face' : 'doc_front', p])) : k.files ?? {}
    await audit(me.id, 'kyc.view', kOne[1], null, req)
    return out(req, {
      user: await userRow(u, true),
      data: {
        full_name: k.full_name,
        latin_name: k.latin_name,
        birth_date: k.birth_date,
        citizenship: k.citizenship,
        doc_type: k.doc_type,
        doc_number: k.doc_number,
        issue_date: k.issue_date,
        expiry_date: k.expiry_date,
        issued_by: k.issued_by,
        birth_place: k.birth_place,
        personal_number: k.personal_number,
        phone: k.phone,
        address: k.address,
        mrz_lines: k.mrz_lines ?? null,
      },
      checks: Array.isArray(k.checks) ? k.checks : [],
      auto_passed: !!k.auto_passed,
      liveness: k.liveness ?? null,
      face_match: k.face_match ?? null,
      files: Object.keys(files),
    })
  }
  const kFile = path.match(/^\/admin\/kyc\/(\d+)\/file\/(doc_front|doc_back|selfie|face|doc_face)$/)
  if (kFile && method === 'GET') {
    const denied = need('kyc.read')
    if (denied) return denied
    if (await limited('file:' + me.id, 200, 60 * 60_000)) return bad(req, 'Слишком много запросов', 429)
    await hit('file:' + me.id)
    const { data: u } = await C.db.from('users').select('kyc, kyc_enc').eq('id', Number(kFile[1])).maybeSingle()
    if (!u) return bad(req, 'Не найдено', 404)
    const k = await decryptKyc(u)
    const files: Record<string, string> = Array.isArray(k.files) ? Object.fromEntries(k.files.map((p: string, i: number) => [i ? 'face' : 'doc_front', p])) : k.files ?? {}
    const p = files[kFile[2]]
    if (!p) return bad(req, 'Файла нет', 404)
    const { data } = await C.db.storage.from('kyc').download(p)
    if (!data) return bad(req, 'Файл не найден', 404)
    let bytes: Uint8Array = new Uint8Array(await data.arrayBuffer())
    if (p.endsWith('.bin')) bytes = await C.decryptBytes(bytes)
    await audit(me.id, 'kyc.file', kFile[1], { file: kFile[2] }, req)
    return new Response(bytes as BodyInit, { headers: { ...headers(req), 'Content-Type': 'image/jpeg', 'Content-Disposition': 'inline' } })
  }
  const kDec = path.match(/^\/admin\/kyc\/(\d+)\/(approve|reject)$/)
  if (kDec && method === 'POST') {
    const denied = need('kyc.act')
    if (denied) return denied
    const verified = kDec[2] === 'approve'
    const note = String(body.note ?? '').trim().slice(0, 300)
    if (!verified && !note) return bad(req, 'Укажите причину отказа: её увидит клиент')
    const u = await C.kycDecide(Number(kDec[1]), verified, note || null, me.id)
    if (!u) return bad(req, 'Анкета уже рассмотрена', 409)
    await audit(me.id, 'kyc.' + kDec[2], kDec[1], note ? { note } : null, req)
    return out(req, { ok: true, kyc_status: u.kyc_status })
  }

  /* ----- журнал ----- */
  if (path === '/admin/audit' && method === 'GET') {
    const denied = need('audit.read')
    if (denied) return denied
    const page = Math.max(0, Number(q.get('page') ?? 0) | 0)
    const { data, count } = await C.db
      .from('admin_audit')
      .select('id, action, target, meta, created_at, admin_users(login, name, role)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * 50, page * 50 + 49)
    return out(req, { rows: data ?? [], total: count ?? 0, page })
  }

  /* ----- команда ----- */
  if (path === '/admin/team' && method === 'GET') {
    const denied = need('team.read')
    if (denied) return denied
    const [{ data: admins }, { data: sessions }] = await Promise.all([
      C.db.from('admin_users').select('id, login, name, role, tg_id, active, locked_until, created_at, last_login_at').order('created_at'),
      C.db.from('admin_sessions').select('id, admin_id, ua, created_at, last_seen_at, expires_at').is('revoked_at', null).gt('expires_at', new Date().toISOString()).gt('last_seen_at', new Date(Date.now() - SESSION_IDLE).toISOString()),
    ])
    const manage = can(me.role, 'team.manage')
    return out(req, {
      admins: (admins ?? []).map((a) => ({ ...a, tg_id: manage ? a.tg_id : null, sessions: (sessions ?? []).filter((x) => x.admin_id === a.id).length })),
      sessions: (sessions ?? []).filter((x) => manage || x.admin_id === me.id).map((x) => ({ ...x, id: x.id.slice(0, 12), current: x.id === s.sid })),
    })
  }
  if (path === '/admin/team/invite' && method === 'POST') {
    const denied = need('team.manage')
    if (denied) return denied
    const role = String(body.role) as Role
    const tgId = Number(body.tg_id)
    if (!ROLES.includes(role)) return bad(req, 'Выберите роль')
    if (!Number.isInteger(tgId) || tgId <= 0) return bad(req, 'Укажите Telegram ID сотрудника (число)')
    const { data: ex } = await C.db.from('admin_users').select('id').eq('tg_id', tgId).maybeSingle()
    if (ex) return bad(req, 'Этот Telegram уже привязан к сотруднику')
    const link = await makeInvite({ role, tg_id: tgId, name: String(body.name ?? '').trim().slice(0, 60), created_by: me.id })
    await audit(me.id, 'team.invite', String(tgId), { role }, req)
    return out(req, { link, expires_in_min: INVITE_TTL / 60_000 })
  }
  const tOne = path.match(/^\/admin\/team\/(\d+)\/(role|disable|enable|reset|revoke)$/)
  if (tOne && method === 'POST') {
    const denied = need('team.manage')
    if (denied) return denied
    const id = Number(tOne[1])
    const act = tOne[2]
    const { data: target } = await C.db.from('admin_users').select('*').eq('id', id).maybeSingle()
    if (!target) return bad(req, 'Сотрудник не найден', 404)
    const { count: owners } = await C.db.from('admin_users').select('*', { count: 'exact', head: true }).eq('role', 'owner').eq('active', true)
    const lastOwner = target.role === 'owner' && target.active && (owners ?? 0) <= 1
    if (act === 'role') {
      const role = String(body.role) as Role
      if (!ROLES.includes(role)) return bad(req, 'Выберите роль')
      if (lastOwner && role !== 'owner') return bad(req, 'Нельзя понизить единственного владельца')
      await C.db.from('admin_users').update({ role }).eq('id', id)
      await C.db.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('admin_id', id).is('revoked_at', null)
      await audit(me.id, 'team.role', target.login, { from: target.role, to: role }, req)
      return out(req, { ok: true })
    }
    if (act === 'disable' || act === 'enable') {
      if (act === 'disable' && (lastOwner || id === me.id)) return bad(req, id === me.id ? 'Нельзя отключить себя' : 'Нельзя отключить единственного владельца')
      await C.db.from('admin_users').update({ active: act === 'enable' }).eq('id', id)
      if (act === 'disable') await C.db.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('admin_id', id).is('revoked_at', null)
      await audit(me.id, 'team.' + act, target.login, null, req)
      return out(req, { ok: true })
    }
    if (act === 'reset') {
      const link = await makeInvite({ admin_id: id, created_by: me.id })
      await audit(me.id, 'team.reset', target.login, null, req)
      return out(req, { link, expires_in_min: INVITE_TTL / 60_000 })
    }
    if (act === 'revoke') {
      await C.db.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('admin_id', id).is('revoked_at', null)
      await audit(me.id, 'team.revoke', target.login, null, req)
      return out(req, { ok: true })
    }
  }
  if (path === '/admin/sessions/revoke-others' && method === 'POST') {
    await C.db.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('admin_id', me.id).neq('id', s.sid).is('revoked_at', null)
    await audit(me.id, 'sessions.revoke_others', null, null, req)
    return out(req, { ok: true })
  }

  return bad(req, 'Не найдено', 404)
}

/** Чистка устаревших записей (вызывается из cron) */
export async function adminCleanup() {
  const day = new Date(Date.now() - 86400_000).toISOString()
  await C.db.from('admin_attempts').delete().lt('created_at', day)
  await C.db.from('admin_challenges').delete().lt('expires_at', new Date().toISOString())
  await C.db.from('admin_invites').delete().lt('expires_at', day)
  await C.db.from('admin_sessions').delete().lt('expires_at', new Date(Date.now() - 30 * 86400_000).toISOString())
}
