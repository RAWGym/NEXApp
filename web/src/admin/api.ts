// Клиент панели управления. Токен живёт только в sessionStorage этой вкладки:
// закрыли вкладку, и сессия в браузере забыта. Все права проверяет сервер.
import { CONFIG, DEMO } from '../config'

const BASE = CONFIG.apiUrl.replace(/\/$/, '')
const TOKEN_KEY = 'nex.admin.t'

export const session = {
  get: () => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? ''
    } catch {
      return ''
    }
  },
  set: (t: string | null) => {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t)
      else sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      /* приватный режим */
    }
  },
}

export class ApiError extends Error {
  status: number
  constructor(msg: string, status: number) {
    super(msg)
    this.status = status
  }
}

let onUnauthorized: (msg: string) => void = () => {}
export const setUnauthorizedHandler = (fn: (msg: string) => void) => (onUnauthorized = fn)

async function raw(path: string, init: { method?: string; body?: unknown } = {}) {
  if (DEMO) return (await import('./demo')).demoApi(path, init)
  const r = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-admin-token': session.get() },
    body: init.body ? JSON.stringify(init.body) : undefined,
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  })
  if (r.status === 401 && !path.startsWith('/admin/auth/')) {
    const j = await r.json().catch(() => ({}))
    session.set(null)
    onUnauthorized(j.error || 'Сессия завершена')
    throw new ApiError(j.error || 'Сессия завершена', 401)
  }
  return r
}

async function json<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await raw(path, init)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError(j.error || 'Ошибка сервера', r.status)
  return j as T
}
const post = <T,>(path: string, body: unknown = {}) => json<T>(path, { method: 'POST', body })
const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? '?' + s : ''
}

/* ---------------- типы ---------------- */
export type Role = 'owner' | 'admin' | 'operator' | 'viewer'
export interface Me {
  id: number
  login: string
  name: string
  role: Role
  perms: string[]
}
export interface Series {
  t: string
  orders: number
  done: number
  volume: number
  fee: number
  bonus: number
}
export interface Stats {
  users_total: number
  users_new: number
  users_active: number
  users_profile: number
  users_verified: number
  users_blocked: number
  kyc_pending: number
  orders_open: number
  orders_new: number
  orders: number
  orders_done: number
  orders_rejected: number
  orders_cancelled: number
  volume: number
  fee?: number
  bonus_spent?: number
  bonus_balance?: number
  ref_paid?: number
  avg_check: number
  series: Series[]
  users_series: { t: string; n: number }[]
  pairs: { pair: string; n: number; volume: number }[]
  tiers: Record<'standard' | 'silver' | 'gold' | 'black', number>
  previous: Record<string, number>
  range: string
  bucket: string
}
export type OrderStatus = 'new' | 'accepted' | 'completed' | 'rejected' | 'cancelled'
export interface OrderUser {
  id: number
  first_name: string
  last_name?: string | null
  username?: string | null
  phone?: string | null
  kyc_status: string
  full_name?: string | null
}
export interface Order {
  id: number
  user_id: number
  status: OrderStatus
  from_cur: string
  to_cur: string
  amount_from: number
  amount_to: number
  amount_kzt: number | null
  rate: number
  fee_pct: number
  fee_amount: number
  bonus_used_kzt?: number
  method: string
  details?: string | null
  note?: string | null
  admin_note?: string | null
  created_at: string
  accepted_at?: string | null
  completed_at?: string | null
  rejected_at?: string | null
  user: OrderUser | null
  handled_by_name?: string | null
}
export interface UserRow {
  id: number
  first_name: string
  last_name?: string | null
  username?: string | null
  photo_url?: string | null
  phone?: string | null
  phone_verified?: boolean
  full_name?: string | null
  birth_date?: string | null
  profile_done: boolean
  kyc_status: 'none' | 'pending' | 'verified' | 'rejected'
  kyc_note?: string | null
  kyc_submitted_at?: string | null
  blocked: boolean
  created_at: string
  last_seen_at?: string | null
  bonus_kzt: number
  volume_kzt: number
  ref_earned_kzt: number
  ref_code?: string | null
}
export interface UserFull extends UserRow {
  loyalty: { tier: string; tier_name: string; tier_off: number }
  referrals: number
  orders: Omit<Order, 'user'>[]
}
export interface KycRow extends UserRow {
  doc_type: string | null
  auto_passed: boolean
  checks_total: number
  checks_failed: number
}
export interface KycCheck {
  id?: string
  label: string
  ok: boolean | null
  note?: string
}
export interface KycFull {
  user: UserRow
  data: Record<string, string | null | undefined>
  checks: KycCheck[]
  auto_passed: boolean
  files: string[]
}
export interface EventItem {
  type: 'order.new' | 'order.completed' | 'kyc.new' | 'user.new'
  id: number
  at: string
  who: string
  amount?: number
  cur?: string
  to?: string
  kzt?: number
}
export interface Events {
  now: string
  items: EventItem[]
  counts: { orders_new: number; kyc_pending: number }
}
export interface AuditRow {
  id: number
  action: string
  target: string | null
  meta: Record<string, unknown> | null
  created_at: string
  admin_users: { login: string; name: string; role: Role } | null
}
export interface TeamMember {
  id: number
  login: string
  name: string
  role: Role
  tg_id: number | null
  active: boolean
  locked_until: string | null
  created_at: string
  last_login_at: string | null
  sessions: number
}
export interface SessionRow {
  id: string
  admin_id: number
  ua: string
  created_at: string
  last_seen_at: string
  current: boolean
}
export interface Page<T> {
  rows: T[]
  total: number
  page: number
  size?: number
}

