import type { EventItem } from './api'
import { Ico, ago, kzt } from './ui'

export function eventText(e: EventItem) {
  if (e.type === 'order.new') return { title: `Новая заявка #${e.id}`, text: `${e.who}: ${e.amount != null ? e.amount + ' ' + e.cur + ' → ' + e.to : ''}${e.kzt ? ` (${kzt(e.kzt)})` : ''}` }
  if (e.type === 'order.completed') return { title: `Заявка #${e.id} завершена`, text: `${e.who}${e.kzt ? `, ${kzt(e.kzt)}` : ''}` }
  if (e.type === 'kyc.new') return { title: 'Новая анкета на верификацию', text: e.who }
  return { title: 'Новый пользователь', text: e.who }
}

export function FeedList({ items, onPick, limit = 40 }: { items: (EventItem & { fresh?: boolean })[]; onPick: (e: EventItem) => void; limit?: number }) {
  if (!items.length) return <div className="empty" style={{ padding: 30 }}>За последние сутки событий нет</div>
  return (
    <div className="feed">
      {items.slice(0, limit).map((e) => {
        const m = eventText(e)
        const cls = e.type === 'order.new' ? 'o' : e.type === 'order.completed' ? 'd' : e.type === 'kyc.new' ? 'k' : 'u'
        const Icon = e.type === 'order.new' ? Ico.swap : e.type === 'order.completed' ? Ico.check : e.type === 'kyc.new' ? Ico.id : Ico.user
        return (
          <div key={e.type + e.id + e.at} className={`feed__item ${e.fresh ? 'new' : ''}`} onClick={() => onPick(e)}>
            <div className={`feed__ico ${cls}`}><Icon /></div>
            <div className="feed__txt">
              <b>{m.title}</b>
              <small>{m.text}</small>
            </div>
            <span className="feed__at">{ago(e.at)}</span>
          </div>
        )
      })}
    </div>
  )
}

