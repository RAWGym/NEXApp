/* Камера: запуск, захват кадра, оценка качества изображения. Всё работает на устройстве. */

export async function openCamera(facing: 'user' | 'environment'): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocamera')
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  })
}

export function stopStream(s: MediaStream | null | undefined) {
  s?.getTracks().forEach((t) => t.stop())
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Перевод прямоугольника из координат контейнера (object-fit: cover) в пиксели видео */
export function cssToVideoRect(video: HTMLVideoElement, r: Rect): Rect {
  const cw = video.clientWidth
  const ch = video.clientHeight
  const vw = video.videoWidth
  const vh = video.videoHeight
  const scale = Math.max(cw / vw, ch / vh)
  const ox = (vw * scale - cw) / 2
  const oy = (vh * scale - ch) / 2
  const x = Math.max(0, (r.x + ox) / scale)
  const y = Math.max(0, (r.y + oy) / scale)
  return { x, y, w: Math.min(vw - x, r.w / scale), h: Math.min(vh - y, r.h / scale) }
}

export function grab(video: HTMLVideoElement, r?: Rect, maxW = 1600, quality = 0.88): string {
  const src = r ?? { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight }
  const scale = Math.min(1, maxW / src.w)
  const c = document.createElement('canvas')
  c.width = Math.round(src.w * scale)
  c.height = Math.round(src.h * scale)
  c.getContext('2d')!.drawImage(video, src.x, src.y, src.w, src.h, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', quality)
}

const qc = document.createElement('canvas')
let prev: Float32Array | null = null

/** Яркость (0..255), резкость (дисперсия лапласиана) и движение между кадрами */
export function quality(video: HTMLVideoElement, r: Rect) {
  const W = 240
  const H = Math.max(1, Math.round((r.h / r.w) * W))
  qc.width = W
  qc.height = H
  const ctx = qc.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  const g = new Float32Array(W * H)
  let sum = 0
  for (let i = 0; i < W * H; i++) {
    const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
    g[i] = v
    sum += v
  }
  const brightness = sum / (W * H)
  let lsum = 0
  let lsq = 0
  let n = 0
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W]
      lsum += l
      lsq += l * l
      n++
    }
  const mean = lsum / n
  const sharpness = lsq / n - mean * mean
  let motion = 0
  if (prev && prev.length === g.length) {
    for (let i = 0; i < g.length; i += 7) motion += Math.abs(g[i] - prev[i])
    motion /= g.length / 7
  } else motion = 99
  prev = g
  return { brightness, sharpness, motion }
}

export function resetQuality() {
  prev = null
}

/** Сжатие выбранного файла (запасной вариант без камеры) */
export async function compressFile(file: File, maxSide = 1600): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = url
    })
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale)
    c.height = Math.round(img.height * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}
