import { useEffect, useRef, useState } from 'react'
import { api, type Me } from './api'
import { ROLE_NAME } from './ui'

/** Вход в два шага: логин и пароль, затем код из Telegram */
export function Auth({ onIn, notice }: { onIn: (token: string, me: Me) => void; notice?: string }) {
  const [step, setStep] = useState<'pass' | 'code'>('pass')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [challenge, setChallenge] = useState('')
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [err, setErr] = useState(notice ?? '')
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState(300)
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (step !== 'code') return
    setLeft(300)
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    boxes.current[0]?.focus()
    return () => clearInterval(t)
  }, [step, challenge])

  const fail = (m: string) => {
    setErr(m)
    setShake((s) => s + 1)
  }

  const submitPass = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!login || !password) return fail('Введите логин и пароль')
    setBusy(true)
    setErr('')
    try {
      const r = await api.login(login, password)
      setChallenge(r.challenge)
      setCode(['', '', '', '', '', ''])
      setStep('code')
    } catch (x) {
      fail((x as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (digits: string[]) => {
    const c = digits.join('')
    if (c.length !== 6) return
    setBusy(true)
    setErr('')
    try {
      const r = await api.verify(challenge, c)
      setPassword('')
      onIn(r.token, r.admin)
    } catch (x) {
      const st = (x as { status?: number }).status
      fail((x as Error).message)
      setCode(['', '', '', '', '', ''])
      if (st === 410 || st === 429) {
        setStep('pass')
        setPassword('')
      } else setTimeout(() => boxes.current[0]?.focus())
    } finally {
      setBusy(false)
    }
  }

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, '')
    if (d.length > 1) {
      // вставка кода целиком
      const next = d.slice(0, 6).padEnd(6, ' ').split('').map((x) => x.trim())
      setCode(next)
      boxes.current[Math.min(5, d.length)]?.focus()
      if (d.length >= 6) submitCode(next)
      return
    }
    const next = code.slice()
    next[i] = d
    setCode(next)
    if (d && i < 5) boxes.current[i + 1]?.focus()
    if (d && next.every(Boolean)) submitCode(next)
  }

  return (
    <div className="auth">
      <div className="auth__card">
        <img src="/logo-light.svg" alt="NEX" className="auth__logo" />
        <div className="steps">
          <i className="on" />
          <i className={step === 'code' ? 'on' : ''} />
        </div>
        {step === 'pass' ? (
          <form onSubmit={submitPass} className="stack" autoComplete="on">
            <div>
              <h1>Панель управления</h1>
              <p className="lead" style={{ marginBottom: 6 }}>Вход только для сотрудников NEX</p>
            </div>
            <div className="field">
              <label htmlFor="l">Логин</label>
              <input id="l" className="input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="p">Пароль</label>
              <input id="p" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" maxLength={128} />
            </div>
            <button className="btn primary block mt8" style={{ height: 50 }} disabled={busy}>
              {busy ? <span className="spinner" /> : 'Продолжить'}
            </button>
          </form>
        ) : (
          <div className="stack">
            <div>
              <h1>Код из Telegram</h1>
              <p className="lead" style={{ marginBottom: 6 }}>Бот NEX прислал 6 цифр. Код действует {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}.</p>
            </div>
            <div className="otp">
              {code.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    boxes.current[i] = el
                  }}
                  value={d}
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  aria-label={`Цифра ${i + 1}`}
                  disabled={busy}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !d && i > 0) boxes.current[i - 1]?.focus()
                  }}
                />
              ))}
            </div>
            <button
              className="btn ghost block"
              onClick={() => {
                setStep('pass')
                setErr('')
                setPassword('')
              }}
            >
              Назад
            </button>
          </div>
        )}
        <div key={shake} className={`err ${shake ? 'shake' : ''}`} role="alert">{err}</div>
        <div className="auth__foot">
          {step === 'pass' ? 'Нет учётной записи или забыли пароль? Отправьте боту NEX команду /panel.' : 'Если код пришёл, а входите не вы, нажмите в боте «Это не я».'}
        </div>
      </div>
    </div>
  )
}

