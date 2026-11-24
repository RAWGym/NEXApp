'use strict'
// NEX Admin: оболочка для Windows. Открывает только панель NEX и ничего больше.
// Никакого Node.js на странице: sandbox, contextIsolation, без preload.

const { app, BrowserWindow, Menu, Tray, nativeImage, session, shell, dialog } = require('electron')
const path = require('path')
const { startUpdater } = require('./updater')

const ORIGIN = 'https://nex-app-rho.vercel.app'
const START = ORIGIN + '/admin/'
// Куда страница панели может обращаться (то же, что в её CSP)
const ALLOWED_HOSTS = new Set([
  'nex-app-rho.vercel.app',
  'amgwcbvdgutpvzgcjvjc.supabase.co',
])

let win = null
let tray = null
let quitting = false
let lastCount = 0

app.setAppUserModelId('kz.noirex.admin')
app.enableSandbox()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => show())
  app.whenReady().then(boot)
}

function isPanelUrl(raw) {
  try {
    const u = new URL(raw)
    return u.origin === ORIGIN && (u.pathname === '/admin' || u.pathname.startsWith('/admin/'))
  } catch {
    return false
  }
}

function openOutside(raw) {
  try {
    const u = new URL(raw)
    // Наружу отдаём только обычные веб-ссылки и Telegram
    if (u.protocol === 'https:' || u.protocol === 'tg:') shell.openExternal(u.toString())
  } catch {}
}

function offlinePage() {
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>NEX Admin</title>
<style>html,body{height:100%;margin:0;background:#1C1C1C;color:#EAE1D7;font:15px/1.5 Manrope,Segoe UI,sans-serif;display:grid;place-items:center}
.c{text-align:center;max-width:360px}h1{font-size:20px;margin:0 0 8px}p{opacity:.7;margin:0 0 20px}
a{display:inline-block;padding:12px 22px;border-radius:12px;background:#8F2434;color:#EAE1D7;text-decoration:none;font-weight:600}</style>
<div class="c"><h1>Нет соединения</h1><p>Не удаётся открыть панель. Проверьте интернет и попробуйте снова.</p><a href="${START}">Повторить</a></div></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

function hardenSession() {
  const ses = session.defaultSession

  // Разрешаем только уведомления и только для панели
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const okOrigin = isPanelUrl(details.requestingUrl || wc.getURL())
    cb(okOrigin && (permission === 'notifications' || permission === 'clipboard-sanitized-write'))
  })
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    return requestingOrigin === ORIGIN && (permission === 'notifications' || permission === 'clipboard-sanitized-write')
  })
  ses.setDevicePermissionHandler(() => false)
  if (ses.setDisplayMediaRequestHandler) ses.setDisplayMediaRequestHandler((_req, cb) => cb({}))

  // Второй уровень защиты поверх CSP страницы: только https к своим доменам
  ses.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('devtools:') || url.startsWith('chrome-extension:')) return cb({})
    try {
      const u = new URL(url)
      if ((u.protocol === 'https:' || u.protocol === 'wss:') && ALLOWED_HOSTS.has(u.hostname)) return cb({})
    } catch {}
    cb({ cancel: true })
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'NEX Admin',
    backgroundColor: '#1C1C1C',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false, // чтобы автообновление шло и в свёрнутом окне
      devTools: !app.isPackaged,
    },
  })

  win.once('ready-to-show', () => win.show())

  const wc = win.webContents
  wc.setWindowOpenHandler(({ url }) => {
    if (!isPanelUrl(url)) openOutside(url)
    return { action: 'deny' }
  })
  const guard = (e, url) => {
    if (isPanelUrl(url)) return
    e.preventDefault()
    openOutside(url)
  }
  wc.on('will-navigate', guard)
  wc.on('will-redirect', guard)
  wc.on('will-attach-webview', (e) => e.preventDefault())

  wc.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && isPanelUrl(url)) wc.loadURL(offlinePage())
  })

  // Горячие клавиши: F5 / Ctrl+R обновить, Ctrl +/-/0 масштаб
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const k = input.key.toLowerCase()
    if (k === 'f5' || (input.control && k === 'r')) { wc.reload(); e.preventDefault() }
    else if (input.control && (k === '=' || k === '+')) { wc.setZoomLevel(wc.getZoomLevel() + 0.5); e.preventDefault() }
    else if (input.control && k === '-') { wc.setZoomLevel(wc.getZoomLevel() - 0.5); e.preventDefault() }
    else if (input.control && k === '0') { wc.setZoomLevel(0); e.preventDefault() }
  })

  // Новые заявки: число в заголовке «(3) NEX · ...». Мигаем в панели задач, если окно не в фокусе.
  win.on('page-title-updated', (_e, title) => {
    const m = /^\((\d+)\)/.exec(title)
    const n = m ? Number(m[1]) : 0
    if (n > lastCount && !win.isFocused()) win.flashFrame(true)
    lastCount = n
    if (tray) tray.setToolTip(n ? `NEX Admin: новых заявок ${n}` : 'NEX Admin')
  })
  win.on('focus', () => win.flashFrame(false))

  // Крестик сворачивает в трей, чтобы уведомления продолжали приходить
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
    if (tray && !app.__trayHintShown) {
      app.__trayHintShown = true
      tray.displayBalloon?.({ title: 'NEX Admin работает в фоне', content: 'Уведомления о заявках продолжат приходить. Выход: правый клик по значку.', iconType: 'info' })
    }
  })

  win.loadURL(START)
}

function show() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

let updater = null
let updState = ''

function trayMenu() {
  const upd = updState === 'downloading' ? 'Загружается обновление…' : updState === 'ready' ? 'Установить обновление' : 'Проверить обновления'
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть панель', click: show },
    { label: 'Обновить страницу', click: () => { show(); win.webContents.reload() } },
    { type: 'separator' },
    { label: upd, enabled: updState !== 'downloading' && updState !== 'checking', click: () => updater && updater.check(true) },
    { label: `Версия ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Выйти', click: () => { quitting = true; app.quit() } },
  ]))
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 })
  tray = new Tray(img)
  tray.setToolTip('NEX Admin')
  trayMenu()
  tray.on('click', show)
}

function boot() {
  Menu.setApplicationMenu(null)
  hardenSession()

  // Любые новые webContents получают те же ограничения
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (ev) => ev.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      if (!isPanelUrl(url)) openOutside(url)
      return { action: 'deny' }
    })
  })

  // Сертификаты проверяет Chromium; ошибки никогда не пропускаем
  app.on('certificate-error', (e, _wc, _url, _err, _cert, cb) => { e.preventDefault(); cb(false) })

  createTray()
  createWindow()

  // Обновление самой программы (интерфейс панели обновляется сам, с сайта)
  updater = startUpdater({
    getWin: () => win,
    onState: (st, v) => {
      updState = st
      trayMenu()
      if (st === 'downloading') tray.setToolTip(`NEX Admin: загружается версия ${v}`)
      else if (st === 'ready') tray.setToolTip(`NEX Admin: готова версия ${v}`)
      else tray.setToolTip('NEX Admin')
    },
  })
}

app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => { if (quitting) app.quit() })

process.on('uncaughtException', (err) => {
  try { dialog.showErrorBox('NEX Admin', String(err && err.message ? err.message : err)) } catch {}
})
