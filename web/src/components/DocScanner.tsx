import { useEffect, useRef, useState } from 'react'
import { compressFile, cssToVideoRect, grab, openCamera, quality, resetQuality, stopStream, type Rect } from '../lib/camera'
import { haptic } from '../lib/tg'
import { IClose, ICamera } from './Icons'

/** Сканер документа: рамка по формату документа, проверка яркости и резкости, автоснимок */
export function DocScanner({
  title,
  hint,
  aspect,
  onDone,
  onClose,
}: {
  title: string
  hint: string
  aspect: number
  onDone: (dataUrl: string) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [err, setErr] = useState(false)
  const [status, setStatus] = useState<{ t: string; ok: boolean }>({ t: 'Запускаем камеру…', ok: false })
  const [shot, setShot] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)
  const goodRef = useRef(0)

  useEffect(() => {
    let s: MediaStream | null = null
    let alive = true
    openCamera('environment')
      .then((st) => {
        if (!alive) return stopStream(st)
        s = st
        setStream(st)
      })
      .catch(() => setErr(true))
    return () => {
      alive = false
      stopStream(s)
    }
  }, [])

  useEffect(() => {
    const v = video.current
    if (!v || !stream) return
    v.srcObject = stream
    v.play().catch(() => {})
  }, [stream])

  const frameRect = (): Rect | null => {
    const v = video.current
    const f = frame.current
    const w = wrap.current
    if (!v || !f || !w || !v.videoWidth) return null
    const fr = f.getBoundingClientRect()
    const wr = v.getBoundingClientRect()
    void w
    return cssToVideoRect(v, { x: fr.left - wr.left, y: fr.top - wr.top, w: fr.width, h: fr.height })
  }

  const capture = () => {
    const v = video.current
    const r = frameRect()
    if (!v || !r) return
    // небольшой запас вокруг рамки
    const m = 0.04
    const rr = { x: Math.max(0, r.x - r.w * m), y: Math.max(0, r.y - r.h * m), w: r.w * (1 + 2 * m), h: r.h * (1 + 2 * m) }
    rr.w = Math.min(rr.w, v.videoWidth - rr.x)
    rr.h = Math.min(rr.h, v.videoHeight - rr.y)
    haptic('medium')
    setFlash(true)
    setTimeout(() => setFlash(false), 280)
    setShot(grab(v, rr))
  }

  // Проверка качества кадра 4 раза в секунду
  useEffect(() => {
    if (!stream || shot) return
    resetQuality()
    goodRef.current = 0
    const t = setInterval(() => {
      const v = video.current
      const r = frameRect()
      if (!v || !r || v.readyState < 2) return
      const q = quality(v, r)
      let msg = { t: 'Держите телефон ровно, документ целиком в рамке', ok: false }
      if (q.brightness < 55) msg = { t: 'Слишком темно. Добавьте света', ok: false }
      else if (q.brightness > 225) msg = { t: 'Слишком ярко. Уберите блики', ok: false }
      else if (q.motion > 9) msg = { t: 'Не двигайте телефон', ok: false }
      else if (q.sharpness < 45) msg = { t: 'Нечётко. Поднесите ближе или протрите камеру', ok: false }
      else msg = { t: 'Отлично, держите так…', ok: true }
      setStatus(msg)
      goodRef.current = msg.ok ? goodRef.current + 1 : 0
      if (goodRef.current >= 5) capture()
    }, 250)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, shot])

  return (
    <div className="scanner" ref={wrap}>
      <div className="scanner-top">
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
          <IClose />
        </button>
        <div className="grow" style={{ textAlign: 'center', fontWeight: 600 }}>{title}</div>
        <div style={{ width: 40 }} />
      </div>

      {shot ? (
        <div className="scanner-body">
          <img src={shot} className="scan-preview pop-in" alt="" />
          <div className="scanner-hint ok">Проверьте, что все данные читаются и нет бликов</div>
          <div className="scanner-actions">
            <button className="btn btn-ghost" onClick={() => setShot(null)}>Переснять</button>
            <button className="btn btn-primary" onClick={() => onDone(shot)}>Готово</button>
          </div>
        </div>
      ) : err ? (
        <div className="scanner-body" style={{ justifyContent: 'center', textAlign: 'center', padding: 24 }}>
          <ICamera size={44} className="muted" />
          <p className="muted">Нет доступа к камере. Разрешите доступ в настройках или загрузите фото документа.</p>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            Загрузить фото
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) setShot(await compressFile(f))
              }}
            />
          </label>
        </div>
      ) : (
        <div className="scanner-body">
          <video ref={video} className="scanner-video" playsInline muted autoPlay />
          <div className="doc-frame-wrap">
            <div ref={frame} className={`doc-frame ${status.ok ? 'ok' : ''}`} style={{ aspectRatio: String(aspect) }}>
              <i className="c tl" />
              <i className="c tr" />
              <i className="c bl" />
              <i className="c br" />
              <div className="scan-line" />
            </div>
          </div>
          <div className="scanner-sub">{hint}</div>
          <div className={`scanner-hint ${status.ok ? 'ok' : ''}`}>{status.t}</div>
          <div className="scanner-actions single">
            <button className="shutter" onClick={capture} aria-label="Сделать снимок" />
          </div>
        </div>
      )}
      {flash && <div className="flash" />}
    </div>
  )
}
