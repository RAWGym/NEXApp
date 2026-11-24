import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/* ---------------- форматирование ---------------- */
const nfCache: Record<number, Intl.NumberFormat> = {}
export const nf = (n: number | null | undefined, dp = 0) => (nfCache[dp] ??= new Intl.NumberFormat('ru-RU', { maximumFractionDigits: dp, minimumFractionDigits: 0 })).format(Number(n ?? 0))
export const kzt = (n: number | null | undefined) => nf(n) + ' ₸'
/** Сокращённая запись больших сумм: 12,4 млн */
export function short(n: number) {
  const a = Math.abs(n)
  if (a >= 1e9) return nf(n / 1e9, 1) + ' млрд'
  if (a >= 1e6) return nf(n / 1e6, 1) + ' млн'
  if (a >= 1e4) return nf(n / 1e3, 0) + ' тыс'
  return nf(n)
}
export const amt = (n: number, cur: string) => nf(n, ['BTC', 'ETH'].includes(cur) ? 6 : cur === 'KZT' || cur === 'RUB' ? 0 : 2) + ' ' + cur
export const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '') : '')
export const dOnly = (s?: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '')
export function ago(s?: string | null) {
  if (!s) return ''
  const m = Math.round((Date.now() - Date.parse(s)) / 60_000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.round(h / 24)
  return d < 30 ? `${d} дн назад` : dOnly(s)
}
export const initials = (a?: string | null, b?: string | null) => ((a?.[0] ?? '') + (b?.[0] ?? '')).toUpperCase() || '?'
export const userName = (u: { first_name?: string; last_name?: string | null; full_name?: string | null } | null | undefined) =>
  u ? u.full_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Без имени' : ''

export const ORDER_ST: Record<string, string> = { new: 'Новая', accepted: 'В работе', completed: 'Завершена', rejected: 'Отклонена', cancelled: 'Отменена' }
export const KYC_ST: Record<string, string> = { none: 'Нет', pending: 'На проверке', verified: 'Подтверждена', rejected: 'Отклонена' }
export const ROLE_NAME: Record<string, string> = { owner: 'Владелец', admin: 'Администратор', operator: 'Оператор', viewer: 'Наблюдатель' }
export const DOC_NAME: Record<string, string> = { id_card: 'Удостоверение личности', passport: 'Паспорт', foreign_passport: 'Загранпаспорт', residence: 'Вид на жительство' }

/* ---------------- сегменты с ползунком ---------------- */
export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    // Пересчёт после загрузки шрифта и при изменении размеров, чтобы подложка всегда стояла ровно
    const place = () => {
      const el = root.querySelector<HTMLButtonElement>('button.on')
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth })
    }
    place()
    document.fonts?.ready.then(place)
    const ro = new ResizeObserver(place)
    ro.observe(root)
    return () => ro.disconnect()
  }, [value, options.length])
  return (
    <div className="seg" ref={ref} role="tablist">
      {pill && <span className="seg__pill" style={pill} />}
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={o.id === value} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------- плавный счётчик ---------------- */
export function Count({ value, format = nf }: { value: number; format?: (n: number) => string }) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    const d = 900
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / d)
      const e = 1 - Math.pow(2, -10 * k) // expo.out
      setV(a + (value - a) * (k === 1 ? 1 : e))
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{format(v)}</>
}

export function Delta({ cur, prev, invert }: { cur: number; prev: number | undefined; invert?: boolean }) {
  if (prev == null || (!prev && !cur)) return null
  if (!prev) return <span className="chip up">новое</span>
  const p = ((cur - prev) / Math.abs(prev)) * 100
  const up = p >= 0
  return (
    <span className={`chip ${up !== !!invert ? 'up' : 'down'}`}>
      {up ? '↑' : '↓'} {nf(Math.abs(p), Math.abs(p) < 10 ? 1 : 0)}%
    </span>
  )
}

