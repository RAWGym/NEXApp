import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { bioEnabled, bioLogin, bioName, bioWith, checkPin, pinEnabled, resetLocal, weakPin, PIN_MAX_FAILS } from '../lib/security'
import { haptic } from '../lib/tg'
import { IFace } from './Icons'
import { Sheet, Spinner, useToast } from './ui'
import { enablePush, markPushAsked, shouldAskPush } from '../lib/security'

/** Экран блокировки приложения: код-пароль или Face ID */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const toast = useToast()
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const hasPin = pinEnabled()
  const hasBio = bioEnabled()

  const bio = async () => {
    setBusy(true)
    setErr('')
    try {
      await bioLogin()
      haptic('success')
      onUnlock()
    } catch (e) {
      const m = (e as Error).message || ''
      if (!/cancel|abort|NotAllowed/i.test(m + (e as Error).name)) setErr(m || 'Не удалось подтвердить вход')
    } finally {
      setBusy(false)
    }
  }

  const press = async (d: string) => {
    if (busy) return
    haptic('light')
    const next = (pin + d).slice(0, 4)
    setPin(next)
    setErr('')
    if (next.length < 4) return
    setBusy(true)
    const r = await checkPin(next)
    setBusy(false)
    if (r.ok) {
      haptic('success')
      onUnlock()
      return
    }
    haptic('error')
    setPin('')
    if (r.left <= 0) {
      api.logout()
      resetLocal()
      toast('Код введён неверно 5 раз. Войдите по номеру телефона.')
      setTimeout(() => location.reload(), 900)
      return
    }
    setErr(`Неверный код. Осталось попыток: ${r.left}`)
  }

  const exit = () => {
    api.logout()
    resetLocal()
    location.reload()
  }

  return (
    <div className="lock">
      <div className="welcome-glow" aria-hidden />
      <img src="/logo-light.svg" alt="NEX" className="lock-logo" />
      <div className="lock-title">{hasPin ? 'Введите код-пароль' : `Войдите ${bioWith}`}</div>
      {hasPin && (
        <>
          <div className={`pin-dots ${err ? 'bad' : ''}`}>
            {[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
          </div>
          <div className="lock-err">{err || ' '}</div>
          <div className="keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}
            {hasBio ? (
              <button className="kp-icon" aria-label={bioName} onClick={bio}>{busy ? <Spinner /> : <IFace size={28} />}</button>
            ) : <span />}
            <button onClick={() => press('0')}>0</button>
            <button className="kp-icon" aria-label="Стереть" onClick={() => setPin(pin.slice(0, -1))}>⌫</button>
          </div>
        </>
      )}
      {!hasPin && (
        <>
          <button className="btn btn-primary mt24" style={{ maxWidth: 320 }} onClick={bio} disabled={busy}>
            {busy ? <Spinner /> : <><IFace size={20} /> Войти {bioWith}</>}
          </button>
          <div className="lock-err">{err || ' '}</div>
        </>
      )}
      <button className="link-btn mt16" onClick={exit}>Выйти и войти по номеру</button>
      {hasPin && <div className="xs faint mt8">После {PIN_MAX_FAILS} ошибок потребуется вход по номеру</div>}
    </div>
  )
}

/** Ввод нового код-пароля дважды */
export function PinSetup({ onDone, onCancel }: { onDone: (pin: string) => void; onCancel: () => void }) {
  const [first, setFirst] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const press = (d: string) => {
    haptic('light')
    const next = (pin + d).slice(0, 4)
    setPin(next)
    setErr('')
    if (next.length < 4) return
    setTimeout(() => {
      if (!first) {
        if (weakPin(next)) {
          haptic('error')
          setErr('Слишком простой код, придумайте другой')
          setPin('')
          return
        }
        setFirst(next)
        setPin('')
        return
      }
      if (next === first) {
        haptic('success')
        onDone(next)
      } else {
        haptic('error')
        setErr('Коды не совпали, введите заново')
        setFirst('')
        setPin('')
      }
    }, 150)
  }
  return (
    <div className="lock">
      <div className="welcome-glow" aria-hidden />
      <div className="lock-title" style={{ marginTop: 'auto' }}>{first ? 'Повторите код-пароль' : 'Придумайте код-пароль'}</div>
      <div className="xs faint mt8">4 цифры для входа в приложение</div>
      <div className={`pin-dots ${err ? 'bad' : ''}`}>{[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
      <div className="lock-err">{err || ' '}</div>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}
        <button className="kp-icon xs" onClick={onCancel}>Отмена</button>
        <button onClick={() => press('0')}>0</button>
        <button className="kp-icon" aria-label="Стереть" onClick={() => setPin(pin.slice(0, -1))}>⌫</button>
      </div>
      <div style={{ marginBottom: 'auto' }} />
    </div>
  )
}

/** Предложение включить уведомления после входа */
export function PushPrompt() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  useEffect(() => {
    const t = setTimeout(async () => setOpen(await shouldAskPush()), 1500)
    return () => clearTimeout(t)
  }, [])
  const close = () => {
    markPushAsked()
    setOpen(false)
  }
  const on = async () => {
    setBusy(true)
    try {
      const st = await enablePush()
      if (st === 'on') {
        haptic('success')
        toast('Уведомления включены')
      } else if (st === 'denied') toast('Уведомления запрещены в настройках телефона')
    } catch {
      toast('Не удалось включить уведомления')
    } finally {
      setBusy(false)
      close()
    }
  }
  return (
    <Sheet open={open} onClose={close}>
      <div style={{ textAlign: 'center', padding: '6px 4px 0' }}>
        <div className="glow-icon"><BellBig /></div>
        <div style={{ fontSize: 20, fontWeight: 600, marginTop: 14 }}>Включите уведомления</div>
        <p className="small muted" style={{ margin: '8px 0 0' }}>Сообщим, когда оператор примет заявку, обмен завершится или курс дойдёт до вашей цели.</p>
        <button className="btn btn-primary mt24" onClick={on} disabled={busy}>{busy ? <Spinner /> : 'Включить'}</button>
        <button className="btn btn-ghost mt12" onClick={close}>Не сейчас</button>
      </div>
    </Sheet>
  )
}
function BellBig() {
  return (
    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}
