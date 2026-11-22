import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type Order, type User } from './lib/api'
import type { CurrencyCode } from './lib/currencies'
import { FALLBACK, type Market } from './lib/market'

export type Tab = 'home' | 'exchange' | 'rates' | 'history' | 'profile'
export type Route =
  | { name: 'order'; id: number }
  | { name: 'coin'; code: CurrencyCode }
  | { name: 'kyc' }
  | { name: 'docs' }
  | { name: 'doc'; id: string }
  | { name: 'alerts' }
  | { name: 'faq' }
  | { name: 'install' }

interface Ctx {
  user: User | null
  setUser: (u: User) => void
  market: Market
  marketLoaded: boolean
  orders: Order[]
  ordersLoaded: boolean
  refreshOrders: () => Promise<void>
  refreshUser: () => Promise<void>
  tab: Tab
  setTab: (t: Tab) => void
  stack: Route[]
  push: (r: Route) => void
  pop: () => void
  exchangePreset: { from?: CurrencyCode; to?: CurrencyCode } | null
  startExchange: (p: { from?: CurrencyCode; to?: CurrencyCode }) => void
  hideAmounts: boolean
  setHideAmounts: (v: boolean) => void
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx)
export const useApp = () => useContext(AppCtx)

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [market, setMarket] = useState<Market>(FALLBACK)
  const [marketLoaded, setMarketLoaded] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [ordersLoaded, setOrdersLoaded] = useState(false)
  const [tab, setTabState] = useState<Tab>('home')
  const [stack, setStack] = useState<Route[]>([])
  const [exchangePreset, setPreset] = useState<Ctx['exchangePreset']>(null)
  const [hideAmounts, setHide] = useState(() => {
    try {
      return localStorage.getItem('nex.hide') === '1'
    } catch {
      return false
    }
  })

  const refreshOrders = useCallback(async () => {
    try {
      setOrders(await api.orders())
    } finally {
      setOrdersLoaded(true)
    }
  }, [])
  const refreshUser = useCallback(async () => {
    setUser(await api.me())
  }, [])
  const refreshMarket = useCallback(async () => {
    const m = await api.market()
    setMarket(m)
    setMarketLoaded(true)
  }, [])

  useEffect(() => {
    refreshUser().catch(() => {})
    refreshOrders().catch(() => {})
    refreshMarket()
    const t = setInterval(refreshMarket, 60_000)
    return () => clearInterval(t)
  }, [refreshUser, refreshOrders, refreshMarket])

  // Пока есть активная заявка, проверяем статус каждые 8 секунд
  const hasActive = orders.some((o) => o.status === 'new' || o.status === 'accepted') || user?.kyc_status === 'pending'
  const activeRef = useRef(hasActive)
  activeRef.current = hasActive
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      if (activeRef.current) {
        refreshOrders().catch(() => {})
        refreshUser().catch(() => {})
      }
    }
    const t = setInterval(tick, 8000)
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        refreshOrders().catch(() => {})
        refreshUser().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [refreshOrders, refreshUser])

  const setTab = (t: Tab) => {
    setStack([])
    setTabState(t)
    window.scrollTo(0, 0)
  }
  const push = (r: Route) => {
    setStack((s) => [...s, r])
    window.scrollTo(0, 0)
  }
  const pop = () => setStack((s) => s.slice(0, -1))
  const startExchange = (p: Ctx['exchangePreset']) => {
    setPreset(p)
    setTab('exchange')
  }
  const setHideAmounts = (v: boolean) => {
    setHide(v)
    try {
      localStorage.setItem('nex.hide', v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  return (
    <AppCtx.Provider
      value={{
        user,
        setUser,
        market,
        marketLoaded,
        orders,
        ordersLoaded,
        refreshOrders,
        refreshUser,
        tab,
        setTab,
        stack,
        push,
        pop,
        exchangePreset,
        startExchange,
        hideAmounts,
        setHideAmounts,
      }}
    >
      {children}
    </AppCtx.Provider>
  )
}
