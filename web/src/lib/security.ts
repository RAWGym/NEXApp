// Уведомления на телефон, вход по Face ID / Touch ID и код-пароль приложения.
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { api } from './api'
import { inTelegram, isStandalone } from './tg'
import { DEMO } from '../config'

const ls = {
  get(k: string) {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v == null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      /* приватный режим */
    }
  },
}
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)

/* ---------------- push ---------------- */
export type PushState = 'unsupported' | 'need-install' | 'denied' | 'off' | 'on'

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}
export async function pushState(): Promise<PushState> {
  if (inTelegram) return 'unsupported' // в Telegram уведомления приходят от бота
  // На iPhone push работает только в приложении, добавленном на экран «Домой»
  if (isIOS && !isStandalone) return 'need-install'
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'off'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}
function keyBytes(b64u: string) {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}
/** Включить уведомления. Вызывать только по нажатию кнопки: так требует iOS. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off'
  if (DEMO) return 'on'
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'))
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await api.pushKey()) as BufferSource })
  await api.pushSubscribe(sub.toJSON())
  return 'on'
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {})
    await sub.unsubscribe()
  }
}
/** Подписка обновляется при каждом входе: браузер иногда меняет её сам */
export async function syncPush() {
  try {
    if ((await pushState()) !== 'on') return
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) await api.pushSubscribe(sub.toJSON())
  } catch {
    /* не критично */
  }
}
const PROMPT_KEY = 'nex.pushAsked'
/** Показывать ли предложение включить уведомления: не чаще раза в 7 дней */
export async function shouldAskPush() {
  const st = await pushState()
  if (st !== 'off') return false
  const t = Number(ls.get(PROMPT_KEY) || 0)
  return Date.now() - t > 7 * 86400_000
}
export const markPushAsked = () => ls.set(PROMPT_KEY, String(Date.now()))

/* ---------------- Face ID / Touch ID ---------------- */
const isMac = /Macintosh/.test(navigator.userAgent) && !isIOS
/** Название биометрии на этом устройстве и форма «с Face ID» / «по биометрии» */
export const bioName = isIOS ? 'Face ID' : isMac ? 'Touch ID' : 'Биометрия'
export const bioWith = isIOS || isMac ? `с ${bioName}` : 'по биометрии'
export async function bioAvailable() {
  if (inTelegram || !browserSupportsWebAuthn()) return false
  try {
    return await platformAuthenticatorIsAvailable()
  } catch {
    return false
  }
}
const BIO_KEY = 'nex.bio'
export const bioEnabled = () => ls.get(BIO_KEY) === '1'
export async function enableBio() {
  if (DEMO) {
    ls.set(BIO_KEY, '1')
    return
  }
  const { cid, options } = await api.passkeyRegisterOptions()
  const resp = await startRegistration({ optionsJSON: options })
  await api.passkeyRegisterVerify(cid, resp, deviceName())
  ls.set(BIO_KEY, '1')
}
export async function disableBio() {
  ls.set(BIO_KEY, null)
  const list = await api.passkeys().catch(() => [])
  for (const p of list) await api.deletePasskey(p.id).catch(() => {})
}
/** Вход и разблокировка по Face ID: сервер проверяет подпись и выдаёт новую сессию */
export async function bioLogin() {
  if (DEMO) return
  const { cid, options } = await api.passkeyLoginOptions()
  const resp = await startAuthentication({ optionsJSON: options })
  await api.passkeyLoginVerify(cid, resp)
  ls.set(BIO_KEY, '1')
}
function deviceName() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  return 'Устройство'
}

/* ---------------- код-пароль ---------------- */
// Код хранится только на этом устройстве в виде хеша PBKDF2. Это замок приложения,
// а не пароль аккаунта: после 5 ошибок сессия на устройстве завершается.
const PIN_KEY = 'nex.pin'
const PIN_FAILS = 'nex.pinFails'
export const pinEnabled = () => !!ls.get(PIN_KEY)
async function pinHash(pin: string, salt: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 150_000 }, k, 256)
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
export async function setPin(pin: string) {
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('')
  ls.set(PIN_KEY, JSON.stringify({ salt, hash: await pinHash(pin, salt) }))
  ls.set(PIN_FAILS, null)
}
export const clearPin = () => (ls.set(PIN_KEY, null), ls.set(PIN_FAILS, null))
export const PIN_MAX_FAILS = 5
export async function checkPin(pin: string): Promise<{ ok: boolean; left: number }> {
  const v = JSON.parse(ls.get(PIN_KEY) || 'null')
  if (!v) return { ok: true, left: PIN_MAX_FAILS }
  const ok = (await pinHash(pin, v.salt)) === v.hash
  const fails = ok ? 0 : Number(ls.get(PIN_FAILS) || 0) + 1
  ls.set(PIN_FAILS, ok ? null : String(fails))
  return { ok, left: PIN_MAX_FAILS - fails }
}
export const weakPin = (p: string) => /^(\d)\1+$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p)

/** Нужен ли замок: включён код-пароль или Face ID */
export const lockEnabled = () => pinEnabled() || bioEnabled()
/** Сброс замка при выходе из аккаунта */
export function resetLocal() {
  clearPin()
  ls.set(BIO_KEY, null)
}
