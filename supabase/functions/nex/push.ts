// Web Push (RFC 8291 + VAPID RFC 8292) на WebCrypto, без внешних библиотек.
// Ключ VAPID создаётся один раз и хранится в kv (таблица закрыта RLS).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'

const enc = new TextEncoder()
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))
const concat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0))
  let o = 0
  for (const x of a) {
    out.set(x, o)
    o += x.length
  }
  return out
}

let vapid: { pub: string; key: CryptoKey } | null = null
export async function vapidKey(db: SupabaseClient) {
  if (vapid) return vapid
  const { data } = await db.from('kv').select('value').eq('key', 'vapid').maybeSingle()
  let jwk = data?.value as JsonWebKey | undefined
  if (!jwk?.d) {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
    // Если ключ уже успели создать параллельно, используем существующий
    await db.from('kv').insert({ key: 'vapid', value: jwk })
    const { data: again } = await db.from('kv').select('value').eq('key', 'vapid').single()
    jwk = again!.value as JsonWebKey
  }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const pub = b64u(concat(new Uint8Array([4]), unb64u(jwk.x!), unb64u(jwk.y!)))
  vapid = { pub, key }
  return vapid
}

async function vapidAuth(db: SupabaseClient, endpoint: string, subject: string) {
  const v = await vapidKey(db)
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, enc.encode(`${head}.${body}`)))
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.pub}`
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, k, len * 8))
}

/** Шифрование сообщения для конкретной подписки (aes128gcm) */
async function encrypt(payload: Uint8Array, p256dh: string, auth: string) {
  const uaPub = unb64u(p256dh)
  const authSecret = unb64u(auth)
  const as = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPub as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256))
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, concat(payload, new Uint8Array([2])) as BufferSource))
  const rs = new Uint8Array([0, 0, 0x10, 0])
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct)
}

export interface PushMsg {
  title: string
  body: string
  url?: string
  tag?: string
}

/** Отправка всем устройствам пользователя. Недействительные подписки удаляются. */
export async function pushToUser(db: SupabaseClient, uid: number, msg: PushMsg, subject: string) {
  const { data: subs } = await db.from('push_subs').select('*').eq('user_id', uid).limit(10)
  if (!subs?.length) return 0
  const payload = enc.encode(JSON.stringify(msg))
  let sent = 0
  for (const s of subs as any[]) {
    try {
      const r = await fetch(s.endpoint, {
        method: 'POST',
        headers: {
          Authorization: await vapidAuth(db, s.endpoint, subject),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '86400',
          Urgency: 'high',
          ...(msg.tag ? { Topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
        },
        body: (await encrypt(payload, s.p256dh, s.auth)) as BodyInit,
      })
      if (r.status === 404 || r.status === 410) await db.from('push_subs').delete().eq('id', s.id)
      else if (r.ok) {
        sent++
        await db.from('push_subs').update({ last_ok_at: new Date().toISOString() }).eq('id', s.id)
      } else console.error('push', r.status, await r.text().catch(() => ''))
    } catch (e) {
      console.error('push', e)
    }
  }
  return sent
}

/** Разрешены только адреса известных push-сервисов: защита от запросов на произвольные адреса */
export function pushEndpointOk(endpoint: string) {
  try {
    const u = new URL(endpoint)
    return (
      u.protocol === 'https:' &&
      /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.api\.chat\.yandex\.net)$/.test(u.hostname)
    )
  } catch {
    return false
  }
}
