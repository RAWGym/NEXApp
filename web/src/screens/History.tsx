import { useState } from 'react'
import { useApp } from '../store'
import { StatusBadge, TopBar } from '../components/ui'
import { IHistory, ISwap } from '../components/Icons'
import { fmtDate, fmtMoney } from '../lib/format'
import type { OrderStatus } from '../lib/api'

const FILTERS: { id: string; label: string; match: (s: OrderStatus) => boolean }[] = [
  { id: 'all', label: 'Все', match: () => true },
  { id: 'active', label: 'Активные', match: (s) => s === 'new' || s === 'accepted' },
  { id: 'done', label: 'Выполненные', match: (s) => s === 'completed' },
  { id: 'cancel', label: 'Отменённые', match: (s) => s === 'cancelled' || s === 'rejected' },
]

export function History() {
  const { orders, ordersLoaded, push, startExchange } = useApp()
  const [f, setF] = useState('all')
  const list = orders.filter((o) => FILTERS.find((x) => x.id === f)!.match(o.status))

  return (
    <div className="screen">
      <TopBar title="История" />
      <div className="chips">
        {FILTERS.map((x) => (
          <button key={x.id} className={`chip ${f === x.id ? 'on' : ''}`} onClick={() => setF(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="mt16">
        {!ordersLoaded ? (
          <div className="list">
            {[0, 1, 2].map((i) => (
              <div key={i} className="list-item">
                <div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                <div className="grow">
                  <div className="skeleton" style={{ height: 14, width: '50%' }} />
                  <div className="skeleton mt8" style={{ height: 12, width: '30%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="empty">
            <IHistory size={44} />
            <div>Здесь появятся ваши обмены</div>
            <button className="btn btn-primary btn-sm mt16" style={{ margin: '16px auto 0' }} onClick={() => startExchange({})}>
              Создать заявку
            </button>
          </div>
        ) : (
          <div className="list stagger" key={f}>
            {list.map((o) => (
              <button key={o.id} className="list-item" onClick={() => push({ name: 'order', id: o.id })}>
                <div className="coin" style={{ background: 'rgba(234,225,215,0.07)' }}>
                  <ISwap size={18} />
                </div>
                <div className="grow">
                  <div className="title">Обмен</div>
                  <div className="sub">
                    {o.from_cur} → {o.to_cur} · №{o.id}
                  </div>
                </div>
                <div className="right">
                  <div style={{ fontWeight: 600 }} className={o.status === 'completed' ? 'green' : ''}>
                    {o.status === 'completed' ? '+' : ''}
                    {fmtMoney(o.amount_to, o.to_cur)}
                  </div>
                  <div className="xs faint" style={{ marginTop: 2 }}>{fmtDate(o.created_at)}</div>
                  <div style={{ marginTop: 4 }}>
                    <StatusBadge s={o.status} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
