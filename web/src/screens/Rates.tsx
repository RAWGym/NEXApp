import { useState } from 'react'
import { useApp } from '../store'
import { Coin, TopBar } from '../components/ui'
import { Sparkline } from '../components/Chart'
import { CRYPTO, FIAT, cur, type CurrencyCode } from '../lib/currencies'
import { crossRate } from '../lib/market'
import { fmtPct, fmtRate } from '../lib/format'
import { IBell, IChev } from '../components/Icons'
import { CONFIG } from '../config'

export function Rates() {
  const { market, marketLoaded, push, startExchange } = useApp()
  const [tab, setTab] = useState<'fiat' | 'crypto'>('fiat')
  const [base, setBase] = useState<CurrencyCode>('KZT')
  const k = 1 - CONFIG.feePct / 100
  const updated = marketLoaded && market.updated_at ? new Date(market.updated_at) : null

  return (
    <div className="screen">
      <TopBar title="Курсы" />
      <div className="segment">
        <button className={tab === 'fiat' ? 'on' : ''} onClick={() => setTab('fiat')}>Валюты</button>
        <button className={tab === 'crypto' ? 'on' : ''} onClick={() => setTab('crypto')}>Крипто</button>
      </div>

      {tab === 'fiat' ? (
        <>
          <div className="row between mt16" style={{ padding: '0 4px' }}>
            <span className="xs faint">Курс в</span>
            <div className="chips" style={{ margin: 0, padding: 0 }}>
              {(['KZT', 'USD', 'RUB'] as CurrencyCode[]).map((b) => (
                <button key={b} className={`chip ${base === b ? 'on' : ''}`} style={{ height: 30, padding: '0 12px', fontSize: 13 }} onClick={() => setBase(b)}>
                  {b}
                </button>
              ))}
            </div>
          </div>
          <div className="row xs faint mt16" style={{ padding: '0 16px' }}>
            <span className="grow">Валюта</span>
            <span style={{ width: 80, textAlign: 'right' }}>Покупка</span>
            <span style={{ width: 80, textAlign: 'right' }}>Продажа</span>
          </div>
          <div className="list mt8">
            {[...FIAT, CRYPTO[0]]
              .filter((c) => c.code !== base)
              .map((c) => {
                const r = crossRate(market, c.code, base)
                return (
                  <button key={c.code} className="list-item" onClick={() => startExchange({ from: c.code, to: base })}>
                    <Coin code={c.code} />
                    <div className="grow">
                      <div className="title">{c.code}</div>
                      <div className="sub ellipsis">{c.name}</div>
                    </div>
                    <span style={{ width: 80, textAlign: 'right', fontWeight: 500 }}>{fmtRate(r * k)}</span>
                    <span style={{ width: 80, textAlign: 'right', fontWeight: 500 }}>{fmtRate(r / k)}</span>
                  </button>
                )
              })}
          </div>
          <p className="xs faint" style={{ margin: '10px 6px 0' }}>
            Покупка: сколько {cur(base).symbol} вы получите за 1 единицу валюты. Продажа: сколько {cur(base).symbol} нужно отдать за 1 единицу. Комиссия {CONFIG.feePct}% уже учтена.
          </p>
        </>
      ) : (
        <>
          <div className="row xs faint mt16" style={{ padding: '0 16px' }}>
            <span className="grow">Монета</span>
            <span>Цена, 24ч</span>
          </div>
          <div className="list mt8">
            {CRYPTO.map((c) => {
              const ch = market.change24h[c.code]
              return (
                <button key={c.code} className="list-item" onClick={() => push({ name: 'coin', code: c.code })}>
                  <Coin code={c.code} />
                  <div className="grow">
                    <div className="title">{c.code}</div>
                    <div className="sub">{c.name}</div>
                  </div>
                  <Sparkline data={market.spark[c.code]} />
                  <div className="right" style={{ minWidth: 92 }}>
                    <div style={{ fontWeight: 600 }}>${fmtRate(market.usd[c.code])}</div>
                    <div className={`xs ${ch != null && ch >= 0 ? 'green' : 'red'}`}>{fmtPct(ch)}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      <button className="card row mt16" style={{ width: '100%', textAlign: 'left' }} onClick={() => push({ name: 'alerts' })}>
        <div className="coin" style={{ background: 'rgba(234,225,215,0.07)' }}>
          <IBell size={20} />
        </div>
        <div className="grow">
          <div style={{ fontWeight: 600 }}>Уведомление о курсе</div>
          <div className="small muted">Бот сообщит, когда курс достигнет нужного значения</div>
        </div>
        <IChev className="chev" />
      </button>
      {updated && updated.getTime() > 0 && (
        <div className="xs faint mt12" style={{ textAlign: 'center' }}>
          Обновлено в {updated.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · обновляется каждую минуту
        </div>
      )}
    </div>
  )
}
