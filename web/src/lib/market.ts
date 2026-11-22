import { CRYPTO, type CurrencyCode } from './currencies'

export interface Market {
  /** цена 1 единицы валюты в долларах США */
  usd: Record<CurrencyCode, number>
  change24h: Partial<Record<CurrencyCode, number | null>>
  spark: Partial<Record<CurrencyCode, number[]>>
  updated_at: string
}

// Резервные значения на случай, если внешние источники недоступны
export const FALLBACK: Market = {
  usd: { USD: 1, KZT: 1 / 480, EUR: 1.08, RUB: 1 / 92, USDT: 1, BTC: 95000, ETH: 3400, TON: 5.2 },
  change24h: {},
  spark: {},
  updated_at: new Date(0).toISOString(),
}

/** Курсы напрямую из открытых источников (используется в демо-режиме; в боевом режиме их отдаёт сервер) */
export async function fetchMarketDirect(): Promise<Market> {
  const m: Market = { ...FALLBACK, usd: { ...FALLBACK.usd }, change24h: {}, spark: {}, updated_at: new Date().toISOString() }
  const [fiat, crypto] = await Promise.allSettled([
    fetch('https://open.er-api.com/v6/latest/USD').then((r) => r.json()),
    fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&sparkline=true&price_change_percentage=24h&ids=' +
        CRYPTO.map((c) => c.geckoId).join(','),
    ).then((r) => r.json()),
  ])
  if (fiat.status === 'fulfilled' && fiat.value?.rates) {
    for (const code of ['KZT', 'EUR', 'RUB'] as const) {
      const v = fiat.value.rates[code]
      if (v) m.usd[code] = 1 / v
    }
  }
  if (crypto.status === 'fulfilled' && Array.isArray(crypto.value)) {
    for (const c of CRYPTO) {
      const row = crypto.value.find((x: { id: string }) => x.id === c.geckoId)
      if (!row) continue
      m.usd[c.code] = row.current_price
      m.change24h[c.code] = row.price_change_percentage_24h ?? null
      const sp: number[] = row.sparkline_in_7d?.price ?? []
      m.spark[c.code] = sp.filter((_, i) => i % 4 === 0)
    }
  }
  return m
}

/** Кросс-курс: сколько единиц `to` за 1 единицу `from` */
export const crossRate = (m: Market, from: CurrencyCode, to: CurrencyCode) => m.usd[from] / m.usd[to]

export type ChartRange = 1 | 7 | 30 | 365
const chartCache = new Map<string, { t: number; data: [number, number][] }>()

export async function fetchChart(geckoId: string, days: ChartRange): Promise<[number, number][]> {
  const key = `${geckoId}:${days}`
  const hit = chartCache.get(key)
  if (hit && Date.now() - hit.t < 120_000) return hit.data
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart?vs_currency=usd&days=${days}`)
  if (!r.ok) throw new Error('chart')
  const j = await r.json()
  const data: [number, number][] = j.prices ?? []
  chartCache.set(key, { t: Date.now(), data })
  return data
}
