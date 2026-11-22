import { useMemo, useRef, useState } from 'react'
import { fmtRate } from '../lib/format'

export function Sparkline({ data, w = 72, h = 28 }: { data?: number[]; w?: number; h?: number }) {
  if (!data || data.length < 2) return <div style={{ width: w, height: h }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const up = data[data.length - 1] >= data[0]
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / (max - min || 1)) * (h - 4)}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke={up ? 'var(--green)' : 'var(--red)'} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

/** Интерактивный график: проведите пальцем, чтобы увидеть цену в точке */
export function LineChart({ data, height = 200, prefix = '$' }: { data: [number, number][]; height?: number; prefix?: string }) {
  const ref = useRef<SVGSVGElement>(null)
  const [idx, setIdx] = useState<number | null>(null)
  const W = 340
  const H = height
  const { pts, min, max, path, area } = useMemo(() => {
    const vals = data.map((d) => d[1])
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pts = data.map((d, i) => [(i / Math.max(1, data.length - 1)) * W, 12 + (1 - (d[1] - min) / (max - min || 1)) * (H - 24)] as const)
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')
    return { pts, min, max, path, area: `${path}L${W},${H}L0,${H}Z` }
  }, [data, H])
  if (data.length < 2) return null
  const up = data[data.length - 1][1] >= data[0][1]
  const color = up ? '#6cc58f' : '#e5677a'

  const onMove = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    const x = ((clientX - r.left) / r.width) * W
    setIdx(Math.max(0, Math.min(data.length - 1, Math.round((x / W) * (data.length - 1)))))
  }
  const sel = idx != null ? data[idx] : null
  const sp = idx != null ? pts[idx] : null

  return (
    <div style={{ position: 'relative' }}>
      <div className="row between xs faint" style={{ marginBottom: 6, minHeight: 18 }}>
        {sel ? (
          <>
            <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>
              {prefix}
              {fmtRate(sel[1])}
            </span>
            <span>{new Date(sel[0]).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          </>
        ) : (
          <>
            <span>макс. {prefix}{fmtRate(max)}</span>
            <span>мин. {prefix}{fmtRate(min)}</span>
          </>
        )}
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        style={{ touchAction: 'pan-y', display: 'block' }}
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setIdx(null)}
        onPointerUp={() => setIdx(null)}
      >
        <defs>
          <linearGradient id="lc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#lc)" />
        <path d={path} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {sp && (
          <>
            <line x1={sp[0]} x2={sp[0]} y1={0} y2={H} stroke="rgba(234,225,215,0.25)" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
            <circle cx={sp[0]} cy={sp[1]} r="4" fill={color} stroke="#13070a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
    </div>
  )
}
