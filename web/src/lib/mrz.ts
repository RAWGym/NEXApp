// Разбор машиночитаемой зоны (MRZ) документов по стандарту ICAO 9303: паспорт (TD3), ID-карта (TD1), ВНЖ (TD1/TD2).
// Этот же файл используется в приложении (web/src/lib/mrz.ts) и на сервере.

export interface MrzResult {
  format: 'TD1' | 'TD2' | 'TD3'
  doc_code: string
  issuer: string
  surname: string
  given_names: string
  doc_number: string
  nationality: string
  birth_date: string // YYYY-MM-DD
  sex: string
  expiry_date: string // YYYY-MM-DD
  personal_number: string
  checks: { doc_number: boolean; birth_date: boolean; expiry_date: boolean; composite: boolean }
  valid: boolean
  lines: string[]
}

const val = (c: string) => (c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55)
export function checkDigit(s: string) {
  const w = [7, 3, 1]
  let sum = 0
  for (let i = 0; i < s.length; i++) sum += val(s[i]) * w[i % 3]
  return String(sum % 10)
}
const ok = (field: string, cd: string) => checkDigit(field) === cd

// Частые ошибки распознавания в полях, где допустимы только цифры
const toDigits = (s: string) => s.replace(/O|Q|D/g, '0').replace(/I|L/g, '1').replace(/Z/g, '2').replace(/S/g, '5').replace(/B/g, '8').replace(/G/g, '6')

function date(yymmdd: string, future: boolean) {
  if (!/^\d{6}$/.test(yymmdd)) return ''
  const yy = +yymmdd.slice(0, 2)
  const nowYY = new Date().getFullYear() % 100
  const century = future ? (yy < nowYY + 50 ? 2000 : 1900) : yy > nowYY ? 1900 : 2000
  return `${century + yy}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`
}
function names(s: string) {
  const [sur, ...rest] = s.replace(/<+$/, '').split('<<')
  return { surname: sur.replace(/</g, ' ').trim(), given_names: rest.join(' ').replace(/</g, ' ').replace(/\s+/g, ' ').trim() }
}

