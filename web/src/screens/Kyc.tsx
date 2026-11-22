import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { Spinner, TopBar, useToast } from '../components/ui'
import { ProfileForm } from '../components/ProfileForm'
import { preloadOcr, readMrz } from '../lib/ocr'
import { matchFaces, preloadFace, type FaceMatch } from '../lib/facematch'
import { namesMatch, type MrzResult } from '../lib/mrz'
import { ICheck, IChev, IClock, IDoc, IShieldCheck, IUser, VerifiedBadge, IFace, ILock } from '../components/Icons'
import { DocScanner } from '../components/DocScanner'
import { FaceScan } from '../components/FaceScan'
import { api, type DocType, type KycForm } from '../lib/api'
import { haptic } from '../lib/tg'
import { DEMO } from '../config'

const DOCS: { id: DocType; title: string; sub: string; aspect: number; back: boolean }[] = [
  { id: 'id_card', title: 'Удостоверение личности', sub: 'Лицевая и оборотная сторона', aspect: 1.586, back: true },
  { id: 'passport', title: 'Паспорт', sub: 'Страница с фотографией', aspect: 1.42, back: false },
  { id: 'residence', title: 'Вид на жительство', sub: 'Лицевая и оборотная сторона', aspect: 1.586, back: true },
]

const EMPTY: KycForm = {
  doc_type: 'id_card',
  files: {},
  liveness: { passed: false, steps: [], method: '' },
  address: '',
}

type Scan = null | 'doc_front' | 'doc_back' | 'face'
type Ocr = { state: 'idle' | 'reading' | 'done' | 'failed'; mrz: MrzResult | null }
type Match = { state: 'idle' | 'running' | 'done' | 'failed'; r: FaceMatch | null }