/* ---------------- графики ---------------- */
interface Pt {
  t: string
  [k: string]: number | string
}
const fmtT = (t: string, bucket: string) => new Date(t).toLocaleDateString('ru-RU', bucket === 'month' ? { month: 'short' } : { day: 'numeric', month: 'short' }).replace('.', '')

/** Линия с заливкой и подсказкой при наведении */
export function AreaChart({ data, k, k2, bucket, height = 240, fmt = short, label, label2 }: { data: Pt[]; k: string; k2?: string; bucket: string; height?: number; fmt?: (n: number) => string; label: string; label2?: string }) {
  const W = 800
  const H = height
  const pad = { l: 8, r: 8, t: 14, b: 26 }
  const ref = useRef<HTMLDivElement>(null)
  const [hi, setHi] = useState<number | null>(null)
  const vals = data.map((d) => Number(d[k]) || 0)
  const vals2 = k2 ? data.map((d) => Number(d[k2]) || 0) : []
  const max = Math.max(1, ...vals, ...vals2) * 1.12
  const x = (i: number) => pad.l + (data.length <= 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (data.length - 1))
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const path = (vs: number[]) => {
    if (!vs.length) return ''
    let d = `M${x(0)},${y(vs[0])}`
    for (let i = 1; i < vs.length; i++) {
      const cx = (x(i - 1) + x(i)) / 2
      d += ` C${cx},${y(vs[i - 1])} ${cx},${y(vs[i])} ${x(i)},${y(vs[i])}`
    }
    return d
  }
  const line = path(vals)
  const line2 = k2 ? path(vals2) : ''
  const area = line ? `${line} L${x(vals.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z` : ''
  const ticks = Math.min(data.length, 7)
  const step = Math.max(1, Math.round(data.length / ticks))
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    let best = 0
    for (let i = 1; i < data.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    setHi(best)
  }
  const gid = useMemo(() => 'g' + Math.random().toString(36).slice(2, 8), [])
  if (!data.length) return <div className="empty">Нет данных за период</div>
  return (
    <div className="chart" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#8f2434" stopOpacity="0.55" />
            <stop offset="1" stopColor="#8f2434" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} className="grid-l" x1={pad.l} x2={W - pad.r} y1={pad.t + (H - pad.t - pad.b) * (1 - g)} y2={pad.t + (H - pad.t - pad.b) * (1 - g)} vectorEffect="non-scaling-stroke" />
        ))}
        <path className="area" d={area} fill={`url(#${gid})`} />
        {line2 && <path className="area" d={line2} fill="none" stroke="rgba(234,225,215,.45)" strokeWidth="1.6" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />}
        <path className="ln" d={line} fill="none" stroke="#eae1d7" strokeWidth="2.2" vectorEffect="non-scaling-stroke" pathLength={1} style={{ ['--len' as string]: 1 }} />
        {hi != null && (
          <>
            <line className="hover-l" x1={x(hi)} x2={x(hi)} y1={pad.t} y2={H - pad.b} vectorEffect="non-scaling-stroke" />
            <circle cx={x(hi)} cy={y(vals[hi])} r="5" fill="#eae1d7" stroke="#5b0f1f" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        {data.map((d, i) => (i % step === 0 || i === data.length - 1 ? <span key={i} className="axis xs faint" style={{ fontWeight: 600 }}>{fmtT(d.t, bucket)}</span> : null))}
      </div>
      {hi != null && (
        <div className="tooltip" style={{ left: `${(x(hi) / W) * 100}%`, top: (y(vals[hi]) / H) * H }}>
          <span>{fmtT(data[hi].t, bucket)}</span>
          <b>{label}: {fmt(vals[hi])}</b>
          {k2 && <span>{label2}: {fmt(vals2[hi])}</span>}
        </div>
      )}
    </div>
  )
}

