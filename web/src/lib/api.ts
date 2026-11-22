import { CONFIG, DEMO } from '../config'
import type { CurrencyCode } from './currencies'
import { crossRate, fetchMarketDirect, FALLBACK, type Market } from './market'
import { inTelegram, TG } from './tg'
import { pricing, type Discount } from './pricing'

export type OrderStatus = 'new' | 'accepted' | 'completed' | 'rejected' | 'cancelled'
export type KycStatus = 'none' | 'pending' | 'verified' | 'rejected'

export interface User {
  id: number
  first_name: string
  last_name?: string | null
  username?: string | null
  photo_url?: string | null
  phone?: string | null
  phone_verified?: boolean
  kyc_status: KycStatus
  kyc_note?: string | null
  created_at?: string
  profile_done?: boolean
  full_name?: string | null
  birth_date?: string | null
  loyalty?: Loyalty
}

export interface Loyalty {
  tier: string
  tier_name: string
  tier_off: number
  next_tier: { id: string; name: string; min: number; off: number } | null
  volume_kzt: number
  bonus_kzt: number
  ref_code: string
  ref_link: string
  referrals: number
  ref_earned_kzt: number
  welcome: boolean
  completed: number
}
export interface ProfileForm {
  full_name: string
  birth_date: string
  phone: string
}

export interface Order {
  id: number
  from_cur: CurrencyCode
  to_cur: CurrencyCode
  amount_from: number
  amount_to: number
  rate: number
  fee_pct: number
  fee_base_pct?: number | null
  discounts?: Discount[] | null
  fee_amount: number
  bonus_used?: number
  bonus_used_kzt?: number
  method: string
  details?: string | null
  note?: string | null
  status: OrderStatus
  admin_note?: string | null
  created_at: string
  accepted_at?: string | null
  completed_at?: string | null
}

export interface RateAlert {
  id: number
  base: CurrencyCode
  quote: CurrencyCode
  target: number
  direction: 'above' | 'below'
  active: boolean
  created_at: string
}

export interface NewOrder {
  from: CurrencyCode
  to: CurrencyCode
  amount: number
  method: string
  details?: string
  note?: string
  use_bonus?: boolean
}

export type DocType = 'id_card' | 'passport' | 'residence'
export interface KycForm {
  doc_type: DocType
  doc_number?: string
  /** ИИН или личный номер из документа */
  personal_number?: string
  issue_date?: string
  expiry_date?: string
  issued_by?: string
  citizenship?: string
  birth_place?: string
  address?: string
  /** dataURL jpeg: doc_front, doc_back (кроме паспорта), selfie (селфи с документом) */
  files: { doc_front?: string; doc_back?: string; selfie?: string }
}

const TOKEN_KEY = 'nex.token'
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v == null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      /* приватный режим */
    }
  },
}

export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(msg: string, status = 0, data: Record<string, unknown> = {}) {
    super(msg)
    this.status = status
    this.data = data
  }
}
export const ORDER_COOLDOWN_SEC = 300

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = store.get(TOKEN_KEY)
  const r = await fetch(CONFIG.apiUrl.replace(/\/$/, '') + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Nex-Token': token } : {}),
      ...(init.headers || {}),
    },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    if (r.status === 401) store.set(TOKEN_KEY, null)
    throw new ApiError(j.error || 'Ошибка сети. Попробуйте ещё раз.', r.status, j)
  }
  return j as T
}

/* ---------------- Демо-режим: данные хранятся в браузере ---------------- */
const demo = {
  load<T>(k: string, d: T): T {
    try {
      return JSON.parse(store.get('nex.demo.' + k) || 'null') ?? d
    } catch {
      return d
    }
  },
  save(k: string, v: unknown) {
    store.set('nex.demo.' + k, JSON.stringify(v))
  },
}
const demoUser = (): User => {
  const u = demo.load<User>('user', {
    id: 100000001,
    first_name: TG?.initDataUnsafe?.user?.first_name || 'Максим',
    username: TG?.initDataUnsafe?.user?.username || 'maxim',
    kyc_status: 'none',
    created_at: new Date().toISOString(),
  })
  const done = demo.load<Order[]>('orders', []).filter((o) => o.status === 'completed')
  const vol = done.reduce((s, o) => s + o.amount_from * (o.from_cur === 'KZT' ? 1 : 500), 0)
  u.loyalty = {
    tier: vol >= 1_000_000 ? 'silver' : 'standard',
    tier_name: vol >= 1_000_000 ? 'Silver' : 'Standard',
    tier_off: vol >= 1_000_000 ? 0.25 : 0,
    next_tier: vol >= 1_000_000 ? { id: 'gold', name: 'Gold', min: 5_000_000, off: 0.5 } : { id: 'silver', name: 'Silver', min: 1_000_000, off: 0.25 },
    volume_kzt: vol,
    bonus_kzt: demo.load('bonus', 1200),
    ref_code: 'NEXDEMO',
    ref_link: `https://t.me/${CONFIG.botUsername}?start=ref_NEXDEMO`,
    referrals: 2,
    ref_earned_kzt: 1200,
    welcome: false,
    completed: done.length,
  }
  return u
}
let marketCache: { t: number; m: Market } | null = null

