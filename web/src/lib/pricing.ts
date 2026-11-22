/* Правила комиссии и программы лояльности. Те же правила проверяются на сервере. */
export const FEE_PCT = 3
export const MIN_FEE = 1.5
export const WELCOME_OFF = 1
export const REF_SHARE = 0.2
export const BONUS_MAX_SHARE = 0.5
export const TIERS = [
  { id: 'standard', name: 'Standard', min: 0, off: 0 },
  { id: 'silver', name: 'Silver', min: 1_000_000, off: 0.25 },
  { id: 'gold', name: 'Gold', min: 5_000_000, off: 0.5 },
  { id: 'black', name: 'Black', min: 20_000_000, off: 0.75 },
]
export const LARGE = [
  { min: 3_000_000, off: 0.5 },
  { min: 1_000_000, off: 0.25 },
]
export const tierOf = (vol: number) => [...TIERS].reverse().find((t) => vol >= t.min)!
export interface Discount {
  id: string
  label: string
  off: number
}
export function pricing(volumeKzt: number, amountKzt: number, welcome: boolean) {
  const tier = tierOf(volumeKzt)
  const discounts: Discount[] = []
  if (tier.off) discounts.push({ id: 'tier', label: `Уровень ${tier.name}`, off: tier.off })
  const large = LARGE.find((l) => amountKzt >= l.min)
  if (large) discounts.push({ id: 'large', label: 'Крупная сумма', off: large.off })
  if (welcome) discounts.push({ id: 'welcome', label: 'Первый обмен по приглашению', off: WELCOME_OFF })
  const fee = Math.max(MIN_FEE, FEE_PCT - discounts.reduce((s, d) => s + d.off, 0))
  return { fee: Math.round(fee * 100) / 100, discounts }
}