/** Приводит распознанный текст к строкам MRZ нужной длины */
export function extractLines(text: string): string[] | null {
  const rows = text
    .toUpperCase()
    .split(/\n/)
    .map((r) => r.replace(/\s/g, '').replace(/[«‹(\[{]/g, '<').replace(/[^A-Z0-9<]/g, ''))
    .filter((r) => r.length >= 20)
  const fit = (r: string, n: number) => (r.length >= n ? r.slice(0, n) : r + '<'.repeat(n - r.length))
  const D = '[0-9OQDILZSBG]'
  // Ищем строку с данными по её структуре: распознавание часто теряет символы-заполнители «<» в конце строк
  const td3 = new RegExp(`^[A-Z0-9<]{9}${D}[A-Z<]{3}${D}{7}[MFX<]${D}{7}`)
  const td1 = new RegExp(`^${D}{7}[MFX<]${D}{7}[A-Z<]{3}`)
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (r.length >= 40 && td3.test(r) && rows[i - 1].startsWith('P')) return [fit(rows[i - 1], 44), fit(r, 44)]
    if (r.length >= 26 && r.length <= 33 && td1.test(r) && /^[ACI]/.test(rows[i - 1]) && rows[i + 1]) return [fit(rows[i - 1], 30), fit(r, 30), fit(rows[i + 1], 30)]
    if (r.length >= 32 && r.length <= 39 && td3.test(r) && /^[ACI]/.test(rows[i - 1])) return [fit(rows[i - 1], 36), fit(r, 36)]
  }
  return null
}

export function parseMrz(lines: string[]): MrzResult | null {
  const L = lines.map((l) => l.toUpperCase().replace(/[^A-Z0-9<]/g, ''))
  if (L.length === 2 && L[0].length === 44 && L[1].length === 44) {
    const [a, b] = L
    const docNum = b.slice(0, 9), dob = toDigits(b.slice(13, 19)), exp = toDigits(b.slice(21, 27))
    const cd = (i: number) => toDigits(b[i])
    const checks = {
      doc_number: ok(docNum, cd(9)),
      birth_date: ok(dob, cd(19)),
      expiry_date: ok(exp, cd(27)),
      composite: ok(b.slice(0, 10) + dob + cd(19) + exp + cd(27) + b.slice(28, 43), cd(43)),
    }
    return {
      format: 'TD3', doc_code: a.slice(0, 2).replace(/</g, ''), issuer: a.slice(2, 5).replace(/</g, ''), ...names(a.slice(5)),
      doc_number: docNum.replace(/</g, ''), nationality: b.slice(10, 13).replace(/</g, ''), birth_date: date(dob, false), sex: b[20].replace('<', ''),
      expiry_date: date(exp, true), personal_number: b.slice(28, 42).replace(/</g, ''), checks,
      valid: checks.doc_number && checks.birth_date && checks.expiry_date, lines: L,
    }
  }
  if (L.length === 3 && L.every((l) => l.length === 30)) {
    const [a, b, c] = L
    const docNum = a.slice(5, 14), dob = toDigits(b.slice(0, 6)), exp = toDigits(b.slice(8, 14))
    const checks = {
      doc_number: ok(docNum, toDigits(a[14])),
      birth_date: ok(dob, toDigits(b[6])),
      expiry_date: ok(exp, toDigits(b[14])),
      composite: ok(a.slice(5, 30) + dob + toDigits(b[6]) + exp + toDigits(b[14]) + b.slice(18, 29), toDigits(b[29])),
    }
    return {
      format: 'TD1', doc_code: a.slice(0, 2).replace(/</g, ''), issuer: a.slice(2, 5).replace(/</g, ''), ...names(c),
      doc_number: docNum.replace(/</g, ''), nationality: b.slice(15, 18).replace(/</g, ''), birth_date: date(dob, false), sex: b[7].replace('<', ''),
      expiry_date: date(exp, true), personal_number: a.slice(15, 30).replace(/</g, '') || b.slice(18, 29).replace(/</g, ''), checks,
      valid: checks.doc_number && checks.birth_date && checks.expiry_date, lines: L,
    }
  }
  if (L.length === 2 && L[0].length === 36 && L[1].length === 36) {
    const [a, b] = L
    const docNum = b.slice(0, 9), dob = toDigits(b.slice(13, 19)), exp = toDigits(b.slice(21, 27))
    const checks = {
      doc_number: ok(docNum, toDigits(b[9])),
      birth_date: ok(dob, toDigits(b[19])),
      expiry_date: ok(exp, toDigits(b[27])),
      composite: ok(b.slice(0, 10) + dob + toDigits(b[19]) + exp + toDigits(b[27]) + b.slice(28, 35), toDigits(b[35])),
    }
    return {
      format: 'TD2', doc_code: a.slice(0, 2).replace(/</g, ''), issuer: a.slice(2, 5).replace(/</g, ''), ...names(a.slice(5)),
      doc_number: docNum.replace(/</g, ''), nationality: b.slice(10, 13).replace(/</g, ''), birth_date: date(dob, false), sex: b[20].replace('<', ''),
      expiry_date: date(exp, true), personal_number: b.slice(28, 35).replace(/</g, ''), checks,
      valid: checks.doc_number && checks.birth_date && checks.expiry_date, lines: L,
    }
  }
  return null
}

// Латиница для сравнения ФИО из анкеты (кириллица) с MRZ
const TR: Record<string, string> = {
  а: 'A', б: 'B', в: 'V', г: 'G', ғ: 'G', д: 'D', е: 'E', ё: 'E', ж: 'ZH', з: 'Z', и: 'I', й: 'I', к: 'K', қ: 'Q', л: 'L', м: 'M', н: 'N', ң: 'N',
  о: 'O', ө: 'O', п: 'P', р: 'R', с: 'S', т: 'T', у: 'U', ұ: 'U', ү: 'U', ф: 'F', х: 'KH', һ: 'H', ц: 'TS', ч: 'CH', ш: 'SH', щ: 'SHCH',
  ъ: '', ы: 'Y', і: 'I', ь: '', э: 'E', ю: 'IU', я: 'IA', ә: 'A',
}
export const latin = (s: string) =>
  s.toLowerCase().split('').map((ch) => TR[ch] ?? ch.toUpperCase()).join('').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Похожи ли имена: совпадает фамилия и хотя бы одно имя (с учётом разных вариантов транслитерации) */
export function namesMatch(fullName: string, mrz: { surname: string; given_names: string }) {
  const norm = (w: string) => w.replace(/KH/g, 'H').replace(/IU|YU/g, 'U').replace(/IA|YA/g, 'A').replace(/Y/g, 'I').replace(/J/g, 'ZH').replace(/Q/g, 'K').replace(/(.)\1/g, '$1')
  const a = latin(fullName).split(' ').map(norm)
  const sur = norm(mrz.surname.replace(/\s+/g, ''))
  const given = mrz.given_names.split(' ').map(norm)
  const near = (x: string, y: string) => x === y || (x.length > 3 && y.length > 3 && (x.startsWith(y.slice(0, -1)) || y.startsWith(x.slice(0, -1))))
  return a.some((w) => near(w, sur)) && a.some((w) => given.some((g) => near(w, g)))
}
