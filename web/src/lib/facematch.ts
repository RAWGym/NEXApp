/* Сравнение лица со сканирования с фото в документе. Нейросеть работает на устройстве, модели на нашем сайте. */
/* eslint-disable @typescript-eslint/no-explicit-any */
let apiP: Promise<any> | null = null
export function preloadFace() {
  if (!apiP) {
    apiP = (async () => {
      const fa: any = await import('@vladmandic/face-api')
      await fa.tf.ready()
      await Promise.all([
        fa.nets.tinyFaceDetector.loadFromUri('/fa'),
        fa.nets.faceLandmark68TinyNet.loadFromUri('/fa'),
        fa.nets.faceRecognitionNet.loadFromUri('/fa'),
      ])
      return fa
    })()
    apiP.catch(() => (apiP = null))
  }
  return apiP
}

function load(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = rej
    i.src = src
  })
}

async function describe(fa: any, img: HTMLImageElement) {
  for (const size of [416, 608, 320]) {
    const r = await fa
      .detectSingleFace(img, new fa.TinyFaceDetectorOptions({ inputSize: size, scoreThreshold: 0.35 }))
      .withFaceLandmarks(true)
      .withFaceDescriptor()
    if (r) return r
  }
  return null
}

function crop(img: HTMLImageElement, box: { x: number; y: number; width: number; height: number }) {
  const m = 0.45
  const x = Math.max(0, box.x - box.width * m)
  const y = Math.max(0, box.y - box.height * m)
  const w = Math.min(img.width - x, box.width * (1 + 2 * m))
  const h = Math.min(img.height - y, box.height * (1 + 2 * m))
  const c = document.createElement('canvas')
  c.width = Math.round(w)
  c.height = Math.round(h)
  c.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.9)
}

export interface FaceMatch {
  score: number // 0..1, чем больше, тем похожее
  passed: boolean
  docFace?: string // вырезанное фото из документа для оператора
}

/** Сравнивает лицо со сканирования и фото в документе. null, если лицо в документе не найдено. */
export async function matchFaces(selfie: string, doc: string): Promise<FaceMatch | null> {
  const fa = await preloadFace()
  const [a, b] = await Promise.all([load(selfie), load(doc)])
  const [da, db] = [await describe(fa, a), await describe(fa, b)]
  if (!da || !db) return null
  const dist = fa.euclideanDistance(da.descriptor, db.descriptor) as number
  // Расстояние 0.6 и меньше обычно означает одного человека; фото в документе старше и хуже, поэтому порог мягче
  const score = Math.max(0, Math.min(1, 1 - dist / 1.1))
  return { score, passed: dist < 0.62, docFace: crop(b, db.detection.box) }
}