/* ---------------- Публичное API ---------------- */
export const api = {
  hasSession(): boolean {
    if (DEMO) return demo.load('loggedIn', false) || inTelegram
    return !!store.get(TOKEN_KEY)
  },

  async authTelegram(): Promise<void> {
    if (DEMO) return demo.save('loggedIn', true)
    const r = await call<{ token: string }>('/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData: TG.initData }),
    })
    store.set(TOKEN_KEY, r.token)
  },

  /** Вход в PWA через бота: получаем код, пользователь подтверждает его в Telegram */
  async loginStart(): Promise<{ code: string; pin: string; url: string }> {
    if (DEMO) return { code: 'demo', pin: '0000', url: `https://t.me/${CONFIG.botUsername}` }
    return call('/auth/link/start', { method: 'POST' })
  },
  async loginPoll(code: string): Promise<boolean> {
    if (DEMO) {
      demo.save('loggedIn', true)
      return true
    }
    const r = await call<{ token?: string }>(`/auth/link/poll?code=${encodeURIComponent(code)}`)
    if (r.token) store.set(TOKEN_KEY, r.token)
    return !!r.token
  },
  /** Вход по номеру телефона: код приходит в Telegram от бота */
  async phoneStart(phone: string): Promise<{ sid: string; sent: boolean; url?: string }> {
    if (DEMO) {
      const linked = demo.load('phoneLinked', false)
      return linked ? { sid: 'demo', sent: true } : { sid: 'demo', sent: false, url: `https://t.me/${CONFIG.botUsername}` }
    }
    return call('/auth/phone/start', { method: 'POST', body: JSON.stringify({ phone }) })
  },
  async phoneStatus(sid: string): Promise<boolean> {
    if (DEMO) {
      demo.save('phoneLinked', true)
      return true
    }
    return (await call<{ sent: boolean }>(`/auth/phone/status?sid=${encodeURIComponent(sid)}`)).sent
  },
  async phoneResend(sid: string): Promise<void> {
    if (DEMO) return
    await call('/auth/phone/resend', { method: 'POST', body: JSON.stringify({ sid }) })
  },
  async phoneVerify(sid: string, code: string): Promise<void> {
    if (DEMO) {
      if (code !== '123456') throw new ApiError('Неверный код. В демо-режиме код 123456', 400)
      demo.save('loggedIn', true)
      return
    }
    const r = await call<{ token: string }>('/auth/phone/verify', { method: 'POST', body: JSON.stringify({ sid, code }) })
    store.set(TOKEN_KEY, r.token)
  },

  async saveProfile(f: ProfileForm): Promise<User> {
    if (DEMO) {
      const u = { ...demoUser(), ...f, profile_done: true }
      demo.save('user', u)
      return demoUser()
    }
    return call<User>('/profile', { method: 'POST', body: JSON.stringify(f) })
  },

  /* ----- Face ID / Touch ID (passkey) ----- */
  async passkeyLoginOptions(): Promise<{ cid: string; options: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return call('/auth/passkey/login/options', { method: 'POST' })
  },
  async passkeyLoginVerify(cid: string, response: unknown): Promise<void> {
    const r = await call<{ token: string }>('/auth/passkey/login/verify', { method: 'POST', body: JSON.stringify({ cid, response }) })
    store.set(TOKEN_KEY, r.token)
  },
  async passkeyRegisterOptions(): Promise<{ cid: string; options: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return call('/passkeys/register/options', { method: 'POST' })
  },
  async passkeyRegisterVerify(cid: string, response: unknown, device: string): Promise<void> {
    await call('/passkeys/register/verify', { method: 'POST', body: JSON.stringify({ cid, response, device }) })
  },
  async passkeys(): Promise<{ id: string; device: string | null; created_at: string; last_used_at: string | null }[]> {
    if (DEMO) return demo.load('passkeys', [])
    return call('/passkeys')
  },
  async deletePasskey(id: string): Promise<void> {
    if (DEMO) return demo.save('passkeys', [])
    await call(`/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  /* ----- push-уведомления ----- */
  async pushKey(): Promise<string> {
    return (await call<{ key: string }>('/push/key')).key
  },
  async pushSubscribe(sub: PushSubscriptionJSON): Promise<void> {
    if (DEMO) return
    await call('/push/subscribe', { method: 'POST', body: JSON.stringify(sub) })
  },
  async pushUnsubscribe(endpoint: string): Promise<void> {
    if (DEMO) return
    await call('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) })
  },
  async pushTest(): Promise<number> {
    if (DEMO) return 0
    return (await call<{ sent: number }>('/push/test', { method: 'POST' })).sent
  },

  logout() {
    store.set(TOKEN_KEY, null)
    demo.save('loggedIn', false)
  },

  async me(): Promise<User> {
    if (DEMO) return demoUser()
    return call<User>('/me')
  },

  async market(): Promise<Market> {
    if (marketCache && Date.now() - marketCache.t < 60_000) return marketCache.m
    let m: Market
    try {
      m = DEMO ? await fetchMarketDirect() : await call<Market>('/rates')
    } catch {
      m = marketCache?.m ?? FALLBACK
    }
    marketCache = { t: Date.now(), m }
    return m
  },

  async orders(): Promise<Order[]> {
    if (DEMO) return demo.load<Order[]>('orders', [])
    return call<Order[]>('/orders')
  },

  async createOrder(o: NewOrder): Promise<Order> {
    if (DEMO) {
      const m = await api.market()
      const rate = crossRate(m, o.from, o.to)
      const gross = o.amount * rate
      const u = demoUser()
      if (!u.profile_done) throw new ApiError('Заполните ФИО, телефон и дату рождения', 400, { code: 'profile' })
      const kzt = o.amount * crossRate(m, o.from, 'KZT')
      const price = pricing(u.loyalty!.volume_kzt, kzt, u.loyalty!.welcome)
      const fee = (gross * price.fee) / 100
      const feeKzt = fee * crossRate(m, o.to, 'KZT')
      const bonusKzt = o.use_bonus ? Math.floor(Math.min(u.loyalty!.bonus_kzt, feeKzt * 0.5)) : 0
      const bonusTo = bonusKzt * crossRate(m, 'KZT', o.to)
      const list = demo.load<Order[]>('orders', [])
      const dup = list.find(
        (x) => (x.status === 'new' || x.status === 'accepted') && x.from_cur === o.from && x.to_cur === o.to && Math.abs(x.amount_from - o.amount) <= o.amount * 0.01,
      )
      if (dup) throw new ApiError(`Такая заявка №${dup.id} уже на рассмотрении. Дождитесь ответа оператора.`, 409, { code: 'duplicate', order_id: dup.id })
      const last = list[0] ? (Date.now() - new Date(list[0].created_at).getTime()) / 1000 : Infinity
      if (last < ORDER_COOLDOWN_SEC) {
        const sec = Math.ceil(ORDER_COOLDOWN_SEC - last)
        throw new ApiError(`Новую заявку можно создать через ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, 429, { code: 'cooldown', retry_after: sec })
      }
      const order: Order = {
        id: 1000 + list.length + 1,
        from_cur: o.from,
        to_cur: o.to,
        amount_from: o.amount,
        amount_to: gross - fee + bonusTo,
        rate,
        fee_pct: price.fee,
        fee_base_pct: CONFIG.feePct,
        discounts: price.discounts,
        fee_amount: fee,
        bonus_used: bonusTo,
        bonus_used_kzt: bonusKzt,
        method: o.method,
        details: o.details,
        note: o.note,
        status: 'new',
        created_at: new Date().toISOString(),
      }
      demo.save('orders', [order, ...list])
      if (bonusKzt) demo.save('bonus', u.loyalty!.bonus_kzt - bonusKzt)
      return order
    }
    return call<Order>('/orders', { method: 'POST', body: JSON.stringify(o) })
  },

  async cancelOrder(id: number): Promise<Order> {
    if (DEMO) return demoSetStatus(id, 'cancelled')
    return call<Order>(`/orders/${id}/cancel`, { method: 'POST' })
  },

  /** Только для демо: имитация действий оператора в боте */
  demoAdvance(id: number, status: OrderStatus) {
    return demoSetStatus(id, status)
  },
  demoKyc(status: KycStatus) {
    demo.save('user', { ...demoUser(), kyc_status: status })
  },

  async submitKyc(f: KycForm): Promise<User> {
    if (DEMO) {
      const u = { ...demoUser(), kyc_status: 'pending' as KycStatus }
      demo.save('user', u)
      return u
    }
    return call<User>('/kyc', { method: 'POST', body: JSON.stringify(f) })
  },

  async alerts(): Promise<RateAlert[]> {
    if (DEMO) return demo.load<RateAlert[]>('alerts', [])
    return call<RateAlert[]>('/alerts')
  },
  async createAlert(a: Pick<RateAlert, 'base' | 'quote' | 'target' | 'direction'>): Promise<RateAlert> {
    if (DEMO) {
      const list = demo.load<RateAlert[]>('alerts', [])
      const al: RateAlert = { ...a, id: Date.now(), active: true, created_at: new Date().toISOString() }
      demo.save('alerts', [al, ...list])
      return al
    }
    return call<RateAlert>('/alerts', { method: 'POST', body: JSON.stringify(a) })
  },
  async deleteAlert(id: number): Promise<void> {
    if (DEMO) {
      demo.save(
        'alerts',
        demo.load<RateAlert[]>('alerts', []).filter((a) => a.id !== id),
      )
      return
    }
    await call(`/alerts/${id}`, { method: 'DELETE' })
  },
}

function demoSetStatus(id: number, status: OrderStatus): Order {
  const list = demo.load<Order[]>('orders', [])
  const now = new Date().toISOString()
  const next = list.map((o) =>
    o.id === id
      ? {
          ...o,
          status,
          accepted_at: status === 'accepted' ? now : o.accepted_at,
          completed_at: status === 'completed' ? now : o.completed_at,
        }
      : o,
  )
  demo.save('orders', next)
  return next.find((o) => o.id === id)!
}
