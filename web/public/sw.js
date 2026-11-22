// Простой service worker: кэшируем оболочку приложения, данные всегда берём из сети
const CACHE = 'nex-v3'
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/logo-light.svg', '/icon-192.png'])))
  self.skipWaiting()
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))))
  self.clients.claim()
})
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/admin')) return
  // HTML: сначала сеть, при офлайне кэш. Статика: кэш, затем сеть.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')))
    return
  }
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && url.pathname.startsWith('/assets/')) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy))
          }
          return res
        }),
    ),
  )
})

// Push-уведомления: статус заявки, верификация, бонусы, курс
self.addEventListener('push', (e) => {
  let m = {}
  try {
    m = e.data ? e.data.json() : {}
  } catch {
    m = { title: 'NEX', body: e.data ? e.data.text() : '' }
  }
  e.waitUntil(
    self.registration.showNotification(m.title || 'NEX', {
      body: m.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: m.tag || undefined,
      data: { url: m.url || '/' },
    }),
  )
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = new URL((e.notification.data && e.notification.data.url) || '/', location.origin)
  if (target.origin !== location.origin) return
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === location.origin && 'focus' in c) {
          c.postMessage({ type: 'open', url: target.pathname + target.search })
          return c.focus()
        }
      }
      return self.clients.openWindow(target.href)
    }),
  )
})
