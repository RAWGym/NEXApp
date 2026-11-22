import { useState } from 'react'
import { useApp } from '../store'
import { Coin, StatusBadge, TopBar, useToast } from '../components/ui'
import { ICheck, IChat, ISwap } from '../components/Icons'
import { fmtDate, fmtMoney, rateLabel } from '../lib/format'
import { api } from '../lib/api'
import { CONFIG, DEMO } from '../config'
import { haptic, openTgLink } from '../lib/tg'

export function OrderView({ id }: { id: number }) {
  const { orders, pop, refreshOrders, startExchange } = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const o = orders.find((x) => x.id === id)
  if (!o)
    return (
      <div className="screen sub">
        <TopBar title="Заявка" onBack={pop} />
        <div className="empty">Заявка не найдена</div>
      </div>
    )

  const failed = o.status === 'cancelled' || o.status === 'rejected'
  const steps = [
    { t: 'Заявка создана', d: fmtDate(o.created_at), done: true },
    {
      t: 'Оператор принял заявку',
      d: o.accepted_at ? `${fmtDate(o.accepted_at)} · оператор напишет вам в Telegram` : 'Обычно до 15 минут',
      done: o.status === 'accepted' || o.status === 'completed',
    },
    { t: 'Обмен выполнен', d: o.completed_at ? fmtDate(o.completed_at) : 'После передачи средств', done: o.status === 'completed' },
  ]
  const curIdx = steps.findIndex((s) => !s.done)

  const cancel = async () => {
    if (!confirm('Отменить заявку?')) return
    setBusy(true)
    try {
      await api.cancelOrder(o.id)
      haptic('success')
      await refreshOrders()
      toast('Заявка отменена')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen sub">
      <TopBar title={`Заявка №${o.id}`} onBack={pop} />

      <div className="card hero-soft rise" style={{ textAlign: 'center', padding: '22px 16px' }}>
        <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
          <Coin code={o.from_cur} size="lg" />
          <ISwap className="muted" />
          <Coin code={o.to_cur} size="lg" />
        </div>
        <div className="small muted mt16">Вы получите</div>
        <div className="big" style={{ fontSize: 30 }}>{fmtMoney(o.amount_to, o.to_cur)}</div>
        <div className="mt8">
          <StatusBadge s={o.status} />
        </div>
      </div>

      {o.status === 'completed' && (
        <div className="card mt12 row" style={{ background: 'rgba(108,197,143,0.08)', borderColor: 'rgba(108,197,143,0.25)' }}>
          <ICheck className="green" />
          <div className="small">Обмен успешно завершён. Спасибо, что выбрали NEX!</div>
        </div>
      )}
      {failed && (
        <div className="card mt12 small muted">
          {o.status === 'rejected' ? 'Заявка отклонена оператором.' : 'Заявка отменена.'}
          {o.admin_note ? ` Комментарий: ${o.admin_note}` : ''}
        </div>
      )}

      {!failed && (
        <div className="card mt12 rise-1">
          <div className="steps stagger">
            {steps.map((s, i) => (
              <div key={i} className={`step ${s.done ? 'done' : i === curIdx ? 'cur' : ''}`}>
                <div className="dotc">{s.done && <ICheck size={13} strokeWidth={3} />}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{s.t}</div>
                  <div className="xs muted">{s.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card mt12" style={{ padding: '6px 16px' }}>
        <div className="kv"><span className="k">Отдаёте</span><span className="v">{fmtMoney(o.amount_from, o.from_cur)}</span></div>
        <div className="kv"><span className="k">Курс</span><span className="v">{rateLabel(o.from_cur, o.to_cur, o.rate)}</span></div>
        <div className="kv"><span className="k">Комиссия {o.fee_pct}%</span><span className="v">{fmtMoney(o.fee_amount, o.to_cur)}</span></div>
        <div className="kv"><span className="k">Способ</span><span className="v">{o.method}</span></div>
        {o.details && <div className="kv"><span className="k">Детали</span><span className="v" style={{ wordBreak: 'break-all' }}>{o.details}</span></div>}
        {o.note && <div className="kv"><span className="k">Комментарий</span><span className="v">{o.note}</span></div>}
        <div className="kv"><span className="k">Создана</span><span className="v">{fmtDate(o.created_at)}</span></div>
      </div>

      <button className="btn btn-ghost mt16" onClick={() => openTgLink(`https://t.me/${CONFIG.supportUsername}`)}>
        <IChat size={20} /> Написать в поддержку
      </button>
      {o.status === 'new' && (
        <button className="btn btn-danger mt12" onClick={cancel} disabled={busy}>
          Отменить заявку
        </button>
      )}
      {(o.status === 'completed' || failed) && (
        <button className="btn btn-primary mt12" onClick={() => startExchange({ from: o.from_cur, to: o.to_cur })}>
          Повторить обмен
        </button>
      )}

      {DEMO && (o.status === 'new' || o.status === 'accepted') && (
        <div className="demo-bar">
          Демо-режим: так выглядят действия оператора в боте.
          <div className="row">
            {o.status === 'new' && (
              <>
                <button onClick={() => (api.demoAdvance(o.id, 'accepted'), refreshOrders())}>Принять</button>
                <button onClick={() => (api.demoAdvance(o.id, 'rejected'), refreshOrders())}>Отклонить</button>
              </>
            )}
            {o.status === 'accepted' && <button onClick={() => (api.demoAdvance(o.id, 'completed'), refreshOrders())}>Подтвердить обмен</button>}
          </div>
        </div>
      )}
    </div>
  )
}
