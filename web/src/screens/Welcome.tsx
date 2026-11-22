import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Spinner, useToast } from '../components/ui'
import { openTgLink } from '../lib/tg'
import { CONFIG, DEMO } from '../config'
import { IChevLeft, ILock, ITelegram } from '../components/Icons'

type Step = 'phone' | 'link' | 'code'
const SID_KEY = 'nex.login'

/** Маска номера: +7 700 123 45 67 */
function formatPhone(digits: string) {
  const d = digits.slice(0, 11)
  if (!d) return ''
  if (d[0] !== '7') return '+' + d
  const p = [d.slice(1, 4), d.slice(4, 7), d.slice(7, 9), d.slice(9, 11)].filter(Boolean)
  return '+7 ' + p.join(' ')
}

export function Welcome({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const saved = (() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(SID_KEY) || 'null')
      return v && Date.now() - v.t < 15 * 60_000 ? v : null
    } catch {
      return null
    }
  })()
  const [step, setStep] = useState<Step>(saved?.step ?? 'phone')
  const [digits, setDigits] = useState<string>(saved?.digits ?? '7')
  const [sid, setSid] = useState<string>(saved?.sid ?? '')
  const [link, setLink] = useState<string>(saved?.link ?? '')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      if (sid) sessionStorage.setItem(SID_KEY, JSON.stringify({ step, digits, sid, link, t: saved?.t ?? Date.now() }))
      else sessionStorage.removeItem(SID_KEY)
    } catch {
      /* приватный режим */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sid, link, digits])

  // Пока пользователь подтверждает номер в боте, ждём отправку кода
  useEffect(() => {
    if (step !== 'link' || !sid) return
    let n = 0
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible' && n++ % 3) return
      try {
        if (await api.phoneStatus(sid)) {
          setStep('code')
          setResendIn(60)
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 410) reset('Время входа истекло, начните заново')
      }
    }, 2000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sid])

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  useEffect(() => {
    if (step === 'code') setTimeout(() => codeRef.current?.focus(), 350)
  }, [step])

  const reset = (msg?: string) => {
    setStep('phone')
    setSid('')
    setLink('')
    setCode('')
    setErr('')
    if (msg) toast(msg)
  }

  const phoneOk = digits.length === 11 || (digits[0] !== '7' && digits.length >= 10)

  const start = async () => {
    if (!phoneOk || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await api.phoneStart('+' + digits)
      setSid(r.sid)
      if (r.sent) {
        setStep('code')
        setResendIn(60)
      } else {
        setLink(r.url ?? '')
        setStep('link')
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const verify = async (c: string) => {
    if (c.length !== 6 || busy) return
    setBusy(true)
    setErr('')
    try {
      await api.phoneVerify(sid, c)
      try {
        sessionStorage.removeItem(SID_KEY)
      } catch {
        /* ignore */
      }
      onDone()
    } catch (e) {
      setCode('')
      setErr((e as Error).message)
      if (e instanceof ApiError && (e.status === 410 || e.status === 429)) setTimeout(() => reset(), 1800)
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    try {
      await api.phoneResend(sid)
      setResendIn(60)
      toast('Код отправлен ещё раз')
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-glow" aria-hidden />
      <div className="welcome-top">
        {step !== 'phone' ? (
          <button className="icon-btn" aria-label="Назад" onClick={() => reset()}>
            <IChevLeft />
          </button>
        ) : (
          <span />
        )}
      </div>

      <div className="welcome-logo">
        <img src="/logo-light.svg" alt="NEX" className="splash-logo" />
      </div>

      <div className="welcome-panel" key={step}>
        {step === 'phone' && (
          <>
            <div className="eyebrow rise">Вход в NEX</div>
            <h1 className="display rise-1">Обмен валют<br />и цифровых активов</h1>
            <p className="small muted mt8 rise-2">Введите номер, привязанный к вашему Telegram. Код для входа придёт от бота @{CONFIG.botUsername}.</p>
            <label className="phone-field mt24 rise-2">
              <span className="xs faint">Номер телефона</span>
              <input
                inputMode="tel"
                autoComplete="tel"
                placeholder="+7 700 000 00 00"
                value={formatPhone(digits)}
                onChange={(e) => {
                  let d = e.target.value.replace(/\D/g, '')
                  if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1)
                  // вставка местного номера без кода страны: 701 123 45 67
                  if (d.length === 10 && !e.target.value.trim().startsWith('+') && d.startsWith('7')) d = '7' + d
                  setDigits(d.slice(0, 15))
                  setErr('')
                }}
                onKeyDown={(e) => e.key === 'Enter' && start()}
              />
            </label>
            {err && <div className="form-err">{err}</div>}
            <button className="btn btn-primary mt16" disabled={!phoneOk || busy} onClick={start}>
              {busy ? <Spinner /> : 'Получить код'}
            </button>
            <div className="trust-row mt16">
              <ILock size={14} />
              <span>Двухэтапный вход: номер и одноразовый код в Telegram</span>
            </div>
            {DEMO && <div className="xs faint mt8" style={{ textAlign: 'center' }}>Демо-режим: код 123456</div>}
          </>
        )}

        {step === 'link' && (
          <>
            <div className="eyebrow rise">Шаг 1 из 2</div>
            <h1 className="display rise-1">Подтвердите номер в Telegram</h1>
            <p className="small muted mt8 rise-2">
              Это нужно один раз. Откройте бота, нажмите «Запустить» и «📱 Поделиться номером». Код для входа придёт туда же, а это окно продолжит само.
            </p>
            <div className="card mt16 row rise-2" style={{ gap: 12 }}>
              <Spinner />
              <div className="small">Ждём подтверждения номера {formatPhone(digits)}</div>
            </div>
            <button className="btn btn-primary mt16" onClick={() => openTgLink(link)}>
              <ITelegram size={20} /> Открыть @{CONFIG.botUsername}
            </button>
            <button className="btn btn-ghost mt12" onClick={() => setStep('code')}>
              У меня уже есть код
            </button>
          </>
        )}

        {step === 'code' && (
          <>
            <div className="eyebrow rise">Шаг 2 из 2</div>
            <h1 className="display rise-1">Введите код</h1>
            <p className="small muted mt8 rise-2">
              Мы отправили 6 цифр в Telegram от @{CONFIG.botUsername} на аккаунт с номером {formatPhone(digits)}. Код действует 5 минут.
            </p>
            <label className="otp mt24 rise-2" onClick={() => codeRef.current?.focus()}>
              <input
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                aria-label="Код из Telegram"
                onChange={(e) => {
                  const c = e.target.value.replace(/\D/g, '').slice(0, 6)
                  setCode(c)
                  setErr('')
                  if (c.length === 6) verify(c)
                }}
              />
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={`otp-cell ${i === code.length ? 'cur' : ''} ${code[i] ? 'fill' : ''} ${err ? 'bad' : ''}`}>
                  {code[i] ?? ''}
                </span>
              ))}
            </label>
            {err ? <div className="form-err">{err}</div> : busy ? <div className="row mt12" style={{ justifyContent: 'center' }}><Spinner /></div> : null}
            <button className="btn btn-ghost mt16" onClick={() => openTgLink(`https://t.me/${CONFIG.botUsername}`)}>
              <ITelegram size={20} /> Открыть Telegram
            </button>
            <button className="link-btn mt12" disabled={resendIn > 0} onClick={resend}>
              {resendIn > 0 ? `Отправить код повторно через ${resendIn} с` : 'Отправить код повторно'}
            </button>
          </>
        )}
        <div className="xs faint mt16" style={{ textAlign: 'center' }}>Продолжая, вы принимаете условия оферты и политику конфиденциальности</div>
      </div>
    </div>
  )
}
