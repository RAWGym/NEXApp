import { CONFIG, DEMO } from '../config'
import type { CurrencyCode } from './currencies'
import { crossRate, fetchMarketDirect, FALLBACK, type Market } from './market'
import { inTelegram, TG } from './tg'

export type OrderStatus = 'new' | 'accepted' | 'completed' | 'rejected' | 'cancelled'
export type KycStatus = 'none' | 'pending' | 'verified' | 'rejected'

export interface User {
  id: number
  first_name: string
  last_name?: string | null
  username?: string | null
  photo_url?: string | null
  phone?: string | null
  kyc_status: KycStatus
  kyc_note?: string | null
  created_at?: string
}

export interface Order {
  id: number
  from_cur: CurrencyCode
  to_cur: CurrencyCode
  amount_from: number
  amount_to: number
  rate: number
  fee_pct: number
  fee_amount: number
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
}

export interface KycForm {
  full_name: string
  birth_date: string
  citizenship: string
  doc_type: string
  doc_number: string
  phone: string
  address: string
  doc_photo?: string // dataURL jpeg
  selfie_photo?: string
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

export class ApiError extends Error {}

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
    throw new ApiError(j.error || 'Ошибка сети. Попробуйте ещё раз.')
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
const demoUser = (): User =>
  demo.load<User>('user', {
    id: 100000001,
    first_name: TG?.initDataUnsafe?.user?.first_name || 'Максим',
    username: TG?.initDataUnsafe?.user?.username || 'maxim',
    kyc_status: 'none',
    created_at: new Date().toISOString(),
  })
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
  async loginStart(): Promise<{ code: string; url: string }> {
    if (DEMO) return { code: 'demo', url: `https://t.me/${CONFIG.botUsername}` }
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
      const fee = (gross * CONFIG.feePct) / 100
      const list = demo.load<Order[]>('orders', [])
      const order: Order = {
        id: 1000 + list.length + 1,
        from_cur: o.from,
        to_cur: o.to,
        amount_from: o.amount,
        amount_to: gross - fee,
        rate,
        fee_pct: CONFIG.feePct,
        fee_amount: fee,
        method: o.method,
        details: o.details,
        note: o.note,
        status: 'new',
        created_at: new Date().toISOString(),
      }
      demo.save('orders', [order, ...list])
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
