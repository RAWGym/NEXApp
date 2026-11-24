import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope/index.css'
import './admin.css'
import { api, session, setUnauthorizedHandler, type EventItem, type Me } from './api'
import { Ico, ROLE_NAME, ToastHost, initials, useToast } from './ui'
import { FeedList, eventText } from './feed'
import { Auth, InviteScreen } from './auth'
import { Overview, Finance } from './pages'
import { Orders, Users, Kyc } from './lists'
import { Team, Audit } from './team'

export type Page = 'overview' | 'orders' | 'kyc' | 'users' | 'finance' | 'team' | 'audit'
export interface Nav {
  page: Page
  open?: { kind: 'order' | 'user' | 'kyc'; id: number } | null
}
const has = (me: Me, p: string) => me.perms.includes(p)

/* ---------------- звук и системные уведомления ---------------- */
let audio: AudioContext | null = null
function chime() {
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    for (const [i, f] of [880, 1320].entries()) {
      const o = audio.createOscillator()
      const g = audio.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + i * 0.12)
      g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.12 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.5)
      o.connect(g).connect(audio.destination)
      o.start(t + i * 0.12)
      o.stop(t + i * 0.12 + 0.55)
    }
  } catch {
    /* звук недоступен */
  }
}
const PREF = 'nex.admin.notify'
const prefs = () => {
  try {
    return { sound: true, desktop: true, ...JSON.parse(localStorage.getItem(PREF) || '{}') } as { sound: boolean; desktop: boolean }
  } catch {
    return { sound: true, desktop: true }
  }
}
const savePrefs = (p: { sound: boolean; desktop: boolean }) => {
  try {
    localStorage.setItem(PREF, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}
/* ---------------- приложение ---------------- */
function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [boot, setBoot] = useState(true)
  const [invite, setInvite] = useState(() => (location.hash.match(/^#invite=([0-9a-f]{48})$/) ?? [])[1] ?? '')
  const [expired, setExpired] = useState('')

  useEffect(() => {
    // Ссылку-приглашение сразу убираем из адресной строки и истории
    if (invite) history.replaceState(null, '', location.pathname)
    setUnauthorizedHandler((msg) => {
      setMe(null)
      setExpired(msg)
    })
    if (!session.get()) return setBoot(false)
    api
      .me()
      .then(setMe)
      .catch(() => session.set(null))
      .finally(() => setBoot(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (invite) return <InviteScreen token={invite} onDone={() => setInvite('')} />
  if (boot) return <div className="auth"><span className="spinner" /></div>
  if (!me)
    return (
      <Auth
        notice={expired}
        onIn={(t, a) => {
          session.set(t)
          setExpired('')
          setMe(a)
        }}
      />
    )
  return <Shell me={me} onOut={() => setMe(null)} />
}

function Shell({ me, onOut }: { me: Me; onOut: () => void }) {
  const toast = useToast()
  const [nav, setNavState] = useState<Nav>(() => ({ page: (location.hash.slice(1) as Page) || 'overview' }))
  const [counts, setCounts] = useState({ orders_new: 0, kyc_pending: 0 })
  const [feed, setFeed] = useState<(EventItem & { fresh?: boolean })[]>([])
  const [unread, setUnread] = useState(0)
  const [online, setOnline] = useState(true)
  const [bellOpen, setBellOpen] = useState(false)
  const [tick, setTick] = useState(0) // сигнал страницам обновить данные
  const [pref, setPref] = useState(prefs)
  const since = useRef<string | undefined>(undefined)

  const setNav = useCallback((n: Nav) => {
    setNavState(n)
    if (location.hash.slice(1) !== n.page) history.replaceState(null, '', '#' + n.page)
  }, [])
  const go = useCallback((e: EventItem) => {
    if (e.type.startsWith('order')) setNav({ page: 'orders', open: { kind: 'order', id: e.id } })
    else if (e.type === 'kyc.new') setNav({ page: 'kyc', open: { kind: 'kyc', id: e.id } })
    else setNav({ page: 'users', open: { kind: 'user', id: e.id } })
  }, [setNav])

  // Новая версия панели: сверяем номер сборки раз в минуту и при возврате к окну.
  // Если окно скрыто, обновляемся сами; если открыто, показываем плашку с кнопкой.
  const [update, setUpdate] = useState(false)
  const snooze = useRef(0)
  useEffect(() => {
    let stop = false
    const check = async () => {
      try {
        const r = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
        if (!r.ok) return
        const v = (await r.json()) as { build?: string }
        if (stop || !v.build || v.build === __BUILD_ID__) return
        // Защита от круговой перезагрузки: сами перезагружаемся только один раз на каждую новую сборку
        let tried = ''
        try {
          tried = sessionStorage.getItem('nex.admin.upd') ?? ''
        } catch {
          /* хранилище недоступно */
        }
        if (document.hidden && tried !== v.build) {
          try {
            sessionStorage.setItem('nex.admin.upd', v.build)
          } catch {
            /* хранилище недоступно */
          }
          location.reload()
        } else if (Date.now() > snooze.current) setUpdate(true)
      } catch {
        /* нет сети: проверим позже */
      }
    }
    const t = window.setInterval(check, 60_000)
    const onVis = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onVis)
    check()
    return () => {
      stop = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Автообновление: опрос ленты событий раз в 15 секунд, пока вкладка открыта
  useEffect(() => {
    let stop = false
    let timer = 0
    const poll = async () => {
      try {
        const r = await api.events(since.current)
        if (stop) return
        setOnline(true)
        setCounts(r.counts)
        const first = since.current === undefined
        since.current = r.now
        if (first) setFeed(r.items.slice(0, 30))
        else if (r.items.length) {
          setFeed((f) => [...r.items.map((x) => ({ ...x, fresh: true })), ...f.map((x) => ({ ...x, fresh: false }))].slice(0, 40))
          setUnread((n) => n + r.items.length)
          setTick((t) => t + 1)
          const important = r.items.filter((x) => x.type === 'order.new' || x.type === 'kyc.new')
          const p = prefs()
          if (important.length && p.sound) chime()
          for (const e of r.items.slice(0, 3)) {
            const m = eventText(e)
            toast({ ...m, kind: e.type === 'order.completed' ? 'good' : e.type === 'user.new' ? 'info' : 'warn', onClick: () => go(e) })
            if (p.desktop && (document.hidden || !document.hasFocus()) && 'Notification' in window && Notification.permission === 'granted' && e.type !== 'user.new') {
              const n = new Notification(m.title, { body: m.text, tag: e.type + e.id, icon: '/icon-192.png' })
              n.onclick = () => {
                focus()
                go(e)
                n.close()
              }
            }
          }
        }
      } catch {
        if (!stop) setOnline(false)
      }
      if (!stop) timer = window.setTimeout(poll, document.hidden ? 30_000 : 15_000)
    }
    poll()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [toast, go])

  useEffect(() => {
    document.title = (counts.orders_new ? `(${counts.orders_new}) ` : '') + 'NEX · Панель управления'
  }, [counts.orders_new])

  const logout = async () => {
    await api.logout()
    session.set(null)
    onOut()
  }

  const items: { id: Page; label: string; icon: () => React.ReactElement; perm: string; badge?: number }[] = [
    { id: 'overview', label: 'Обзор', icon: Ico.home, perm: 'stats' },
    { id: 'orders', label: 'Заявки', icon: Ico.swap, perm: 'orders.read', badge: counts.orders_new },
    { id: 'kyc', label: 'Верификация', icon: Ico.id, perm: 'kyc.read', badge: counts.kyc_pending },
    { id: 'users', label: 'Пользователи', icon: Ico.users, perm: 'users.read' },
    { id: 'finance', label: 'Финансы', icon: Ico.coins, perm: 'finance' },
  ]
  const items2: typeof items = [
    { id: 'team', label: 'Команда', icon: Ico.team, perm: 'team.read' },
    { id: 'audit', label: 'Журнал действий', icon: Ico.log, perm: 'audit.read' },
  ]
  const allowed = [...items, ...items2].filter((i) => has(me, i.perm))
  const page = allowed.some((i) => i.id === nav.page) ? nav.page : allowed[0]?.id
  const meta = [...items, ...items2].find((i) => i.id === page)
  const props = { me, nav, setNav, tick }

  return (
    <>
      <nav className="dock" aria-label="Разделы">
        <div className="dock__logo"><img src="/mark-light.svg" alt="NEX" /></div>
        {items.filter((i) => has(me, i.perm)).map((i) => (
          <button key={i.id} className={`dock__btn ${page === i.id ? 'on' : ''}`} onClick={() => setNav({ page: i.id })} aria-label={i.label}>
            <i.icon />
            {!!i.badge && <span className={`badge ${i.id === 'orders' ? 'pulse' : ''}`}>{i.badge > 99 ? '99+' : i.badge}</span>}
            <span className="tip">{i.label}</span>
          </button>
        ))}
        {items2.some((i) => has(me, i.perm)) && <div className="dock__sep" />}
        {items2.filter((i) => has(me, i.perm)).map((i) => (
          <button key={i.id} className={`dock__btn ${page === i.id ? 'on' : ''}`} onClick={() => setNav({ page: i.id })} aria-label={i.label}>
            <i.icon />
            <span className="tip">{i.label}</span>
          </button>
        ))}
        <div className="dock__sep" />
        <button className="dock__btn" onClick={logout} aria-label="Выйти">
          <Ico.logout />
          <span className="tip">Выйти</span>
        </button>
      </nav>

      <main className="shell">
        <header className="top">
          <div className="top__title">
            <h1 key={page} className="fade">{meta?.label}</h1>
            <p>{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
          <div className="top__right">
            <span className={`live ${online ? '' : 'off'}`} title="Данные обновляются автоматически">
              <i /> {online ? 'Онлайн' : 'Нет связи'}
            </span>
            <div style={{ position: 'relative' }}>
              <button
                className="iconbtn"
                aria-label="Уведомления"
                onClick={() => {
                  setBellOpen(!bellOpen)
                  setUnread(0)
                }}
              >
                <Ico.bell />
                {unread > 0 && <span className="badge pulse">{unread}</span>}
              </button>
              {bellOpen && (
                <Bell
                  feed={feed}
                  pref={pref}
                  setPref={(p) => {
                    setPref(p)
                    savePrefs(p)
                  }}
                  onPick={(e) => {
                    setBellOpen(false)
                    go(e)
                  }}
                  onClose={() => setBellOpen(false)}
                />
              )}
            </div>
            <div className="mebtn">
              <span className="avatar sm">{initials(me.name || me.login)}</span>
              <span>
                <b>{me.name || me.login}</b>
                <small>{ROLE_NAME[me.role]}</small>
              </span>
            </div>
          </div>
        </header>

        {page === 'overview' && <Overview {...props} feed={feed} onPick={go} />}
        {page === 'orders' && <Orders {...props} />}
        {page === 'kyc' && <Kyc {...props} />}
        {page === 'users' && <Users {...props} />}
        {page === 'finance' && <Finance {...props} />}
        {page === 'team' && <Team {...props} />}
        {page === 'audit' && <Audit {...props} />}
      </main>
      {update && (
        <div className="upd" role="status">
          <span className="upd__dot" />
          <div className="upd__text">
            <b>Вышла новая версия панели</b>
            <small>Обновление займёт секунду, вход сохранится</small>
          </div>
          <button className="btn ghost sm" onClick={() => ((snooze.current = Date.now() + 30 * 60_000), setUpdate(false))}>Позже</button>
          <button className="btn primary sm" onClick={() => location.reload()}>Обновить</button>
        </div>
      )}
    </>
  )
}

function Bell({ feed, pref, setPref, onPick, onClose }: { feed: EventItem[]; pref: { sound: boolean; desktop: boolean }; setPref: (p: { sound: boolean; desktop: boolean }) => void; onPick: (e: EventItem) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose()
    setTimeout(() => addEventListener('mousedown', h))
    return () => removeEventListener('mousedown', h)
  }, [onClose])
  const perm = 'Notification' in window ? Notification.permission : 'denied'
  return (
    <div className="pop" ref={ref}>
      <div className="pop__head">
        Уведомления
        <div className="row">
          <button onClick={() => setPref({ ...pref, sound: !pref.sound })}>{pref.sound ? 'Звук вкл.' : 'Звук выкл.'}</button>
          {perm === 'default' ? (
            <button onClick={() => Notification.requestPermission().then(() => setPref({ ...pref, desktop: true }))}>Включить на компьютере</button>
          ) : perm === 'granted' ? (
            <button onClick={() => setPref({ ...pref, desktop: !pref.desktop })}>{pref.desktop ? 'На компьютере вкл.' : 'На компьютере выкл.'}</button>
          ) : null}
        </div>
      </div>
      <FeedList items={feed} onPick={onPick} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="bgfx" aria-hidden>
      <i />
      <i />
      <i />
    </div>
    <ToastHost>
      <App />
    </ToastHost>
  </StrictMode>,
)
