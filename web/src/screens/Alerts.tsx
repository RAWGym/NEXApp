import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { Coin, Sheet, TopBar, useToast } from '../components/ui'
import { IBell, IPlus, ITrash } from '../components/Icons'
import { CurrencyPicker } from '../components/CurrencyPicker'
import { api, type RateAlert } from '../lib/api'
import type { CurrencyCode } from '../lib/currencies'
import { crossRate } from '../lib/market'
import { fmtRate, parseNum } from '../lib/format'
import { haptic } from '../lib/tg'

export function Alerts() {
  const { pop, market } = useApp()
  const toast = useToast()
  const [list, setList] = useState<RateAlert[] | null>(null)
  const [open, setOpen] = useState(false)
  const [base, setBase] = useState<CurrencyCode>('USD')
  const [quote, setQuote] = useState<CurrencyCode>('KZT')
  const [target, setTarget] = useState('')
  const [picker, setPicker] = useState<'base' | 'quote' | null>(null)

  const load = () => api.alerts().then(setList).catch(() => setList([]))
  useEffect(() => {
    load()
  }, [])

  const now = crossRate(market, base, quote)
  const t = parseNum(target)

  const create = async () => {
    try {
      await api.createAlert({ base, quote, target: t, direction: t >= now ? 'above' : 'below' })
      haptic('success')
      toast('Уведомление создано')
      setOpen(false)
      setTarget('')
      load()
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <div className="screen sub">
      <TopBar title="Уведомления о курсе" onBack={pop} />
      <p className="small muted" style={{ margin: '0 4px 14px' }}>Бот напишет вам в Telegram, когда курс достигнет заданного значения. Курсы проверяются каждые 5 минут.</p>
      {list && list.length === 0 && (
        <div className="empty">
          <IBell size={44} />
          <div>Пока нет уведомлений</div>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="list">
          {list.map((a) => (
            <div key={a.id} className="list-item">
              <Coin code={a.base} size="sm" />
              <div className="grow">
                <div className="title">{a.base}/{a.quote} {a.direction === 'above' ? '≥' : '≤'} {fmtRate(a.target)}</div>
                <div className="sub">{a.active ? `Сейчас ${fmtRate(crossRate(market, a.base, a.quote))}` : 'Сработало'}</div>
              </div>
              <button className="icon-btn" aria-label="Удалить" onClick={async () => (await api.deleteAlert(a.id), load())}>
                <ITrash size={20} className="muted" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button className="btn btn-primary mt16" onClick={() => setOpen(true)}>
        <IPlus size={20} /> Новое уведомление
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Новое уведомление">
        <div className="row" style={{ gap: 10 }}>
          <button className="input row grow" onClick={() => setPicker('base')}><Coin code={base} size="sm" /> {base}</button>
          <span className="muted">в</span>
          <button className="input row grow" onClick={() => setPicker('quote')}><Coin code={quote} size="sm" /> {quote}</button>
        </div>
        <div className="small muted mt12" style={{ marginLeft: 4 }}>Сейчас: 1 {base} = {fmtRate(now)} {quote}</div>
        <label className="field">
          <span>Уведомить, когда курс станет</span>
          <input className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={fmtRate(now)} />
        </label>
        {t > 0 && <div className="small muted mt8" style={{ marginLeft: 4 }}>{t >= now ? 'Сообщим, когда курс вырастет до' : 'Сообщим, когда курс опустится до'} {fmtRate(t)}</div>}
        <button className="btn btn-primary mt16" disabled={!(t > 0) || base === quote} onClick={create}>Создать</button>
      </Sheet>
      <CurrencyPicker open={picker === 'base'} onClose={() => setPicker(null)} value={base} exclude={quote} onPick={setBase} title="Валюта" />
      <CurrencyPicker open={picker === 'quote'} onClose={() => setPicker(null)} value={quote} exclude={base} onPick={setQuote} title="Курс в" />
    </div>
  )
}