/** Столбики по периодам */
export function BarChart({ data, k, k2, bucket, height = 200, fmt = nf, label, label2 }: { data: Pt[]; k: string; k2?: string; bucket: string; height?: number; fmt?: (n: number) => string; label: string; label2?: string }) {
  const [hi, setHi] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => Number(d[k]) || 0)) * 1.1
  const W = 800
  const H = height
  const bw = (W / Math.max(1, data.length)) * 0.62
  if (!data.length) return <div className="empty">Нет данных за период</div>
  return (
    <div className="chart" onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        {data.map((d, i) => {
          const v = Number(d[k]) || 0
          const v2 = k2 ? Number(d[k2]) || 0 : 0
          const cx = (i + 0.5) * (W / data.length)
          const h = ((H - 8) * v) / max
          const h2 = ((H - 8) * v2) / max
          return (
            <g key={d.t + i} onMouseEnter={() => setHi(i)}>
              <rect x={cx - W / data.length / 2} y={0} width={W / data.length} height={H} fill="transparent" />
              <rect className="bar" style={{ ['--i' as string]: i }} x={cx - bw / 2} y={H - h} width={bw} height={Math.max(h, 1.5)} rx={Math.min(6, bw / 3)} fill={hi === i ? '#b5475a' : 'rgba(143,36,52,.75)'} />
              {k2 && <rect className="bar" style={{ ['--i' as string]: i }} x={cx - bw / 2} y={H - h2} width={bw} height={Math.max(h2, 0)} rx={Math.min(6, bw / 3)} fill="#eae1d7" opacity={hi === i ? 1 : 0.85} />}
            </g>
          )
        })}
      </svg>
      {hi != null && (
        <div className="tooltip" style={{ left: `${((hi + 0.5) / data.length) * 100}%`, top: H * 0.3 }}>
          <span>{fmtT(data[hi].t, bucket)}</span>
          <b>{label}: {fmt(Number(data[hi][k]) || 0)}</b>
          {k2 && <span>{label2}: {fmt(Number(data[hi][k2]) || 0)}</span>}
        </div>
      )}
    </div>
  )
}

