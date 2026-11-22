// Все настройки, которые меняются без правки кода, задаются через переменные окружения (.env)
const env = import.meta.env

export const CONFIG = {
  apiUrl: (env.VITE_API_URL as string | undefined) || '',
  botUsername: (env.VITE_BOT_USERNAME as string | undefined) || 'noirexcbot',
  supportUsername: (env.VITE_SUPPORT_USERNAME as string | undefined) || 'noirexchangekz',
  legalName: (env.VITE_LEGAL_NAME as string | undefined) || 'NEX Digital Asset Exchange',
  country: (env.VITE_COUNTRY as string | undefined) || 'Республика Казахстан',
  email: (env.VITE_EMAIL as string | undefined) || 'support@nex.kz',
  feePct: 3,
  /** Лимиты одной заявки в тенге (эквивалент) */
  minKzt: 10_000,
  maxKzt: 1_000_000,
  maxKztVerified: 5_000_000,
}

/** Демо-режим: если адрес API не задан, приложение работает на локальных данных */
export const DEMO = !CONFIG.apiUrl
