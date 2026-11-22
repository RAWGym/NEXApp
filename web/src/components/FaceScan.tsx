import { useEffect, useRef, useState } from 'react'
import { grab, openCamera, stopStream } from '../lib/camera'
import { haptic } from '../lib/tg'
import { IClose, ICamera } from './Icons'
import { Spinner } from './ui'

type Step = 'center' | 'left' | 'right' | 'blink' | 'final'
const STEP_TEXT: Record<Step, string> = {
  center: 'Поместите лицо в овал и смотрите прямо',
  left: 'Медленно поверните голову влево',
  right: 'Медленно поверните голову вправо',
  blink: 'Моргните',
  final: 'Смотрите прямо в камеру',
}
export interface FaceResult {
  image: string
  liveness: { passed: boolean; steps: string[]; method: string }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let landmarkerPromise: Promise<any> | null = null
function loadLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks('/mp')
      const opts = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: '/mp/face_landmarker.task', delegate },
        runningMode: 'VIDEO' as const,
        numFaces: 2,
        outputFaceBlendshapes: true,
      })
      try {
        return await FaceLandmarker.createFromOptions(fileset, opts('GPU'))
      } catch {
        return await FaceLandmarker.createFromOptions(fileset, opts('CPU'))
      }
    })()
    landmarkerPromise.catch(() => (landmarkerPromise = null))
  }
  return landmarkerPromise
}

/**
 * Сканирование лица с проверкой «живого» человека: распознавание выполняется на устройстве,
 * пользователь выполняет случайную последовательность действий, затем делается фронтальный снимок.
 */