/* ---------------- методы ---------------- */
export const api = {
  login: (login: string, password: string) => post<{ challenge: string }>('/admin/auth/login', { login, password }),
  verify: (challenge: string, code: string) => post<{ token: string; admin: Me }>('/admin/auth/verify', { challenge, code }),
  inviteInfo: (token: string) => json<{ reset: boolean; login: string | null; name: string; role: Role | null }>('/admin/auth/invite' + qs({ token })),
  inviteAccept: (token: string, body: { login?: string; name?: string; password: string }) => post<{ ok: true }>('/admin/auth/invite', { token, ...body }),
  logout: () => post('/admin/auth/logout').catch(() => {}),
  me: () => json<Me>('/admin/me'),

  stats: (range: string) => json<Stats>('/admin/stats' + qs({ range })),
  events: (since?: string) => json<Events>('/admin/events' + qs({ since })),

  orders: (p: { status?: string; q?: string; page?: number; user?: number; from?: string }) => json<Page<Order>>('/admin/orders' + qs(p)),
  ordersCsv: async (p: { status?: string; q?: string; from?: string }) => {
    const r = await raw('/admin/orders' + qs({ ...p, format: 'csv' }))
    if (!r.ok) throw new ApiError((await r.json().catch(() => ({}))).error || 'Не удалось выгрузить', r.status)
    return r.blob()
  },
  order: (id: number) => json<Order>('/admin/orders/' + id),
  orderAct: (id: number, act: 'accept' | 'complete' | 'reject', note?: string) => post<Order>(`/admin/orders/${id}/${act}`, { note }),

  users: (p: { filter?: string; q?: string; sort?: string; page?: number }) => json<Page<UserRow>>('/admin/users' + qs(p)),
  user: (id: number) => json<UserFull>('/admin/users/' + id),
  userBlock: (id: number, block: boolean, reason?: string) => post(`/admin/users/${id}/${block ? 'block' : 'unblock'}`, { reason }),
  userBonus: (id: number, delta: number, reason: string) => post(`/admin/users/${id}/bonus`, { delta, reason }),
  kycReset: (id: number) => post<{ ok: true; files: number }>(`/admin/users/${id}/kyc-reset`),

  kyc: (status: string) => json<{ rows: KycRow[] }>('/admin/kyc' + qs({ status })),
  kycOne: (id: number) => json<KycFull>('/admin/kyc/' + id),
  kycFile: async (id: number, file: string) => {
    const r = await raw(`/admin/kyc/${id}/file/${file}`)
    if (!r.ok) throw new ApiError('Файл недоступен', r.status)
    return URL.createObjectURL(await r.blob())
  },
  kycDecide: (id: number, approve: boolean, note?: string) => post(`/admin/kyc/${id}/${approve ? 'approve' : 'reject'}`, { note }),

  audit: (page: number) => json<Page<AuditRow>>('/admin/audit' + qs({ page })),
  team: () => json<{ admins: TeamMember[]; sessions: SessionRow[] }>('/admin/team'),
  teamInvite: (b: { role: Role; tg_id: number; name: string }) => post<{ link: string; expires_in_min: number }>('/admin/team/invite', b),
  teamAct: (id: number, act: 'role' | 'disable' | 'enable' | 'reset' | 'revoke', role?: Role) => post<{ ok?: true; link?: string }>(`/admin/team/${id}/${act}`, { role }),
  revokeOthers: () => post('/admin/sessions/revoke-others'),
}
