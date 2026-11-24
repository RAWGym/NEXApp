import { useState } from 'react'
import { useApp } from '../store'
import { api } from '../lib/api'
import { inTelegram, requestContact, haptic } from '../lib/tg'
import { useToast, Spinner } from './ui'
import { ICheck, ILock } from './Icons'

/** Базовые данные клиента: ФИО, дата рождения, телефон. Нужны для любой заявки. */
export function ProfileForm({ onSaved, compact }: { onSaved?: () => void; compact?: boolean }) {
  const { user, setUser, refreshUser } = useApp()
  const toast = useToast()
  const [name, setName] = useState(user?.full_name ?? [user?.first_name, user?.last_name].filter(Boolean).join(' '))
  const [birth, setBirth] = useState(user?.birth_date ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const phoneLocked = !!user?.phone_verified

  const askPhone = async () => {
    setAsking(true)
    const ok = await requestContact()
    if (ok) {
      // номер приходит боту, даём ему пару секунд
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const u = await api.me().catch(() => null)
        if (u?.phone) {
          setUser(u)
          setPhone(u.phone)
          break
        }
      }
    }
    setAsking(false)
  }

  const valid = name.trim().split(/\s+/).length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(birth) && (phoneLocked || phone.replace(/\D/g, '').length >= 10)

  const save = async () => {
    setBusy(true)
    try {
      const u = await api.saveProfile({ full_name: name.trim(), birth_date: birth, phone })
      setUser(u)
      haptic('success')
      toast('Данные сохранены')
      refreshUser().catch(() => {})
      onSaved?.()
    } catch (e) {
      haptic('error')
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stagger">
      {!compact && (
        <p className="small muted" style={{ margin: '0 4px 6px' }}>
          Эти данные нужны для любой заявки: так оператор знает, с кем проводит сделку. Для сумм больше 300 000 ₸ дополнительно потребуется подтвердить документ.
        </p>
      )}
      <label className="field">
        <span>Фамилия, имя, отчество</span>
        <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Как в документе" maxLength={120} />
      </label>
      <label className="field">
        <span>Дата рождения</span>
        <input className="input" type="date" value={birth} max={new Date(Date.now() - 18 * 365.25 * 86400_000).toISOString().slice(0, 10)} onChange={(e) => setBirth(e.target.value)} />
      </label>
      <label className="field">
        <span>Телефон</span>
        {phoneLocked ? (
          <div className="input row" style={{ justifyContent: 'space-between' }}>
            <span>{user?.phone}</span>
            <span className="xs row" style={{ gap: 4, color: 'var(--green)' }}>
              <ICheck size={14} /> подтверждён Telegram
            </span>
          </div>
        ) : (
          <>
            <input className="input" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 700 000 00 00" />
            {inTelegram && (
              <button className="link-btn mt8" onClick={askPhone} disabled={asking}>
                {asking ? 'Ждём номер…' : 'Взять номер из Telegram'}
              </button>
            )}
          </>
        )}
      </label>
      <button className="btn btn-primary mt16" disabled={!valid || busy} onClick={save}>
        {busy ? <Spinner /> : 'Сохранить'}
      </button>
      <div className="trust-row mt12">
        <ILock size={14} />
        <span>ФИО и дата рождения хранятся в зашифрованном виде (<span style={{ whiteSpace: 'nowrap' }}>AES-256</span>)</span>
      </div>
    </div>
  )
}