export function FaceScan({ onDone, onClose }: { onDone: (r: FaceResult) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [camErr, setCamErr] = useState(false)
  const [modelState, setModelState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [steps] = useState<Step[]>(() => ['center', ...(Math.random() < 0.5 ? (['left', 'right'] as Step[]) : (['right', 'left'] as Step[])), 'blink', 'final'])
  const [idx, setIdx] = useState(0)
  const [hint, setHint] = useState('')
  const [result, setResult] = useState<FaceResult | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const state = useRef({ idx: 0, hold: 0, blinkClosed: false, done: false })

  useEffect(() => {
    let s: MediaStream | null = null
    let alive = true
    openCamera('user')
      .then((st) => {
        if (!alive) return stopStream(st)
        s = st
        setStream(st)
      })
      .catch(() => setCamErr(true))
    loadLandmarker()
      .then(() => alive && setModelState('ready'))
      .catch(() => alive && setModelState('failed'))
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
  }, [stream, result])

  const finish = (passed: boolean, method: string) => {
    const v = video.current!
    // квадрат по центру кадра с лицом
    const side = Math.min(v.videoWidth, v.videoHeight) * 0.9
    const img = grab(v, { x: (v.videoWidth - side) / 2, y: (v.videoHeight - side) / 2, w: side, h: side }, 900, 0.9)
    haptic('success')
    setResult({ image: img, liveness: { passed, steps: passed ? steps.filter((s) => s !== 'final') : [], method } })
  }

  // Основной цикл распознавания
  useEffect(() => {
    if (!stream || modelState !== 'ready' || result || timedOut) return
    let raf = 0
    let last = 0
    let lm: any = null
    state.current = { idx: 0, hold: 0, blinkClosed: false, done: false }
    setIdx(0)
    const started = performance.now()
    loadLandmarker().then((l) => (lm = l))

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      const v = video.current
      if (!lm || !v || v.readyState < 2 || t - last < 66) return
      last = t
      if (t - started > 60_000) {
        setTimedOut(true)
        return
      }
      let res: any
      try {
        res = lm.detectForVideo(v, t)
      } catch {
        return
      }
      const faces = res.faceLandmarks ?? []
      if (faces.length === 0) return setHint('Лицо не найдено. Поднесите телефон ближе')
      if (faces.length > 1) return setHint('В кадре должно быть только одно лицо')
      const pts = faces[0] as { x: number; y: number }[]
      let minX = 1, maxX = 0, minY = 1, maxY = 0
      for (const p of pts) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      const w = maxX - minX
      // положение носа между щеками: 0.5 = прямо; в зеркальном отображении поворот влево уменьшает значение
      const yaw = 1 - (pts[1].x - pts[234].x) / (pts[454].x - pts[234].x || 1)
      const bs: Record<string, number> = {}
      for (const c of res.faceBlendshapes?.[0]?.categories ?? []) bs[c.categoryName] = c.score
      const blink = Math.min(bs.eyeBlinkLeft ?? 0, bs.eyeBlinkRight ?? 0)
      const centered = Math.abs(cx - 0.5) < 0.13 && Math.abs(cy - 0.47) < 0.15
      const sized = w > 0.28 && w < 0.8

      const st = state.current
      const step = steps[st.idx]
      let ok = false
      if (step === 'center' || step === 'final') {
        if (!sized) setHint(w <= 0.28 ? 'Поднесите телефон ближе' : 'Отодвиньте телефон немного дальше')
        else if (!centered) setHint('Поместите лицо в центр овала')
        else if (Math.abs(yaw - 0.5) > 0.12) setHint('Смотрите прямо в камеру')
        else if (step === 'final' && blink > 0.4) setHint('Откройте глаза')
        else {
          setHint('Держите так…')
          ok = true
        }
      } else if (step === 'left') {
        ok = yaw < 0.3
        setHint(ok ? 'Отлично' : STEP_TEXT.left)
      } else if (step === 'right') {
        ok = yaw > 0.7
        setHint(ok ? 'Отлично' : STEP_TEXT.right)
      } else if (step === 'blink') {
        if (blink > 0.5) st.blinkClosed = true
        ok = st.blinkClosed && blink < 0.25
        setHint(ok ? 'Отлично' : STEP_TEXT.blink)
      }
      st.hold = ok ? st.hold + 1 : 0
      const need = step === 'center' || step === 'final' ? 6 : 2
      if (st.hold >= need) {
        st.hold = 0
        haptic('light')
        if (step === 'final') {
          st.done = true
          cancelAnimationFrame(raf)
          finish(true, 'mediapipe')
          return
        }
        st.idx++
        setIdx(st.idx)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, modelState, result, timedOut, attempt])

  const progress = result ? 1 : idx / steps.length
  const step = steps[Math.min(idx, steps.length - 1)]
  const R = 47
  const C = 2 * Math.PI * R

  return (
    <div className="scanner">
      <div className="scanner-top">
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
          <IClose />
        </button>
        <div className="grow" style={{ textAlign: 'center', fontWeight: 600 }}>Сканирование лица</div>
        <div style={{ width: 40 }} />
      </div>

      {camErr ? (
        <div className="scanner-body" style={{ justifyContent: 'center', textAlign: 'center', padding: 24 }}>
          <ICamera size={44} className="muted" />
          <p className="muted">
            Нет доступа к фронтальной камере. Разрешите доступ к камере для Telegram или браузера в настройках телефона и попробуйте снова.
          </p>
          <button className="btn btn-primary" onClick={onClose}>Понятно</button>
        </div>
      ) : result ? (
        <div className="scanner-body" style={{ alignItems: 'center' }}>
          <div className="face-result pop-in">
            <img src={result.image} alt="" />
          </div>
          <div className="scanner-hint ok">{result.liveness.passed ? 'Проверка пройдена' : 'Снимок сделан'}</div>
          <div className="scanner-actions">
            <button className="btn btn-ghost" onClick={() => (setResult(null), setTimedOut(false), setAttempt((a) => a + 1))}>Повторить</button>
            <button className="btn btn-primary" onClick={() => onDone(result)}>Готово</button>
          </div>
        </div>
      ) : (
        <div className="scanner-body" style={{ alignItems: 'center' }}>
          <div className="face-stage">
            <video ref={video} className="face-video" playsInline muted autoPlay />
            <svg className="face-ring" viewBox="0 0 100 100" aria-hidden>
              <circle cx="50" cy="50" r={R} className="track" />
              <circle cx="50" cy="50" r={R} className="bar" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
            </svg>
          </div>
          <div className="face-steps">
            {steps.map((_, i) => (
              <span key={i} className={i < idx ? 'done' : i === idx ? 'cur' : ''} />
            ))}
          </div>
          {modelState === 'loading' ? (
            <div className="scanner-hint row" style={{ justifyContent: 'center' }}>
              <Spinner /> Загружаем модуль распознавания…
            </div>
          ) : modelState === 'failed' ? (
            <>
              <div className="scanner-hint">Ваше устройство не поддерживает автоматическую проверку. Смотрите прямо в камеру и нажмите кнопку.</div>
              <div className="scanner-actions single">
                <button className="shutter" onClick={() => finish(false, 'photo')} aria-label="Сделать снимок" />
              </div>
            </>
          ) : timedOut ? (
            <>
              <div className="scanner-hint">Не получилось распознать. Проверьте освещение и попробуйте ещё раз.</div>
              <div className="scanner-actions single">
                <button className="btn btn-primary" onClick={() => (setTimedOut(false), setAttempt((a) => a + 1))}>Попробовать снова</button>
              </div>
            </>
          ) : (
            <>
              <div className="face-step-title" key={step}>{STEP_TEXT[step]}</div>
              <div className="scanner-hint">{hint || ' '}</div>
            </>
          )}
          <div className="xs faint" style={{ textAlign: 'center', padding: '0 24px', marginTop: 'auto', marginBottom: 'calc(var(--safe-bottom) + 18px)' }}>
            Распознавание выполняется на вашем устройстве. На сервер передаётся только итоговый снимок в зашифрованном виде.
          </div>
        </div>
      )}
    </div>
  )
}
