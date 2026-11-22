import { useEffect, useState } from 'react'
import { AppProvider, useApp, type Tab } from './store'
import { Backdrop, Spinner, ToastProvider } from './components/ui'
import { IChart, IHistory, IHome, ISwap, IUser } from './components/Icons'
import { Home } from './screens/Home'
import { Exchange } from './screens/Exchange'
import { Rates } from './screens/Rates'
import { History } from './screens/History'
import { Profile } from './screens/Profile'
import { OrderView } from './screens/OrderView'
import { CoinView } from './screens/CoinView'
import { Kyc } from './screens/Kyc'
import { DocsList, DocView, Faq, Install } from './screens/Docs'
import { Alerts } from './screens/Alerts'
import { Welcome } from './screens/Welcome'
import { api } from './lib/api'
import { haptic, inTelegram, setBackButton, tgInit } from './lib/tg'

export default function App() {
  const [state, setState] = useState<'loading' | 'login' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')

  useEffect(() => {
    tgInit()
    ;(async () => {
      try {
        if (inTelegram) await api.authTelegram()
        setState(api.hasSession() ? 'ready' : 'login')
      } catch (e) {
        setErr((e as Error).message)
        setState('error')
      }
    })()
  }, [])

  return (
    <ToastProvider>
      <Backdrop />
      {state === 'loading' && (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
          <Spinner />
        </div>
      )}
      {state === 'error' && (
        <div className="empty" style={{ paddingTop: '40vh' }}>
          {err}
          <button className="btn btn-ghost btn-sm" style={{ margin: '16px auto' }} onClick={() => location.reload()}>
            Повторить
          </button>
        </div>
      )}
      {state === 'login' && <Welcome onDone={() => setState('ready')} />}
      {state === 'ready' && (
        <AppProvider>
          <Shell />
        </AppProvider>
      )}
    </ToastProvider>
  )
}

const TABS: { id: Tab; icon: typeof IHome; label: string }[] = [
  { id: 'home', icon: IHome, label: 'Главная' },
  { id: 'exchange', icon: ISwap, label: 'Обмен' },
  { id: 'rates', icon: IChart, label: 'Курсы' },
  { id: 'history', icon: IHistory, label: 'История' },
  { id: 'profile', icon: IUser, label: 'Профиль' },
]

function Shell() {
  const { tab, setTab, stack, pop, orders } = useApp()
  const top = stack[stack.length - 1]
  useEffect(() => setBackButton(!!top, pop), [top, pop])
  const hasActive = orders.some((o) => o.status === 'new' || o.status === 'accepted')

  // Открытие нужного экрана по ссылке из бота: ?startapp=order_123
  const { push } = useApp()
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const p = q.get('startapp') || q.get('tgWebAppStartParam') || (window as any).Telegram?.WebApp?.initDataUnsafe?.start_param // eslint-disable-line @typescript-eslint/no-explicit-any
    const m = /^order_(\d+)$/.exec(p || '')
    if (m) push({ name: 'order', id: Number(m[1]) })
    if (p === 'kyc') push({ name: 'kyc' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  let content
  if (top) {
    switch (top.name) {
      case 'order': content = <OrderView id={top.id} />; break
      case 'coin': content = <CoinView code={top.code} />; break
      case 'kyc': content = <Kyc />; break
      case 'docs': content = <DocsList />; break
      case 'doc': content = <DocView id={top.id} />; break
      case 'alerts': content = <Alerts />; break
      case 'faq': content = <Faq />; break
      case 'install': content = <Install />; break
    }
  } else {
    content = { home: <Home />, exchange: <Exchange />, rates: <Rates />, history: <History />, profile: <Profile /> }[tab]
  }

  return (
    <div className="app">
      <div key={top ? JSON.stringify(top) : tab}>{content}</div>
      {!top && (
        <nav className="tabbar">
          <div className="tabbar-inner">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab ${tab === t.id ? 'on' : ''}`}
                aria-label={t.label}
                onClick={() => {
                  haptic('select')
                  setTab(t.id)
                }}
              >
                <t.icon size={23} />
                {t.id === 'history' && hasActive && <span className="dot" />}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}
