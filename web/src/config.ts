// Все настройки, которые меняются без правки кода, задаются через переменные окружения (.env)
const env = import.meta.env

export const CONFIG = {
  apiUrl: (env.VITE_API_URL as string | undefined) || '',
  botUsername: (env.VITE_BOT_USERNAME as string | undefined) || 'noirexcbot',
  supportUsername: (env.VITE_SUPPORT_USERNAME as string | undefined) || 'noirexchangekz',
  legalName: (env.VITE_LEGAL_NAME as string | undefined) || 'NEX Digital Asset Exchange',
  country: (env.VITE_COUNTRY as string | undefined) || 'Республика Казахстан',
  email: (env.VITE_EMAIL as string | undefined) || 'support@nex.kz',
  /** Номер лицензии/регистрации, если есть: показывается в разделе «Законность сделки» */
  license: (env.VITE_LICENSE as string | undefined) || '',
  /** Где физически хранятся данные (честно указывается в политике) */
  dataRegion: (env.VITE_DATA_REGION as string | undefined) || 'Европейский союз (Франкфурт, Германия)',
  feePct: 3,
  /** Лимиты одной заявки в тенге (эквивалент) */
  minKzt: 5_000,
  /** До этой суммы достаточно ФИО, телефона и даты рождения */
  maxKzt: 300_000,
  maxKztVerified: 5_000_000,
}

/** Демо-режим: если адрес API не задан, приложение работает на локальных данных */
export const DEMO = !CONFIG.apiUrl
