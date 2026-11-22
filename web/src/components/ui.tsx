import { createPortal } from 'react-dom'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { cur } from '../lib/currencies'
import type { OrderStatus } from '../lib/api'

export function Coin({ code, size }: { code: string; size?: 'sm' | 'lg' }) {
  const c = cur(code)
  return (
    <div className={`coin ${size ?? ''}`} style={{ background: `radial-gradient(circle at 30% 25%, ${c.color}, ${shade(c.color)})` }}>
      {c.symbol}
    </div>
  )
}
function shade(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.round(v * 0.55)
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'Ожидает',
  accepted: 'В работе',
  completed: 'Выполнен',
  rejected: 'Отклонён',
  cancelled: 'Отменён',
}
export function StatusBadge({ s }: { s: OrderStatus }) {
  return <span className={`badge ${s}`}>{STATUS_LABEL[s]}</span>
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])
  if (!open) return null
  // Через портал: лист всегда поверх нижней панели, независимо от анимаций экрана
  return createPortal(
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Wave({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="wv" x1="0" x2="1">
          <stop offset="0" stopColor="#EAE1D7" stopOpacity="0" />
          <stop offset="0.6" stopColor="#EAE1D7" stopOpacity="0.5" />
          <stop offset="1" stopColor="#EAE1D7" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="wf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8F2434" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5B0F1F" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 150 C 120 150, 170 60, 260 70 S 360 40, 400 10 L400 200 L0 200Z" fill="url(#wf)" />
      <path d="M0 150 C 120 150, 170 60, 260 70 S 360 40, 400 10" fill="none" stroke="url(#wv)" strokeWidth="1.2" />
    </svg>
  )
}

export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden>
      <svg viewBox="0 0 800 900" preserveAspectRatio="none">
        <defs>
          <radialGradient id="bg1" cx="70%" cy="10%" r="70%">
            <stop offset="0" stopColor="#5B0F1F" stopOpacity="0.85" />
            <stop offset="1" stopColor="#13070A" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="bl" x1="0" x2="1">
            <stop offset="0" stopColor="#8F2434" stopOpacity="0" />
            <stop offset="0.5" stopColor="#C2404F" stopOpacity="0.55" />
            <stop offset="1" stopColor="#8F2434" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="800" height="900" fill="url(#bg1)" />
        <path d="M0 330 C 220 300, 330 120, 520 110 S 760 60, 800 0" fill="none" stroke="url(#bl)" strokeWidth="1.5" />
        <path d="M0 360 C 240 330, 360 160, 540 150 S 770 100, 800 40" fill="none" stroke="url(#bl)" strokeWidth="0.8" opacity="0.6" />
      </svg>
    </div>
  )
}

export function Logo({ height = 22 }: { height?: number }) {
  return <img src="/logo-light.svg" alt="NEX" style={{ height, display: 'block' }} />
}

/** Плавный счётчик чисел */
export function CountUp({ value, format, ms = 900 }: { value: number; format: (v: number) => string; ms?: number }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setV(value)
    let raf = 0
    const start = performance.now()
    const from = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      setV(from + (value - from) * e)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return <>{format(v)}</>
}

export function Spinner() {
  return <div className="spinner" />
}

/* ---------- Тосты ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 2600)
    return () => clearTimeout(t)
  }, [msg])
  return (
    <ToastCtx.Provider value={setMsg}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  )
}

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="topbar">
      <div>{onBack && <BackBtn onBack={onBack} />}</div>
      <h1>{title}</h1>
      <div>{right}</div>
    </div>
  )
}
import { IBack } from './Icons'
import { inTelegram } from '../lib/tg'
function BackBtn({ onBack }: { onBack: () => void }) {
  // В Telegram используется системная кнопка «Назад»
  if (inTelegram) return null
  return (
    <button className="icon-btn" onClick={onBack} aria-label="Назад">
      <IBack />
    </button>
  )
}