export function Kyc() {
  const { user, setUser, pop, push, refreshUser } = useApp()
  const toast = useToast()
  const [f, setF] = useState<KycForm>(EMPTY)
  const [step, setStep] = useState(0)
  const [scan, setScan] = useState<Scan>(null)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ocr, setOcr] = useState<Ocr>({ state: 'idle', mrz: null })
  const [manual, setManual] = useState(false)
  const [match, setMatch] = useState<Match>({ state: 'idle', r: null })
  const set = (k: keyof KycForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const doc = DOCS.find((d) => d.id === f.doc_type)!
  const mrzSide: 'doc_front' | 'doc_back' = doc.back ? 'doc_back' : 'doc_front'

  // Модели распознавания загружаются заранее, пока человек читает экран
  useEffect(() => {
    if (step === 1) preloadOcr().catch(() => {})
    if (step === 2) preloadFace().catch(() => {})
  }, [step])

  const runOcr = async (img: string) => {
    setOcr({ state: 'reading', mrz: null })
    try {
      const mrz = await readMrz(img)
      if (mrz?.valid) {
        haptic('success')
        setOcr({ state: 'done', mrz })
        setManual(false)
      } else {
        haptic('error')
        setOcr({ state: 'failed', mrz })
      }
    } catch {
      setOcr({ state: 'failed', mrz: null })
    }
  }

  const runMatch = async (face: string, docImg?: string) => {
    if (!docImg) return
    setMatch({ state: 'running', r: null })
    try {
      const r = await matchFaces(face, docImg)
      setMatch({ state: r ? 'done' : 'failed', r })
      if (r?.docFace) setF((p) => ({ ...p, files: { ...p.files, doc_face: r.docFace } }))
    } catch {
      setMatch({ state: 'failed', r: null })
    }
  }

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

  const mrz = ocr.mrz?.valid ? ocr.mrz : null
  const data = {
    full_name: user?.full_name ?? '',
    latin: mrz ? `${mrz.surname} ${mrz.given_names}` : '',
    birth_date: mrz?.birth_date || f.birth_date || '',
    doc_number: mrz?.doc_number || f.doc_number || '',
    expiry: mrz?.expiry_date || f.expiry_date || '',
    citizenship: mrz?.nationality || f.citizenship || '',
    personal: mrz?.personal_number || '',
  }
  const docsScanned = !!f.files.doc_front && (!doc.back || !!f.files.doc_back)
  const step1Ok = docsScanned && (!!mrz || (manual && data.doc_number.length >= 5 && !!data.birth_date && !!data.expiry))
  const step2Ok = !!f.files.face && match.state !== 'running'

  const checks: { label: string; ok: boolean | null; note?: string }[] = [
    { label: 'Данные считаны с документа', ok: !!mrz, note: mrz ? undefined : 'введены вручную' },
    { label: 'Контрольные цифры документа', ok: mrz ? mrz.valid : null },
    { label: 'Документ действителен', ok: data.expiry ? new Date(data.expiry).getTime() > Date.now() : null },
    { label: 'Возраст 18+', ok: data.birth_date ? age(data.birth_date) >= 18 : null },
    { label: 'ФИО совпадает с анкетой', ok: mrz && user?.full_name ? namesMatch(user.full_name, mrz) : null },
    { label: 'Дата рождения совпадает с анкетой', ok: user?.birth_date && data.birth_date ? user.birth_date === data.birth_date : null },
    { label: 'Живое лицо', ok: f.files.face ? f.liveness.passed : null },
    { label: 'Лицо совпадает с фото в документе', ok: match.r ? match.r.passed : match.state === 'failed' ? null : null, note: match.r ? `сходство ${Math.round(match.r.score * 100)}%` : match.state === 'failed' ? 'не удалось сравнить' : undefined },
  ]
  const allOk = checks.every((c) => c.ok === true)

  const submit = async () => {
    setBusy(true)
    try {
      const body: KycForm = {
        ...f,
        mrz_lines: mrz?.lines,
        full_name: user?.full_name ?? '',
        birth_date: data.birth_date,
        doc_number: data.doc_number,
        expiry_date: data.expiry,
        citizenship: data.citizenship,
        face_match: match.r ? { score: match.r.score, passed: match.r.passed } : null,
      }
      const u = await api.submitKyc(body)
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
  const STEPS = ['Документ', 'Лицо', 'Отправка']

  return (
    <div className="screen sub">
      <TopBar title="Верификация" onBack={back} />

      {step > 0 && (
        <div className="wizard">
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
              <p className="small muted" style={{ margin: '8px 0 0' }}>Около 2 минут. Ничего не нужно вводить: данные считаются с документа автоматически. После проверки лимит до 5 000 000 ₸ и отметка «Подтверждён».</p>
            </div>
            <div className="list mt12 stagger">
              <Row icon={<IUser />} t="Личные данные" s={user?.profile_done ? `${user.full_name}` : 'ФИО, телефон, дата рождения'} done={!!user?.profile_done} />
              <Row icon={<IDoc />} t="Скан документа" s="Удостоверение, паспорт или ВНЖ" />
              <Row icon={<IFace />} t="Сканирование лица" s="Повернуть голову и моргнуть" />
            </div>
            <div className="card mt12 row small muted" style={{ alignItems: 'flex-start' }}>
              <ILock size={20} style={{ flex: 'none', marginTop: 1 }} />
              <div>
                Распознавание документа и лица идёт на вашем телефоне. На сервер уходят только снимки и итог проверки, они шифруются (AES-256).{' '}
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
                <button
                  key={d.id}
                  className={`list-item pick ${f.doc_type === d.id ? 'on' : ''}`}
                  onClick={() => {
                    setF({ ...f, doc_type: d.id, files: { face: f.files.face } })
                    setOcr({ state: 'idle', mrz: null })
                    setMatch({ state: 'idle', r: null })
                  }}
                >
                  <div className="radio" />
                  <div className="grow">
                    <div className="title">{d.title}</div>
                    <div className="sub">{d.sub}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="scan-tiles mt16">
              <ScanTile label={doc.back ? 'Лицевая сторона' : 'Страница с фото'} img={f.files.doc_front} reading={mrzSide === 'doc_front' && ocr.state === 'reading'} onClick={() => setScan('doc_front')} />
              {doc.back && <ScanTile label="Оборотная сторона" img={f.files.doc_back} reading={ocr.state === 'reading'} onClick={() => setScan('doc_back')} />}
            </div>
            <p className="xs faint" style={{ margin: '10px 4px 0' }}>
              Положите документ на тёмную ровную поверхность. Когда он в рамке и резкий, снимок сделается сам.{' '}
              {doc.back ? 'Данные считываются со строк с символами <<< на обороте.' : 'Данные считываются со строк с символами <<< внизу страницы.'}
            </p>

            {ocr.state === 'reading' && (
              <div className="card mt12 row pop-in" style={{ gap: 12 }}>
                <Spinner />
                <div className="small">Считываем данные с документа…</div>
              </div>
            )}
            {mrz && (
              <div className="card mt12 ocr-card pop-in">
                <div className="row small" style={{ gap: 8, color: 'var(--green)', fontWeight: 600 }}>
                  <ICheck size={16} strokeWidth={2.6} /> Данные считаны и проверены
                </div>
                <div className="kv"><span className="k">Имя латиницей</span><span className="v">{data.latin}</span></div>
                <div className="kv"><span className="k">Дата рождения</span><span className="v">{ru(data.birth_date)}</span></div>
                <div className="kv"><span className="k">Номер документа</span><span className="v">{data.doc_number}</span></div>
                <div className="kv"><span className="k">Действителен до</span><span className="v">{ru(data.expiry)}</span></div>
                <div className="kv"><span className="k">Гражданство</span><span className="v">{data.citizenship}</span></div>
                {data.personal && <div className="kv"><span className="k">ИИН</span><span className="v">{data.personal}</span></div>}
              </div>
            )}
            {ocr.state === 'failed' && !manual && (
              <div className="card mt12 notice pop-in small">
                Не получилось считать строки с символами &lt;&lt;&lt;. Переснимите {doc.back ? 'оборотную сторону' : 'страницу с фото'} ближе, без бликов и при хорошем свете.
                <button className="link-btn mt8" onClick={() => setManual(true)}>Ввести данные вручную</button>
              </div>
            )}
            {manual && !mrz && (
              <div className="pop-in">
                <Field label="Номер документа">
                  <input className="input" value={f.doc_number ?? ''} onChange={set('doc_number')} placeholder="012345678" autoComplete="off" />
                </Field>
                <div className="grid2">
                  <Field label="Дата рождения">
                    <input className="input" type="date" value={f.birth_date ?? user?.birth_date ?? ''} onChange={set('birth_date')} max={maxBirth()} />
                  </Field>
                  <Field label="Действителен до">
                    <input className="input" type="date" value={f.expiry_date ?? ''} onChange={set('expiry_date')} />
                  </Field>
                </div>
                <Field label="Гражданство">
                  <input className="input" value={f.citizenship ?? ''} onChange={set('citizenship')} placeholder="Казахстан" />
                </Field>
                <p className="xs faint" style={{ margin: '6px 4px 0' }}>Анкету с ручным вводом оператор проверит внимательнее, это может занять больше времени.</p>
              </div>
            )}
            <button className="btn btn-primary mt16" disabled={!step1Ok} onClick={() => setStep(2)}>Далее</button>
          </>
        )}

        {step === 2 && (
          <>
            <div className="card hero-soft" style={{ textAlign: 'center', padding: '26px 18px' }}>
              {f.files.face ? (
                <div className="face-thumb pop-in"><img src={f.files.face} alt="" /><span><ICheck size={16} strokeWidth={3} /></span></div>
              ) : (
                <div className="glow-icon"><IFace size={50} /></div>
              )}
              <div style={{ fontSize: 19, fontWeight: 600, marginTop: 14 }}>{f.files.face ? 'Лицо отсканировано' : 'Сканирование лица'}</div>
              <p className="small muted" style={{ margin: '8px 0 0' }}>
                {f.files.face
                  ? match.state === 'running'
                    ? 'Сравниваем с фото в документе…'
                    : match.r
                      ? match.r.passed
                        ? `Лицо совпадает с фото в документе (сходство ${Math.round(match.r.score * 100)}%).`
                        : 'Лицо плохо совпадает с фото в документе. Переснимите при хорошем свете или продолжите: оператор проверит вручную.'
                      : 'Не удалось найти лицо на фото документа. Оператор сверит вручную.'
                  : 'Камера попросит повернуть голову и моргнуть. Это защищает от подмены фотографией.'}
              </p>
            </div>
            <ul className="tips small muted">
              <li>Хорошее освещение, без яркого света за спиной</li>
              <li>Снимите очки, головной убор и маску</li>
              <li>Держите телефон на уровне глаз</li>
            </ul>
            {f.files.face ? (
              <div className="row mt16" style={{ gap: 10 }}>
                <button className="btn btn-ghost" onClick={() => setScan('face')}>Переснять</button>
                <button className="btn btn-primary" disabled={!step2Ok} onClick={() => setStep(3)}>Далее</button>
              </div>
            ) : (
              <button className="btn btn-primary mt16" onClick={() => setScan('face')}>Начать сканирование</button>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div className={`card verdict ${allOk ? 'ok' : 'warn'} rise`}>
              <div className="verdict-icon">{allOk ? <ICheck size={22} strokeWidth={2.6} /> : <IClock size={22} />}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{allOk ? 'Автоматическая сверка пройдена' : 'Часть проверок не пройдена'}</div>
                <div className="xs muted">{allOk ? 'Осталось подтверждение оператора, обычно быстро.' : 'Можно отправить: оператор проверит вручную.'}</div>
              </div>
            </div>
            <div className="card mt12 checks stagger">
              {checks.map((c) => (
                <div key={c.label} className="check-row">
                  <span className={`ck ${c.ok === true ? 'y' : c.ok === false ? 'n' : 'q'}`}>{c.ok === true ? '✓' : c.ok === false ? '✕' : '?'}</span>
                  <span className="grow small">{c.label}</span>
                  {c.note && <span className="xs faint">{c.note}</span>}
                </div>
              ))}
            </div>
            <h2 className="section">Данные</h2>
            <div className="card" style={{ padding: '6px 16px' }}>
              <div className="kv"><span className="k">ФИО</span><span className="v">{data.full_name}</span></div>
              <div className="kv"><span className="k">Дата рождения</span><span className="v">{ru(data.birth_date)}</span></div>
              <div className="kv"><span className="k">Документ</span><span className="v">{doc.title}, № {data.doc_number}</span></div>
              <div className="kv"><span className="k">Действителен до</span><span className="v">{ru(data.expiry)}</span></div>
              <div className="kv"><span className="k">Телефон</span><span className="v">{user?.phone}</span></div>
            </div>
            <Field label="Город и адрес проживания (необязательно)">
              <input className="input" value={f.address ?? ''} onChange={set('address')} placeholder="Алматы, ул. Абая 1" />
            </Field>
            <div className="thumbs mt12">
              {f.files.doc_front && <img src={f.files.doc_front} alt="" />}
              {f.files.doc_back && <img src={f.files.doc_back} alt="" />}
              {f.files.face && <img src={f.files.face} alt="" className="round" />}
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

      {(scan === 'doc_front' || scan === 'doc_back') && (
        <DocScanner
          title={doc.title}
          hint={scan === 'doc_back' ? 'Оборотная сторона' : doc.back ? 'Лицевая сторона' : 'Страница с фотографией'}
          aspect={doc.aspect}
          onClose={() => setScan(null)}
          onDone={(img) => {
            const side = scan
            setF((p) => ({ ...p, files: { ...p.files, [side]: img } }))
            setScan(null)
            if (side === mrzSide) runOcr(img)
            if (side === 'doc_front' && f.files.face) runMatch(f.files.face, img)
          }}
        />
      )}
      {scan === 'face' && (
        <FaceScan
          onClose={() => setScan(null)}
          onDone={(r) => {
            setF((p) => ({ ...p, files: { ...p.files, face: r.image }, liveness: r.liveness }))
            setScan(null)
            runMatch(r.image, f.files.doc_front)
          }}
        />
      )}
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

function ScanTile({ label, img, onClick, reading }: { label: string; img?: string; onClick: () => void; reading?: boolean }) {
  return (
    <button className={`scan-tile ${img ? 'has' : ''} ${reading && img ? 'reading' : ''}`} onClick={onClick}>
      {img ? <img src={img} alt="" /> : <IDoc size={28} />}
      <span>{img ? 'Переснять' : label}</span>
      {img && <i><ICheck size={14} strokeWidth={3} /></i>}
    </button>
  )
}

function ru(d?: string) {
  return d ? d.split('-').reverse().join('.') : ''
}
function age(d: string) {
  return (Date.now() - new Date(d).getTime()) / (365.25 * 86400_000)
}
function maxBirth() {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 18)
  return d.toISOString().slice(0, 10)
}
