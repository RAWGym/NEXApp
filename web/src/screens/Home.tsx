import { useMemo } from 'react'
import { useApp } from '../store'
import { Coin, StatusBadge, Wave } from '../components/ui'
import { IBell, IChat, IChart, IEye, IEyeOff, IShieldCheck, ISwap, IChev, VerifiedBadge } from '../components/Icons'
import { Sparkline } from '../components/Chart'
import { crossRate } from '../lib/market'
import { fmtAmount, fmtDate, fmtMoney, fmtPct, fmtRate } from '../lib/format'
import { cur, type CurrencyCode } from '../lib/currencies'
import { CONFIG } from '../config'
import { openTgLink } from '../lib/tg'

const POPULAR: CurrencyCode[] = ['USD', 'EUR', 'RUB', 'USDT', 'BTC']

export function Home() {
  const { user, market, orders, push, setTab, startExchange, hideAmounts, setHideAmounts } = useApp()
  const completed = orders.filter((o) => o.status === 'completed')
  const active = orders.filter((o) => o.status === 'new' || o.status === 'accepted')
  const volumeKzt = useMemo(
    () => completed.reduce((s, o) => s + o.amount_from * crossRate(market, o.from_cur, 'KZT'), 0),
    [completed, market],
  )
  const verified = user?.kyc_status === 'verified'
  const usdKzt = crossRate(market, 'USD', 'KZT')

  return (
    <div className="screen">
      <div className="row between" style={{ marginBottom: 18 }}>
        <div className="row">
          <Avatar />
          <div>
            <div className="small muted">Привет,</div>
            <div style={{ fontWeight: 600, fontSize: 17 }} className="row" >
              <span className="ellipsis" style={{ maxWidth: 190 }}>{user?.first_name ?? ' '}</span>
              {verified && <VerifiedBadge />}
            </div>
          </div>
        </div>
        <button className="icon-btn" aria-label="Уведомления о курсе" onClick={() => push({ name: 'alerts' })}>
          <IBell />
        </button>
      </div>

      <div className="hero">
        <Wave className="wave" />
        <div style={{ position: 'relative' }}>
          <div className="row small" style={{ gap: 6, color: 'rgba(234,225,215,0.75)' }}>
            Обменено через NEX
            <button onClick={() => setHideAmounts(!hideAmounts)} aria-label="Скрыть суммы" style={{ display: 'flex' }}>
              {hideAmounts ? <IEyeOff size={18} /> : <IEye size={18} />}
            </button>
          </div>
          <div className="big mt8">{hideAmounts ? '••••••' : `${fmtAmount(volumeKzt, 'KZT')} ₸`}</div>
          <div className="small mt8" style={{ color: 'rgba(234,225,215,0.75)' }}>
            {completed.length ? `${completed.length} ${plural(completed.length, 'обмен', 'обмена', 'обменов')}` : 'Первый обмен ждёт вас'}
            {' · '}1 USD = {fmtRate(usdKzt)} ₸
          </div>
        </div>
      </div>

      <div className="actions">
        <button className="action main" onClick={() => startExchange({})}>
          <ISwap />
          Обменять
        </button>
        <button className="action" onClick={() => setTab('rates')}>
          <IChart />
          Курсы
        </button>
        <button className="action" onClick={() => openTgLink(`https://t.me/${CONFIG.supportUsername}`)}>
          <IChat />
          Поддержка
        </button>
      </div>

      {!verified && (
        <button className="card row mt12" style={{ width: '100%', textAlign: 'left' }} onClick={() => push({ name: 'kyc' })}>
          <div className="coin" style={{ background: 'rgba(143,36,52,0.35)' }}>
            <IShieldCheck size={20} />
          </div>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>
              {user?.kyc_status === 'pending' ? 'Верификация на проверке' : 'Пройдите верификацию'}
            </div>
            <div className="small muted">
              {user?.kyc_status === 'pending'
                ? 'Мы сообщим в Telegram, как только проверим анкету'
                : 'Получите отметку «Подтверждён» и приоритет в обмене'}
            </div>
          </div>
          <IChev className="chev" />
        </button>
      )}

      {active.length > 0 && (
        <>
          <h2 className="section">Активные заявки</h2>
          <div className="list">
            {active.map((o) => (
              <button key={o.id} className="list-item" onClick={() => push({ name: 'order', id: o.id })}>
                <div className="coin" style={{ background: 'rgba(234,225,215,0.07)' }}>
                  <ISwap size={18} />
                </div>
                <div className="grow">
                  <div className="title">
                    {o.from_cur} → {o.to_cur}
                  </div>
                  <div className="sub">Заявка №{o.id} · {fmtDate(o.created_at)}</div>
                </div>
                <div className="right">
                  <div style={{ fontWeight: 600 }}>{fmtMoney(o.amount_to, o.to_cur)}</div>
                  <div className="mt8" style={{ marginTop: 4 }}>
                    <StatusBadge s={o.status} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <h2 className="section">
        Курсы к тенге
        <button onClick={() => setTab('rates')}>Все</button>
      </h2>
      <div className="list">
        {POPULAR.map((code) => {
          const c = cur(code)
          const ch = market.change24h[code]
          return (
            <button
              key={code}
              className="list-item"
              onClick={() => (c.type === 'crypto' ? push({ name: 'coin', code }) : startExchange({ from: code, to: 'KZT' }))}
            >
              <Coin code={code} />
              <div className="grow">
                <div className="title">{code}</div>
                <div className="sub">{c.name}</div>
              </div>
              {c.type === 'crypto' && <Sparkline data={market.spark[code]} w={56} h={24} />}
              <div className="right" style={{ minWidth: 96 }}>
                <div style={{ fontWeight: 600 }}>{fmtRate(crossRate(market, code, 'KZT'))} ₸</div>
                {ch != null && <div className={`xs ${ch >= 0 ? 'green' : 'red'}`}>{fmtPct(ch)}</div>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Avatar({ size = 44 }: { size?: number }) {
  const { user } = useApp()
  const letter = (user?.first_name || 'N').slice(0, 1).toUpperCase()
  if (user?.photo_url)
    return <img src={user.photo_url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: size * 0.4,
        background: 'linear-gradient(140deg,#8f2434,#5b0f1f)',
        border: '1px solid rgba(234,225,215,0.15)',
        flex: 'none',
      }}
    >
      {letter}
    </div>
  )
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10
  const b = n % 100
  if (a === 1 && b !== 11) return one
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few
  return many
}
