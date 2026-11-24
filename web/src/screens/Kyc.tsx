import { useRef, useState } from 'react'
import { useApp } from '../store'
import { TopBar, useToast } from '../components/ui'
import { ProfileForm } from '../components/ProfileForm'
import { ICheck, IChev, IClock, IDoc, IShieldCheck, IUser, VerifiedBadge, IFace, ILock } from '../components/Icons'
import { compressFile } from '../lib/camera'
import { api, type DocType, type KycForm } from '../lib/api'
import { haptic } from '../lib/tg'
import { DEMO } from '../config'

const DOCS: { id: DocType; title: string; sub: string; back: boolean; num: string }[] = [
  { id: 'id_card', title: 'Удостоверение личности', sub: 'Лицевая и оборотная сторона', back: true, num: '9 цифр, например 012345678' },
  { id: 'passport', title: 'Паспорт', sub: 'Разворот с фотографией', back: false, num: 'Например N12345678' },
  { id: 'residence', title: 'Вид на жительство', sub: 'Лицевая и оборотная сторона', back: true, num: 'Номер с лицевой стороны' },
]
const COUNTRIES = ['Казахстан', 'Россия', 'Узбекистан', 'Кыргызстан', 'Таджикистан', 'Беларусь', 'Армения', 'Азербайджан', 'Грузия', 'Туркменистан', 'Украина', 'Китай', 'Турция']
const ISSUERS = ['МВД РК', 'МЮ РК', 'МВД России', 'Другой орган']

const EMPTY: KycForm = {
  doc_type: 'id_card',
  doc_number: '',
  personal_number: '',
  issue_date: '',
  expiry_date: '',
  issued_by: '',
  citizenship: 'Казахстан',
  birth_place: '',
  address: '',
  files: {},
}


