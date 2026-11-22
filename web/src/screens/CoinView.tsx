import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { Coin, Spinner, TopBar } from '../components/ui'
import { LineChart } from '../components/Chart'
import { cur, type CurrencyCode } from '../lib/currencies'
import { crossRate, fetchChart, type ChartRange } from '../lib/market'
import { fmtPct, fmtRate } from '../lib/format'

const RANGES: { d: ChartRange; l: string }[] = [
  { d: 1, l: '1Д' },
  { d: 7, l: '7Д' },
  { d: 30, l: '1М' },
  { d: 365, l: '1Г' },
]

export function CoinView({ code }: { code: CurrencyCode }) {
  const { market, pop, startExchange, push } = useApp()
  const c = cur(code)
  const [range, setRange] = useState<ChartRange>(7)
  const [data, setData] = useState<[number, number][] | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let alive = true
    setData(null)
    setErr(false)
    fetchChart(c.geckoId!, range)
      .then((d) => alive && setData(d))
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [c.geckoId, range])

  const change = data && data.length > 1 ? ((data[data.length - 1][1] - data[0][1]) / data[0][1]) * 100 : market.change24h[code] ?? null

  return (
    <div className="screen sub">
      <TopBar title={c.name} onBack={pop} />
      <div className="row">
        <Coin code={code} size="lg" />
        <div>
          <div className="big" style={{ fontSize: 30 }}>${fmtRate(market.usd[code])}</div>
          <div className="small">
            <span className={change != null && change >= 0 ? 'green' : 'red'}>{fmtPct(change)}</span>
            <span className="faint"> за {RANGES.find((r) => r.d === range)!.l.toLowerCase()}</span>
          </div>
        </div>
      </div>

      <div className="card mt16" style={{ padding: '14px 12px' }}>
        <div style={{ height: 224, display: 'grid', placeItems: 'center' }}>
          {data ? (
            <div style={{ width: '100%' }}>
              <LineChart data={data} />
            </div>
          ) : err ? (
            <div className="small muted" style={{ textAlign: 'center' }}>
              График временно недоступен.
              <br />
              Попробуйте через минуту.
            </div>
          ) : (
            <Spinner />
          )}
        </div>
        <div className="segment mt12">
          {RANGES.map((r) => (
            <button key={r.d} className={range === r.d ? 'on' : ''} onClick={() => setRange(r.d)}>
              {r.l}
            </button>
          ))}
        </div>
      </div>

      <div className="card mt12" style={{ padding: '6px 16px' }}>
        <div className="kv"><span className="k">1 {code} в тенге</span><span className="v">{fmtRate(crossRate(market, code, 'KZT'))} ₸</span></div>
        <div className="kv"><span className="k">1 {code} в рублях</span><span className="v">{fmtRate(crossRate(market, code, 'RUB'))} ₽</span></div>
        <div className="kv"><span className="k">Изменение за 24ч</span><span className="v">{fmtPct(market.change24h[code])}</span></div>
      </div>

      <div className="row mt16" style={{ gap: 10 }}>
        <button className="btn btn-ghost" onClick={() => startExchange({ from: 'KZT', to: code })}>Купить</button>
        <button className="btn btn-primary" onClick={() => startExchange({ from: code, to: 'KZT' })}>Продать</button>
      </div>
      <button className="btn btn-ghost mt12" onClick={() => push({ name: 'alerts' })} style={{ height: 46, fontSize: 14 }}>
        Уведомить о курсе {code}
      </button>
    </div>
  )
}
