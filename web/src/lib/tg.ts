/* Обёртка над Telegram WebApp. Вне Telegram все методы безопасно ничего не делают. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any
export const TG: any = w.Telegram?.WebApp
export const inTelegram = !!(TG && TG.initData)
export const isStandalone =
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true

export function tgInit() {
  if (!inTelegram) return
  try {
    TG.ready()
    TG.expand()
    TG.setHeaderColor?.('#13070A')
    TG.setBackgroundColor?.('#13070A')
    TG.setBottomBarColor?.('#13070A')
    TG.disableVerticalSwipes?.()
  } catch {
    /* старые клиенты */
  }
}

export function haptic(kind: 'light' | 'medium' | 'success' | 'error' | 'select' = 'light') {
  const h = TG?.HapticFeedback
  if (!h) return
  try {
    if (kind === 'success' || kind === 'error') h.notificationOccurred(kind)
    else if (kind === 'select') h.selectionChanged()
    else h.impactOccurred(kind)
  } catch {
    /* ignore */
  }
}

export function openTgLink(url: string) {
  if (inTelegram && TG.openTelegramLink) TG.openTelegramLink(url)
  else window.open(url, '_blank')
}

export function openLink(url: string) {
  if (inTelegram && TG.openLink) TG.openLink(url)
  else window.open(url, '_blank')
}

export function setBackButton(visible: boolean, onClick: () => void) {
  const b = TG?.BackButton
  if (!inTelegram || !b) return () => {}
  if (visible) {
    b.show()
    b.onClick(onClick)
  } else b.hide()
  return () => b.offClick(onClick)
}

export function requestContact(): Promise<boolean> {
  return new Promise((res) => {
    if (!inTelegram || !TG.requestContact) return res(false)
    try {
      TG.requestContact((ok: boolean) => res(!!ok))
    } catch {
      res(false)
    }
  })
}

export const canAddToHome = () => inTelegram && typeof TG.addToHomeScreen === 'function'
export const addToHome = () => TG?.addToHomeScreen?.()