export function Donut({ parts, center, sub }: { parts: { label: string; value: number; color: string }[]; center: ReactNode; sub: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  const R = 58
  const C = 2 * Math.PI * R
  const [on, setOn] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setOn(true))
    return () => cancelAnimationFrame(t)
  }, [])
  let acc = 0
  return (
    <div className="donut">
      <div className="donut__c">
        <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(234,225,215,.06)" strokeWidth="14" />
          {parts.map((p) => {
            const len = (p.value / total) * C
            const el = <circle key={p.label} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth="14" strokeDasharray={`${on ? Math.max(0, len - 2) : 0} ${C}`} strokeDashoffset={-acc} strokeLinecap="butt" />
            acc += len
            return el
          })}
        </svg>
        <div>
          <span>
            <b>{center}</b>
            <small>{sub}</small>
          </span>
        </div>
      </div>
      <ul>
        {parts.map((p) => (
          <li key={p.label}>
            <i style={{ background: p.color }} />
            {p.label}
            <span>{nf(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------------- выдвижная панель и модальное окно ---------------- */
export function Drawer({ open, onClose, title, sub, children, foot, head }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; foot?: ReactNode; head?: ReactNode }) {
  const [shown, setShown] = useState(open)
  const [out, setOut] = useState(false)
  useEffect(() => {
    if (open) {
      setShown(true)
      setOut(false)
    } else if (shown) {
      setOut(true)
      const t = setTimeout(() => setShown(false), 330)
      return () => clearTimeout(t)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [open, onClose])
  if (!shown) return null
  return (
    <>
      <div className={`scrim ${out ? 'out' : ''}`} onClick={onClose} />
      <aside className={`drawer ${out ? 'out' : ''}`} role="dialog" aria-modal="true">
        <div className="drawer__head">
          {head}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть">
            <Ico.x />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
        {foot && <div className="drawer__foot">{foot}</div>}
      </aside>
    </>
  )
}

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  )
}

/** Окно подтверждения с необязательным полем комментария */
export function Confirm({ title, text, okText, danger, input, required, onOk, onClose }: { title: string; text?: string; okText: string; danger?: boolean; input?: string; required?: boolean; onOk: (v: string) => Promise<void> | void; onClose: () => void }) {
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal onClose={onClose}>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {input && <textarea className="input" placeholder={input} value={v} onChange={(e) => setV(e.target.value)} autoFocus maxLength={300} />}
      <div className="row">
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button
          className={`btn ${danger ? 'danger' : 'primary'}`}
          disabled={busy || (required && !v.trim())}
          onClick={async () => {
            setBusy(true)
            try {
              await onOk(v.trim())
              onClose()
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <span className="spinner" /> : okText}
        </button>
      </div>
    </Modal>
  )
}

/* ---------------- уведомления внутри панели ---------------- */
interface Toast {
  id: number
  title: string
  text?: string
  kind?: 'good' | 'bad' | 'warn' | 'info'
  onClick?: () => void
  out?: boolean
}
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([])
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setList((l) => [...l.slice(-3), { ...t, id }])
    setTimeout(() => setList((l) => l.map((x) => (x.id === id ? { ...x, out: true } : x))), 5200)
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 5550)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.out ? 'out' : ''} ${t.onClick ? 'click' : ''}`} onClick={t.onClick}>
            <div className={`toast__ico ${t.kind ?? 'info'}`}>{t.kind === 'bad' ? <Ico.alert /> : t.kind === 'good' ? <Ico.check /> : <Ico.bell />}</div>
            <div>
              <b>{t.title}</b>
              {t.text && <small>{t.text}</small>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function Skel({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r }} />
}

/* ---------------- иконки (линейные, 20px) ---------------- */
const S = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)
export const Ico = {
  home: () => <S><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-6h4v6" /></S>,
  swap: () => <S><path d="M7 4 3 8l4 4" /><path d="M3 8h14" /><path d="m17 20 4-4-4-4" /><path d="M21 16H7" /></S>,
  users: () => <S><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14.7c1.9.7 3.1 2.5 3.5 5.3" /></S>,
  id: () => <S><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="9" cy="11" r="2.2" /><path d="M5.8 16c.6-1.5 1.8-2.3 3.2-2.3s2.6.8 3.2 2.3" /><path d="M15 10h3.5M15 13.5h3.5" /></S>,
  coins: () => <S><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M3 12v5c0 1.7 2.7 3 6 3 1.4 0 2.7-.2 3.7-.6" /><path d="M15 12.5c3.3 0 6 1.3 6 3v2.5c0 1.7-2.7 3-6 3" /></S>,
  team: () => <S><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></S>,
  log: () => <S><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 13h8M8 17h5" /></S>,
  bell: () => <S><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></S>,
  bellOff: () => <S><path d="M8.7 3.6A6 6 0 0 1 18 8c0 2.6.4 4.6 1 6" /><path d="M17 17H3s3-2 3-9c0-.5 0-1 .2-1.5" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /><path d="m2 2 20 20" /></S>,
  search: () => <S size={17}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></S>,
  x: () => <S size={18}><path d="M18 6 6 18M6 6l12 12" /></S>,
  check: () => <S><path d="m5 12.5 4.5 4.5L19 7.5" /></S>,
  alert: () => <S><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></S>,
  logout: () => <S size={18}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></S>,
  down: () => <S size={17}><path d="M12 4v12" /><path d="m6 11 6 6 6-6" /><path d="M4 20h16" /></S>,
  wallet: () => <S><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /><path d="M21 9h-5a3 3 0 0 0 0 6h5z" /></S>,
  trend: () => <S><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></S>,
  clock: () => <S><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>,
  gift: () => <S><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M19 12v9H5v-9" /><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" /></S>,
  user: () => <S><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></S>,
  link: () => <S size={17}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></S>,
  copy: () => <S size={16}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></S>,
  plus: () => <S size={17}><path d="M12 5v14M5 12h14" /></S>,
  refresh: () => <S size={17}><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" /><path d="M21 3v5h-5" /></S>,
  inbox: () => <S size={30}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" /></S>,
}
