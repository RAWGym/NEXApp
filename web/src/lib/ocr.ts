/* Распознавание машиночитаемой зоны документа прямо на устройстве (Tesseract, файлы хранятся на нашем сайте) */
import { extractLines, parseMrz, type MrzResult } from './mrz'

/* eslint-disable @typescript-eslint/no-explicit-any */
let workerP: Promise<any> | null = null
export function preloadOcr() {
  if (!workerP) {
    workerP = (async () => {
      const T = await import('tesseract.js')
      const w = await T.createWorker('eng', 1, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr',
        langPath: '/ocr',
        workerBlobURL: false,
      })
      await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '0' })
      return w
    })()
    workerP.catch(() => (workerP = null))
  }
  return workerP
}

function load(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = rej
    i.src = src
  })
}

/** Подготовка части изображения: оттенки серого, контраст, увеличение мелкого текста */
function prep(img: HTMLImageElement, fromY: number, threshold: boolean) {
  const sy = Math.round(img.height * fromY)
  const sh = img.height - sy
  const scale = Math.min(2, Math.max(1, 1800 / img.width))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale)
  c.height = Math.round(sh * scale)
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.drawImage(img, 0, sy, img.width, sh, 0, 0, c.width, c.height)
  const d = x.getImageData(0, 0, c.width, c.height)
  const p = d.data
  let min = 255, max = 0
  for (let i = 0; i < p.length; i += 4) {
    const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]
    p[i] = g
    if (g < min) min = g
    if (g > max) max = g
  }
  const k = 255 / Math.max(1, max - min)
  for (let i = 0; i < p.length; i += 4) {
    let g = (p[i] - min) * k
    if (threshold) g = g < 120 ? 0 : 255
    p[i] = p[i + 1] = p[i + 2] = g
  }
  x.putImageData(d, 0, 0)
  return c
}

/** Возвращает данные MRZ или null, если строки не распознаны */
export async function readMrz(dataUrl: string): Promise<MrzResult | null> {
  const w = await preloadOcr()
  const img = await load(dataUrl)
  let best: MrzResult | null = null
  // Сначала нижняя часть (там MRZ), затем с бинаризацией, затем весь документ
  for (const [fromY, th] of [[0.5, false], [0.45, true], [0.3, false], [0, false]] as [number, boolean][]) {
    const { data } = await w.recognize(prep(img, fromY, th))
    const lines = extractLines(data.text)
    const r = lines && parseMrz(lines)
    if (r?.valid) return r
    if (r && !best) best = r
  }
  return best
}
