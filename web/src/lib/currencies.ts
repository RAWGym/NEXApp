export type CurrencyCode = 'KZT' | 'USD' | 'EUR' | 'RUB' | 'USDT' | 'BTC' | 'ETH' | 'TON'

export interface Currency {
  code: CurrencyCode
  name: string
  symbol: string
  type: 'fiat' | 'crypto'
  decimals: number
  color: string
  geckoId?: string
}

export const CURRENCIES: Currency[] = [
  { code: 'KZT', name: 'Казахстанский тенге', symbol: '₸', type: 'fiat', decimals: 2, color: '#1E8FA8' },
  { code: 'USD', name: 'Доллар США', symbol: '$', type: 'fiat', decimals: 2, color: '#3F7A55' },
  { code: 'EUR', name: 'Евро', symbol: '€', type: 'fiat', decimals: 2, color: '#2F4C9A' },
  { code: 'RUB', name: 'Российский рубль', symbol: '₽', type: 'fiat', decimals: 2, color: '#9A3B47' },
  { code: 'USDT', name: 'Tether', symbol: '₮', type: 'crypto', decimals: 2, color: '#26A17B', geckoId: 'tether' },
  { code: 'BTC', name: 'Bitcoin', symbol: '₿', type: 'crypto', decimals: 8, color: '#E3902F', geckoId: 'bitcoin' },
  { code: 'ETH', name: 'Ethereum', symbol: 'Ξ', type: 'crypto', decimals: 6, color: '#6F7CC9', geckoId: 'ethereum' },
  { code: 'TON', name: 'Toncoin', symbol: '◆', type: 'crypto', decimals: 4, color: '#2F9CE0', geckoId: 'the-open-network' },
]

export const cur = (code: string): Currency => CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]
export const FIAT = CURRENCIES.filter((c) => c.type === 'fiat')
export const CRYPTO = CURRENCIES.filter((c) => c.type === 'crypto')
