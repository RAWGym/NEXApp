import { cur } from './currencies'

export function fmtNum(n: number, maxDp = 2, minDp = 0): string {
  if (!isFinite(n)) return '0'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: maxDp, minimumFractionDigits: minDp })
    .format(n)
    .replace(/[\u202f\u00a0]/g, ' ')
}

/** Сумма в валюте с разумным количеством знаков */
export function fmtAmount(n: number, code: string): string {
  const c = cur(code)
  let dp = c.decimals
  if (c.type === 'fiat') dp = Math.abs(n) >= 100000 ? 0 : 2
  if (c.type === 'crypto' && Math.abs(n) >= 1000) dp = 2
  return fmtNum(n, dp)
}

export function fmtMoney(n: number, code: string): string {
  const c = cur(code)
  return c.type === 'fiat' ? `${fmtAmount(n, code)} ${c.symbol}` : `${fmtAmount(n, code)} ${c.code}`
}

/** Курс: больше знаков для маленьких чисел */
export function fmtRate(n: number): string {
  if (n === 0) return '0'
  const a = Math.abs(n)
  const dp = a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 8
  return fmtNum(n, dp)
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return ''
  return `${n > 0 ? '+' : ''}${fmtNum(n, 2, 2)}%`
}

export function parseNum(s: string): number {
  const v = parseFloat(s.replace(/\s/g, '').replace(',', '.'))
  return isFinite(v) ? v : 0
}

const MONTHS = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (day === today) return `Сегодня, ${hm}`
  if (today - day === 86400000) return `Вчера, ${hm}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}, ${hm}`
}

/** Подпись курса в удобную сторону: «1 USD = 498,6 ₸» вместо «1 KZT = 0,002 $» */
export function rateLabel(from: string, to: string, rate: number): string {
  const sym = (c: string) => (cur(c).type === 'fiat' ? cur(c).symbol : c)
  return rate >= 1 || rate === 0 ? `1 ${from} = ${fmtRate(rate)} ${sym(to)}` : `1 ${to} = ${fmtRate(1 / rate)} ${sym(from)}`
}