function strength(p: string) {
  let s = 0
  if (p.length >= 10) s++
  if (p.length >= 14) s++
  if (/[a-zа-я]/.test(p) && /[A-ZА-Я]/.test(p)) s++
  if (/\d/.test(p)) s++
  if (/[^\p{L}\d]/u.test(p)) s++
  return s
}

/** Создание учётной записи по приглашению или смена пароля */
export function InviteScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [info, setInfo] = useState<{ reset: boolean; login: string | null; name: string; role: string | null } | null>(null)
  const [err, setErr] = useState('')
  const [login, setLogin] = useState('')
  const [name, setName] = useState('')
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    api
      .inviteInfo(token)
      .then((i) => {
        setInfo(i)
        setName(i.name ?? '')
      })
      .catch((e) => setErr((e as Error).message))
  }, [token])

  const sc = strength(p1)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (p1 !== p2) return setErr('Пароли не совпадают')
    setBusy(true)
    setErr('')
    try {
      await api.inviteAccept(token, info?.reset ? { password: p1 } : { login: login.trim().toLowerCase(), name: name.trim(), password: p1 })
      setDone(true)
    } catch (x) {
      setErr((x as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth__card">
        <img src="/logo-light.svg" alt="NEX" className="auth__logo" />
        {done ? (
          <div className="stack">
            <h1>Готово</h1>
            <p className="lead">{info?.reset ? 'Пароль изменён, все прежние сессии завершены.' : 'Учётная запись создана.'} Войдите с новым паролем, код придёт в Telegram.</p>
            <button className="btn primary block" onClick={onDone}>Перейти ко входу</button>
          </div>
        ) : !info ? (
          <div className="stack">
            <h1>Приглашение</h1>
            {err ? <p className="lead bad">{err}</p> : <span className="spinner" />}
            {err && <button className="btn ghost block" onClick={onDone}>Ко входу</button>}
          </div>
        ) : (
          <form className="stack" onSubmit={submit}>
            <div>
              <h1>{info.reset ? 'Новый пароль' : 'Учётная запись'}</h1>
              <p className="lead" style={{ marginBottom: 6 }}>
                {info.reset ? `Логин ${info.login}. Придумайте новый пароль.` : `Роль: ${ROLE_NAME[info.role ?? ''] ?? info.role}. Коды входа будут приходить в ваш Telegram.`}
              </p>
            </div>
            {!info.reset && (
              <>
                <div className="field">
                  <label htmlFor="il">Логин</label>
                  <input id="il" className="input" value={login} onChange={(e) => setLogin(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))} autoComplete="username" maxLength={32} placeholder="латиница, от 3 символов" autoFocus />
                </div>
                <div className="field">
                  <label htmlFor="in">Имя</label>
                  <input id="in" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
                </div>
              </>
            )}
            <div className="field">
              <label htmlFor="p1">Пароль</label>
              <input id="p1" className="input" type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" maxLength={128} />
              <div className="meter"><i style={{ width: `${(sc / 5) * 100}%`, background: sc < 2 ? 'var(--bad)' : sc < 4 ? 'var(--warn)' : 'var(--good)' }} /></div>
              <span className="xs faint">Не короче 10 символов, буквы и цифры. Лучше фраза из нескольких слов.</span>
            </div>
            <div className="field">
              <label htmlFor="p2">Повторите пароль</label>
              <input id="p2" className="input" type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" maxLength={128} />
            </div>
            <button className="btn primary block" style={{ height: 50 }} disabled={busy || p1.length < 10 || !p2 || (!info.reset && login.length < 3)}>
              {busy ? <span className="spinner" /> : 'Сохранить'}
            </button>
            <div className="err">{err}</div>
          </form>
        )}
      </div>
    </div>
  )
}
