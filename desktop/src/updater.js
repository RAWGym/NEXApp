'use strict'
// Обновление программы NEX Admin.
// Новые версии публикуются в GitHub Releases репозитория NEX (тег desktop-vX.Y.Z):
//   latest.json  { "version": "1.1.0", "file": "NEX-Admin-Setup-1.1.0.exe", "sha256": "...", "notes": "..." }
//   NEX-Admin-Setup-1.1.0.exe
// Программа скачивает установщик в отдельной сессии (панель туда доступа не имеет),
// сверяет SHA-256 и только после согласия пользователя запускает тихую установку.

const { app, dialog, session } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const REPO = 'https://github.com/RAWGym/NEXApp/releases'
const MANIFEST = REPO + '/latest/download/latest.json'
const CHECK_EVERY = 4 * 60 * 60 * 1000
const FIRST_CHECK = 15 * 1000

let ses = null
let busy = false
let ready = null // { version, file: путь к проверенному установщику }
let getWin = () => null
let onState = () => {}

function newer(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

function net() {
  if (!ses) {
    ses = session.fromPartition('nex-updater', { cache: false })
    ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
  }
  return ses
}

async function fetchManifest() {
  const res = await net().fetch(MANIFEST + '?t=' + Date.now(), { redirect: 'follow' })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const m = await res.json()
  // Строгая проверка полей: из манифеста строится путь загрузки
  if (!/^\d+\.\d+\.\d+$/.test(String(m.version))) throw new Error('Некорректные данные обновления')
  if (!/^NEX-Admin-Setup-\d+\.\d+\.\d+\.exe$/.test(String(m.file))) throw new Error('Некорректные данные обновления')
  if (!/^[a-f0-9]{64}$/.test(String(m.sha256))) throw new Error('Некорректные данные обновления')
  return { version: m.version, file: m.file, sha256: m.sha256, notes: typeof m.notes === 'string' ? m.notes.slice(0, 600) : '' }
}

async function download(m) {
  const dir = path.join(app.getPath('temp'), 'nex-admin-update')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, m.file)
  const url = `${REPO}/download/desktop-v${m.version}/${m.file}`
  const res = await net().fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = crypto.createHash('sha256')
  const out = fs.createWriteStream(dest)
  let got = 0
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      got += value.length
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r))
      const w = getWin()
      if (w && total) w.setProgressBar(got / total)
    }
  } finally {
    await new Promise((r) => out.end(r))
    const w = getWin()
    if (w) w.setProgressBar(-1)
  }
  if (hash.digest('hex') !== m.sha256) {
    fs.rmSync(dest, { force: true })
    throw new Error('Контрольная сумма не совпала')
  }
  return dest
}

// Диалог привязываем к окну, только если оно на экране, иначе он спрячется вместе с окном в трее
function parent() {
  const w = getWin()
  return w && w.isVisible() ? w : undefined
}

async function offerInstall() {
  const opts = {
    type: 'info',
    title: 'Обновление NEX Admin',
    message: `Готова новая версия ${ready.version}`,
    detail: (ready.notes ? ready.notes + '\n\n' : '') + 'Программа закроется на несколько секунд и откроется снова. Вход в панель придётся повторить.',
    buttons: ['Обновить сейчас', 'Позже'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
  const p = parent()
  const r = p ? await dialog.showMessageBox(p, opts) : await dialog.showMessageBox(opts)
  if (r.response !== 0) return
  // Тихая установка поверх текущей версии; установщик сам запустит программу
  const child = spawn(ready.file, ['/S'], { detached: true, stdio: 'ignore' })
  child.unref()
  app.quit()
}

async function check(manual = false) {
  if (busy) return
  if (ready) return offerInstall()
  busy = true
  onState('checking')
  try {
    const m = await fetchManifest()
    if (!newer(m.version, app.getVersion())) {
      onState('latest')
      if (manual) dialog.showMessageBox({ type: 'info', title: 'NEX Admin', message: 'У вас последняя версия', detail: `Версия ${app.getVersion()}`, buttons: ['Хорошо'], noLink: true })
      return
    }
    onState('downloading', m.version)
    const file = await download(m)
    ready = { version: m.version, notes: m.notes, file }
    onState('ready', m.version)
    await offerInstall()
  } catch (e) {
    onState('error')
    if (manual) dialog.showMessageBox({ type: 'warning', title: 'NEX Admin', message: 'Не удалось проверить обновления', detail: String(e && e.message ? e.message : e), buttons: ['Хорошо'], noLink: true })
  } finally {
    busy = false
  }
}

function startUpdater(opts) {
  getWin = opts.getWin
  onState = opts.onState || onState
  if (!app.isPackaged) return { check }
  setTimeout(() => check(false), FIRST_CHECK)
  setInterval(() => check(false), CHECK_EVERY)
  return { check }
}

module.exports = { startUpdater, newer }
