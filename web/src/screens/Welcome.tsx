import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { Spinner, useToast } from '../components/ui'
import { openLink } from '../lib/tg'
import { DEMO } from '../config'

export function Welcome({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [waiting, setWaiting] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearInterval(timer.current), [])

  const start = async () => {
    if (DEMO) {
      await api.loginPoll('demo')
      return onDone()
    }
    try {
      const { code, url } = await api.loginStart()
      setWaiting(true)
      openLink(url)
      let n = 0
      timer.current = window.setInterval(async () => {
        n++
        try {
          if (await api.loginPoll(code)) {
            clearInterval(timer.current)
            onDone()
          }
        } catch {
          /* ещё не подтверждено */
        }
        if (n > 150) {
          clearInterval(timer.current)
          setWaiting(false)
          toast('Время ожидания истекло. Попробуйте снова.')
        }
      }, 2000)
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: 'calc(var(--safe-top) + 24px) 24px calc(var(--safe-bottom) + 28px)', position: 'relative', overflow: 'hidden' }}>
      <svg viewBox="0 0 400 800" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: -1 }} aria-hidden>
        <defs>
          <linearGradient id="w1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5B0F1F" />
            <stop offset="1" stopColor="#13070A" />
          </linearGradient>
          <linearGradient id="w2" x1="0" x2="1">
            <stop offset="0" stopColor="#C2404F" stopOpacity="0" />
            <stop offset="0.5" stopColor="#C2404F" stopOpacity="0.7" />
            <stop offset="1" stopColor="#C2404F" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 0 H400 V180 C 300 260, 200 300, 120 420 S 30 640, 0 700 Z" fill="url(#w1)" opacity="0.9" />
        <path d="M400 180 C 300 260, 200 300, 120 420 S 30 640, 0 700" fill="none" stroke="url(#w2)" strokeWidth="1.4" />
        <path d="M400 260 C 320 330, 230 360, 160 470 S 60 690, 20 800" fill="none" stroke="url(#w2)" strokeWidth="0.8" opacity="0.5" />
      </svg>
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <img src="/logo-light.svg" alt="NEX" style={{ width: '62%', maxWidth: 260 }} />
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 500, lineHeight: 1.25 }}>
          Обмен валют
          <br />
          и цифровых активов
        </div>
        <div className="small muted mt8">Выгодный курс, понятная комиссия 3% и живой оператор в Telegram.</div>
        {waiting ? (
          <div className="card mt24 row" style={{ gap: 14 }}>
            <Spinner />
            <div className="small">Подтвердите вход в Telegram, нажав «Запустить» в боте, и вернитесь сюда.</div>
          </div>
        ) : null}
        <button className="btn btn-primary mt24" onClick={start}>
          {waiting ? 'Открыть Telegram ещё раз' : 'Войти через Telegram'}
        </button>
        <div className="xs faint mt12" style={{ textAlign: 'center' }}>Продолжая, вы принимаете условия оферты и политику конфиденциальности</div>
      </div>
    </div>
  )
}
