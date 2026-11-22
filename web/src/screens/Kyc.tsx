import { useState } from 'react'
import { useApp } from '../store'
import { TopBar, useToast } from '../components/ui'
import { ICamera, IClock, IShieldCheck, VerifiedBadge } from '../components/Icons'
import { api, type KycForm } from '../lib/api'
import { haptic } from '../lib/tg'
import { DEMO } from '../config'

const EMPTY: KycForm = { full_name: '', birth_date: '', citizenship: 'Казахстан', doc_type: 'Удостоверение личности', doc_number: '', phone: '', address: '' }

export function Kyc() {
  const { user, setUser, pop, push, refreshUser } = useApp()
  const toast = useToast()
  const [f, setF] = useState<KycForm>(EMPTY)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [redo, setRedo] = useState(false)
  const set = (k: keyof KycForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })

  const status = user?.kyc_status ?? 'none'
  if ((status === 'verified' || status === 'pending') && !redo) {
    return (
      <div className="screen sub">
        <TopBar title="Верификация" onBack={pop} />
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {status === 'verified' ? <VerifiedBadge size={64} /> : <IClock size={56} style={{ color: 'var(--amber)' }} />}
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, marginTop: 14 }}>{status === 'verified' ? 'Аккаунт подтверждён' : 'Анкета на проверке'}</div>
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            {status === 'verified'
              ? 'У вашего профиля отметка «Подтверждён». Вам доступны повышенные лимиты и приоритет обработки заявок.'
              : 'Обычно проверка занимает до 24 часов. Бот пришлёт уведомление, как только мы её завершим.'}
          </p>
        </div>
        {DEMO && status === 'pending' && (
          <div className="demo-bar">
            Демо-режим: действия оператора в боте.
            <div className="row">
              <button onClick={() => (api.demoKyc('verified'), refreshUser())}>Одобрить</button>
              <button onClick={() => (api.demoKyc('rejected'), refreshUser())}>Отклонить</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const valid =
    f.full_name.trim().split(/\s+/).length >= 2 && f.birth_date && f.doc_number.trim().length >= 5 && f.phone.replace(/\D/g, '').length >= 10 && f.doc_photo && f.selfie_photo && agree

  const submit = async () => {
    setBusy(true)
    try {
      const u = await api.submitKyc(f)
      setUser(u)
      setRedo(false)
      haptic('success')
      toast('Анкета отправлена на проверку')
    } catch (e) {
      haptic('error')
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen sub">
      <TopBar title="Верификация" onBack={pop} />
      {status === 'rejected' && (
        <div className="card small" style={{ borderColor: 'rgba(229,103,122,0.3)', background: 'rgba(229,103,122,0.07)', marginBottom: 12 }}>
          Предыдущая анкета отклонена{user?.kyc_note ? `: ${user.kyc_note}` : ''}. Проверьте данные и отправьте снова.
        </div>
      )}
      <div className="card row">
        <IShieldCheck size={28} style={{ color: 'var(--accent)', flex: 'none' }} />
        <div className="small muted">
          После проверки у профиля появится отметка «Подтверждён», лимит вырастет, а заявки будут обрабатываться в приоритете. Данные защищены и видны только оператору.
        </div>
      </div>

      <label className="field"><span>ФИО полностью</span><input className="input" value={f.full_name} onChange={set('full_name')} placeholder="Иванов Иван Иванович" autoComplete="name" /></label>
      <label className="field"><span>Дата рождения</span><input className="input" type="date" value={f.birth_date} onChange={set('birth_date')} max={maxBirth()} /></label>
      <label className="field"><span>Гражданство</span>
        <select className="input" value={f.citizenship} onChange={set('citizenship')}>
          {['Казахстан', 'Россия', 'Узбекистан', 'Кыргызстан', 'Беларусь', 'Другое'].map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label className="field"><span>Документ</span>
        <select className="input" value={f.doc_type} onChange={set('doc_type')}>
          {['Удостоверение личности', 'Паспорт', 'Заграничный паспорт', 'Вид на жительство'].map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label className="field"><span>Номер документа</span><input className="input" value={f.doc_number} onChange={set('doc_number')} placeholder="№ 012345678" /></label>
      <label className="field"><span>Телефон</span><input className="input" type="tel" value={f.phone} onChange={set('phone')} placeholder="+7 700 000 00 00" autoComplete="tel" /></label>
      <label className="field"><span>Город и адрес проживания</span><input className="input" value={f.address} onChange={set('address')} placeholder="Алматы, ул. Абая 1" /></label>

      <div className="row mt16" style={{ gap: 10 }}>
        <PhotoPick label="Фото документа" value={f.doc_photo} onChange={(v) => setF({ ...f, doc_photo: v })} />
        <PhotoPick label="Селфи с документом" value={f.selfie_photo} onChange={(v) => setF({ ...f, selfie_photo: v })} />
      </div>

      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          Подтверждаю достоверность данных и даю согласие на их обработку согласно{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), push({ name: 'doc', id: 'privacy' }))}>политике конфиденциальности</a> и{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), push({ name: 'doc', id: 'aml' }))}>политике AML/KYC</a>
        </span>
      </label>
      <button className="btn btn-primary mt16" disabled={!valid || busy} onClick={submit}>
        {busy ? 'Отправляем…' : 'Отправить на проверку'}
      </button>
    </div>
  )
}

function maxBirth() {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 18)
  return d.toISOString().slice(0, 10)
}

function PhotoPick({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  const toast = useToast()
  return (
    <label className="photo-pick grow">
      {value && <img src={value} alt="" />}
      <ICamera size={26} />
      <span>{value ? 'Заменить' : label}</span>
      <input
        type="file"
        accept="image/*"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          try {
            onChange(await compress(file))
          } catch {
            toast('Не удалось прочитать фото')
          }
        }}
      />
    </label>
  )
}

/** Сжимаем фото до 1600px и JPEG 80%, чтобы быстро отправлялось */
async function compress(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = url
    })
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale)
    c.height = Math.round(img.height * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.8)
  } finally {
    URL.revokeObjectURL(url)
  }
}