export function Kyc() {
  const { user, setUser, pop, push, refreshUser } = useApp()
  const toast = useToast()
  const [f, setF] = useState<KycForm>(EMPTY)
  const [issuerOther, setIssuerOther] = useState(false)
  const [step, setStep] = useState(0)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  const doc = DOCS.find((d) => d.id === f.doc_type)!
  const set = (k: keyof KycForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })

  const status = user?.kyc_status ?? 'none'
  if (status === 'verified' || status === 'pending') {
    return (
      <div className="screen sub">
        <TopBar title="Верификация" onBack={pop} />
        <div className="card rise" style={{ textAlign: 'center', padding: '36px 20px' }}>
          <div className="glow-icon">{status === 'verified' ? <VerifiedBadge size={64} /> : <IClock size={52} style={{ color: 'var(--amber)' }} />}</div>
          <div style={{ fontSize: 21, fontWeight: 600, marginTop: 16 }}>{status === 'verified' ? 'Аккаунт подтверждён' : 'Документы на проверке'}</div>
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            {status === 'verified'
              ? 'У вашего профиля отметка «Подтверждён». Вам доступны обмены до 5 000 000 ₸ и приоритет обработки заявок.'
              : 'Обычно проверка занимает до 24 часов, чаще быстрее. Бот пришлёт уведомление, как только мы её завершим.'}
          </p>
        </div>
        <button className="card row mt12" style={{ width: '100%', textAlign: 'left' }} onClick={() => push({ name: 'doc', id: 'security' })}>
          <ILock size={22} className="muted" />
          <div className="grow small">Как мы защищаем ваши данные</div>
          <IChev className="chev" size={18} />
        </button>
        {DEMO && status === 'pending' && (
          <div className="demo-bar">
            Демо-режим: действия оператора.
            <div className="row">
              <button onClick={() => (api.demoKyc('verified'), refreshUser())}>Одобрить</button>
              <button onClick={() => (api.demoKyc('rejected'), refreshUser())}>Отклонить</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Проверка полей прямо при вводе
  const today = new Date().toISOString().slice(0, 10)
  const kz = f.citizenship === 'Казахстан'
  const iin = (f.personal_number ?? '').replace(/\D/g, '')
  const errs: Partial<Record<keyof KycForm, string>> = {}
  const num = (f.doc_number ?? '').trim()
  if (num.length < 5) errs.doc_number = 'Введите номер документа'
  else if (f.doc_type === 'id_card' && kz && !/^\d{9}$/.test(num)) errs.doc_number = 'У удостоверения РК 9 цифр'
  if (kz) {
    if (iin.length !== 12) errs.personal_number = 'ИИН состоит из 12 цифр'
    else if (!iinValid(iin)) errs.personal_number = 'ИИН введён с ошибкой, проверьте цифры'
    else if (user?.birth_date && iinBirth(iin) !== user.birth_date) errs.personal_number = 'ИИН не совпадает с датой рождения в личных данных'
  }
  if (!f.issue_date) errs.issue_date = 'Укажите дату выдачи'
  else if (f.issue_date > today) errs.issue_date = 'Дата выдачи не может быть в будущем'
  if (!f.expiry_date) errs.expiry_date = 'Укажите срок действия'
  else if (f.expiry_date <= today) errs.expiry_date = 'Срок действия документа истёк'
  else if (f.issue_date && f.expiry_date <= f.issue_date) errs.expiry_date = 'Срок действия раньше даты выдачи'
  if ((f.issued_by ?? '').trim().length < 2) errs.issued_by = 'Укажите, кем выдан документ'
  if (!f.citizenship?.trim()) errs.citizenship = 'Укажите гражданство'
  if ((f.address ?? '').trim().length < 5) errs.address = 'Укажите город и адрес'
  const step1Ok = Object.keys(errs).length === 0
  const step2Ok = !!f.files.doc_front && (!doc.back || !!f.files.doc_back) && !!f.files.selfie

  const submit = async () => {
    setBusy(true)
    try {
      const u = await api.submitKyc({ ...f, personal_number: iin || f.personal_number, doc_number: num })
      setUser(u)
      haptic('success')
      toast('Документы отправлены на проверку')
    } catch (e) {
      haptic('error')
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const back = () => (step > 0 ? setStep(step - 1) : pop())
  const STEPS = ['Данные', 'Фото', 'Отправка']
  const err = (k: keyof KycForm) => (touched || (f[k] as string)) && errs[k] ? errs[k] : undefined

  return (
    <div className="screen sub">
      <TopBar title="Верификация" onBack={back} />

      {step > 0 && (
        <div className="wizard" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {STEPS.map((s, i) => (
            <div key={s} className={`wz ${i + 1 < step ? 'done' : i + 1 === step ? 'cur' : ''}`}>
              <span />
              <small>{s}</small>
            </div>
          ))}
        </div>
      )}

      <div key={step} className="slide-in">
        {step === 0 && (
          <>
            {status === 'rejected' && (
              <div className="card small notice-bad" style={{ marginBottom: 12 }}>
                Предыдущая анкета отклонена{user?.kyc_note ? `: ${user.kyc_note}` : ''}. Пройдите проверку ещё раз.
              </div>
            )}
            <div className="card hero-soft" style={{ textAlign: 'center', padding: '28px 18px' }}>
              <div className="glow-icon"><IShieldCheck size={46} /></div>
              <div style={{ fontSize: 20, fontWeight: 600, marginTop: 14 }}>Подтвердите документ</div>
              <p className="small muted" style={{ margin: '8px 0 0' }}>Около 3 минут. После проверки лимит обмена до 5 000 000 ₸ и отметка «Подтверждён».</p>
            </div>
            <div className="list mt12 stagger">
              <Row icon={<IUser />} t="Личные данные" s={user?.profile_done ? `${user.full_name}` : 'ФИО, телефон, дата рождения'} done={!!user?.profile_done} />
              <Row icon={<IDoc />} t="Данные документа" s="Номер, ИИН, кем и когда выдан, срок действия" />
              <Row icon={<IFace />} t={'Фото документа и селфи с\u00a0ним'} s="Документ рядом с лицом, данные читаемы" />
            </div>
            <div className="card mt12 row small muted" style={{ alignItems: 'flex-start' }}>
              <ILock size={20} style={{ flex: 'none', marginTop: 1 }} />
              <div>
                Данные и фото шифруются (<span style={{ whiteSpace: 'nowrap' }}>AES-256</span>) и хранятся на защищённых серверах в ЕС (Германия). Доступ есть только у сотрудников, проверяющих анкеты.{' '}
                <a href="#" onClick={(e) => (e.preventDefault(), push({ name: 'doc', id: 'security' }))}>Подробнее</a>
              </div>
            </div>
            {user?.profile_done ? (
              <button className="btn btn-primary mt16" onClick={() => setStep(1)}>Начать</button>
            ) : (
              <>
                <h2 className="section">Сначала личные данные</h2>
                <ProfileForm compact onSaved={() => setStep(1)} />
              </>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="section" style={{ marginTop: 6 }}>Какой документ</h2>
            <div className="list">
              {DOCS.map((d) => (
                <button key={d.id} className={`list-item pick ${f.doc_type === d.id ? 'on' : ''}`} onClick={() => setF({ ...f, doc_type: d.id, files: { selfie: f.files.selfie } })}>
                  <div className="radio" />
                  <div className="grow">
                    <div className="title">{d.title}</div>
                    <div className="sub">{d.sub}</div>
                  </div>
                </button>
              ))}
            </div>

            <h2 className="section">Данные документа</h2>
            <div className="card" style={{ padding: '6px 16px' }}>
              <div className="kv"><span className="k">ФИО</span><span className="v">{user?.full_name}</span></div>
              <div className="kv"><span className="k">Дата рождения</span><span className="v">{ru(user?.birth_date)}</span></div>
            </div>
            <p className="xs faint" style={{ margin: '6px 4px 0' }}>
              Должны совпадать с документом. Ошибка?{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), push({ name: 'personal' }))}>Исправить</a>
            </p>

            <Field label="Гражданство" err={err('citizenship')}>
              <input className="input" list="kyc-countries" value={f.citizenship ?? ''} onChange={set('citizenship')} placeholder="Казахстан" autoComplete="country-name" />
              <datalist id="kyc-countries">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Номер документа" err={err('doc_number')}>
              <input className="input" value={f.doc_number ?? ''} onChange={(e) => setF({ ...f, doc_number: e.target.value.toUpperCase().replace(/[^A-ZА-Я0-9]/g, '').slice(0, 20) })} placeholder={doc.num} autoComplete="off" inputMode={f.doc_type === 'id_card' ? 'numeric' : 'text'} />
            </Field>
            <Field label={kz ? 'ИИН' : 'Личный номер (если есть в документе)'} err={err('personal_number')}>
              <input className="input" value={f.personal_number ?? ''} onChange={(e) => setF({ ...f, personal_number: e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 20) })} placeholder={kz ? '12 цифр' : 'Необязательно'} inputMode={kz ? 'numeric' : 'text'} autoComplete="off" />
            </Field>
            <Field label="Кем выдан" err={err('issued_by')}>
              {issuerOther ? (
                <input className="input" value={f.issued_by ?? ''} onChange={set('issued_by')} placeholder="Орган, выдавший документ" autoFocus />
              ) : (
                <select
                  className="input"
                  value={f.issued_by ?? ''}
                  onChange={(e) => (e.target.value === 'Другой орган' ? (setIssuerOther(true), setF({ ...f, issued_by: '' })) : setF({ ...f, issued_by: e.target.value }))}
                >
                  <option value="" disabled>Выберите</option>
                  {ISSUERS.map((i) => <option key={i}>{i}</option>)}
                </select>
              )}
            </Field>
            <div className="grid2">
              <Field label="Дата выдачи" err={err('issue_date')}>
                <input className="input" type="date" value={f.issue_date ?? ''} onChange={set('issue_date')} max={today} />
              </Field>
              <Field label="Действителен до" err={err('expiry_date')}>
                <input className="input" type="date" value={f.expiry_date ?? ''} onChange={set('expiry_date')} min={today} />
              </Field>
            </div>
            <Field label="Место рождения (необязательно)">
              <input className="input" value={f.birth_place ?? ''} onChange={set('birth_place')} placeholder="Как в документе" />
            </Field>
            <Field label="Адрес проживания" err={err('address')}>
              <input className="input" value={f.address ?? ''} onChange={set('address')} placeholder="Алматы, ул. Абая 1, кв. 5" autoComplete="street-address" />
            </Field>
            <button className="btn btn-primary mt16" onClick={() => (step1Ok ? setStep(2) : (setTouched(true), haptic('error')))}>Далее</button>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="section" style={{ marginTop: 6 }}>{doc.title}</h2>
            <div className="scan-tiles">
              <PhotoTile label={doc.back ? 'Лицевая сторона' : 'Разворот с фото'} img={f.files.doc_front} onPick={(img) => setF((p) => ({ ...p, files: { ...p.files, doc_front: img } }))} />
              {doc.back && <PhotoTile label="Оборотная сторона" img={f.files.doc_back} onPick={(img) => setF((p) => ({ ...p, files: { ...p.files, doc_back: img } }))} />}
            </div>
            <p className="xs faint" style={{ margin: '10px 4px 0' }}>Документ целиком, без бликов и пальцев на данных. Все надписи должны читаться.</p>

            <h2 className="section">Селфи с документом</h2>
            <div className="scan-tiles" style={{ gridTemplateColumns: '1fr' }}>
              <PhotoTile label="Сделать селфи" img={f.files.selfie} selfie tall onPick={(img) => setF((p) => ({ ...p, files: { ...p.files, selfie: img } }))} />
            </div>
            <ul className="tips small muted">
              <li>Держите документ разворотом с фото рядом с лицом</li>
              <li>Лицо и фото в документе должны быть хорошо видны</li>
              <li>Без очков, головного убора и маски, при хорошем свете</li>
            </ul>
            <button className="btn btn-primary mt16" disabled={!step2Ok} onClick={() => setStep(3)}>Далее</button>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="section" style={{ marginTop: 6 }}>Проверьте данные</h2>
            <div className="card" style={{ padding: '6px 16px' }}>
              <div className="kv"><span className="k">ФИО</span><span className="v">{user?.full_name}</span></div>
              <div className="kv"><span className="k">Дата рождения</span><span className="v">{ru(user?.birth_date)}</span></div>
              <div className="kv"><span className="k">Гражданство</span><span className="v">{f.citizenship}</span></div>
              <div className="kv"><span className="k">Документ</span><span className="v">{doc.title}, № {num}</span></div>
              {iin && <div className="kv"><span className="k">{kz ? 'ИИН' : 'Личный номер'}</span><span className="v">{iin || f.personal_number}</span></div>}
              <div className="kv"><span className="k">Кем выдан</span><span className="v">{f.issued_by}</span></div>
              <div className="kv"><span className="k">Дата выдачи</span><span className="v">{ru(f.issue_date)}</span></div>
              <div className="kv"><span className="k">Действителен до</span><span className="v">{ru(f.expiry_date)}</span></div>
              {f.birth_place && <div className="kv"><span className="k">Место рождения</span><span className="v">{f.birth_place}</span></div>}
              <div className="kv"><span className="k">Адрес</span><span className="v">{f.address}</span></div>
              <div className="kv"><span className="k">Телефон</span><span className="v">{user?.phone}</span></div>
            </div>
            <div className="thumbs mt12">
              {f.files.doc_front && <img src={f.files.doc_front} alt="" />}
              {f.files.doc_back && <img src={f.files.doc_back} alt="" />}
              {f.files.selfie && <img src={f.files.selfie} alt="" />}
            </div>
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                Подтверждаю достоверность данных и даю согласие на их обработку согласно{' '}
                <a href="#" onClick={(e) => (e.preventDefault(), push({ name: 'doc', id: 'privacy' }))}>политике конфиденциальности</a> и{' '}
                <a href="#" onClick={(e) => (e.preventDefault(), push({ name: 'doc', id: 'aml' }))}>политике AML/KYC</a>
              </span>
            </label>
            <button className="btn btn-primary mt16" disabled={!agree || busy || !step1Ok || !step2Ok} onClick={submit}>
              {busy ? 'Отправляем…' : 'Отправить на проверку'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ icon, t, s, done }: { icon: React.ReactNode; t: string; s: string; done?: boolean }) {
  return (
    <div className="list-item">
      <div className="icon-chip">{icon}</div>
      <div className="grow">
        <div className="title">{t}</div>
        <div className="sub">{s}</div>
      </div>
      {done && <ICheck size={18} style={{ color: 'var(--green)' }} />}
    </div>
  )
}

function Field({ label, err, children }: { label: string; err?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {err && <em className="field-err">{err}</em>}
    </label>
  )
}

/** Фото с камеры или из галереи. Селфи открывает фронтальную камеру. */
function PhotoTile({ label, img, onPick, selfie, tall }: { label: string; img?: string; onPick: (img: string) => void; selfie?: boolean; tall?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <>
    <button className={`scan-tile ${img ? 'has' : ''}`} style={tall ? { height: 200 } : undefined} onClick={() => ref.current?.click()} disabled={busy}>
      {img ? <img src={img} alt="" /> : selfie ? <IFace size={30} /> : <IDoc size={28} />}
      <span>{busy ? 'Обработка…' : img ? 'Переснять' : label}</span>
      {img && <i><ICheck size={14} strokeWidth={3} /></i>}
    </button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        {...(selfie ? { capture: 'user' as const } : {})}
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          if (file.size > 25_000_000) return toast('Файл слишком большой')
          setBusy(true)
          try {
            onPick(await compressFile(file, 1800))
            haptic('success')
          } catch {
            toast('Не удалось открыть фото. Попробуйте сделать снимок ещё раз.')
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}

function ru(d?: string | null) {
  return d ? d.split('-').reverse().join('.') : ''
}
/** Контрольный разряд ИИН РК */
function iinValid(s: string) {
  if (!/^\d{12}$/.test(s)) return false
  const d = s.split('').map(Number)
  let c = d.slice(0, 11).reduce((a, x, i) => a + x * (i + 1), 0) % 11
  if (c === 10) {
    c = d.slice(0, 11).reduce((a, x, i) => a + x * (((i + 2) % 11) + 1), 0) % 11
    if (c === 10) return false
  }
  return c === d[11]
}
/** Дата рождения из ИИН: ГГММДД и век из 7-й цифры */
function iinBirth(s: string) {
  const c = +s[6]
  const century = c <= 2 ? 1800 : c <= 4 ? 1900 : 2000
  return `${century + +s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`
}
