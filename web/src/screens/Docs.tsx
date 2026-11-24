import { useState } from 'react'
import { useApp } from '../store'
import { TopBar, useToast } from '../components/ui'
import { DOCS, FAQ } from '../docs'
import { Item } from './Profile'
import { IDoc, IDown, IFlow, ILock, IScale, ICopy } from '../components/Icons'
import { CONFIG } from '../config'
import { inTelegram, openLink, openTgLink } from '../lib/tg'

const INFO_IDS = ['process', 'security', 'legal']
const INFO_ICON: Record<string, React.ReactNode> = { process: <IFlow />, security: <ILock />, legal: <IScale /> }

export function DocsList() {
  const { pop, push } = useApp()
  return (
    <div className="screen sub">
      <TopBar title="Документы" onBack={pop} />
      <h2 className="section" style={{ marginTop: 4 }}>О сервисе</h2>
      <div className="list stagger">
        {DOCS.filter((d) => INFO_IDS.includes(d.id)).map((d) => (
          <Item key={d.id} icon={INFO_ICON[d.id]} title={d.title} onClick={() => push({ name: 'doc', id: d.id })} />
        ))}
      </div>
      <h2 className="section">Правовые документы</h2>
      <div className="list stagger">
        {DOCS.filter((d) => !INFO_IDS.includes(d.id)).map((d) => (
          <Item key={d.id} icon={<IDoc />} title={d.title} sub={`Редакция от ${d.updated}`} onClick={() => push({ name: 'doc', id: d.id })} />
        ))}
      </div>
    </div>
  )
}

export function DocView({ id }: { id: string }) {
  const { pop } = useApp()
  const d = DOCS.find((x) => x.id === id) ?? DOCS[0]
  if (id === 'process')
    return (
      <div className="screen sub">
        <TopBar title={d.title} onBack={pop} />
        <div className="card hero-soft info-hero rise">
          <div className="glow-icon"><IFlow size={44} /></div>
          <div style={{ fontSize: 19, fontWeight: 600, marginTop: 12 }}>Прозрачно на каждом шаге</div>
          <div className="small muted mt8">Статус заявки обновляется в приложении, а бот присылает уведомления.</div>
        </div>
        <div className="card mt12 flow stagger">
          {d.sections.map((s, i) => (
            <div key={i} className="flow-step">
              <div className="n">{i + 1}</div>
              <div>
                <b>{s.h?.replace(/^\d+\.\s*/, '')}</b>
                {s.p.map((p, j) => (
                  <div key={j} className="small muted" style={{ lineHeight: 1.55 }}>{p}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  return (
    <div className="screen sub">
      <TopBar title={d.title} onBack={pop} />
      {INFO_IDS.includes(id) && (
        <div className="card hero-soft info-hero rise" style={{ marginBottom: 12 }}>
          <div className="glow-icon">{id === 'security' ? <ILock size={44} /> : <IScale size={44} />}</div>
          <div style={{ fontSize: 19, fontWeight: 600, marginTop: 12 }}>{id === 'security' ? 'Ваши данные под защитой' : 'Каждая сделка оформлена'}</div>
        </div>
      )}
      <div className="card doc rise-1">
        <div className="xs faint">Редакция от {d.updated}</div>
        {d.sections.map((s, i) => (
          <div key={i}>
            {s.h && <h4>{s.h}</h4>}
            {s.p.map((p, j) => (
              <p key={j}>{p}</p>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Faq() {
  const { pop } = useApp()
  const [open, setOpen] = useState<number | null>(0)
  return (
    <div className="screen sub">
      <TopBar title="Частые вопросы" onBack={pop} />
      <div className="list">
        {FAQ.map((f, i) => (
          <div key={i} style={{ borderTop: i ? '1px solid var(--line)' : 0 }}>
            <button className="list-item" style={{ borderTop: 0 }} onClick={() => setOpen(open === i ? null : i)}>
              <div className="grow" style={{ fontWeight: 600 }}>{f.q}</div>
              <IDown size={18} className="chev" style={{ transform: open === i ? 'rotate(180deg)' : '', transition: 'transform .35s cubic-bezier(.22,1,.36,1)' }} />
            </button>
            <div className={`acc ${open === i ? 'open' : ''}`} aria-hidden={open !== i}>
              <div>
                <div className="small muted" style={{ padding: '0 16px 16px', lineHeight: 1.55 }}>{f.a}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button className="btn btn-ghost mt16" onClick={() => openTgLink(`https://t.me/${CONFIG.supportUsername}`)}>
        Не нашли ответ? Напишите нам
      </button>
    </div>
  )
}

export function Install() {
  const { pop } = useApp()
  const toast = useToast()
  const url = location.origin
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const steps = ios
    ? [
        inTelegram ? 'Скопируйте ссылку ниже и откройте её в Safari (не в Telegram).' : 'Откройте эту страницу в Safari.',
        'Нажмите «Поделиться» внизу экрана (квадрат со стрелкой).',
        'Выберите «На экран Домой» и нажмите «Добавить».',
        'Откройте NEX с главного экрана и войдите по номеру телефона: код придёт в Telegram.',
      ]
    : [
        inTelegram ? 'Скопируйте ссылку ниже и откройте её в Chrome.' : 'Откройте эту страницу в Chrome.',
        'Откройте меню браузера (три точки).',
        'Выберите «Установить приложение» или «Добавить на главный экран».',
        'Откройте NEX с главного экрана и войдите по номеру телефона: код придёт в Telegram.',
      ]
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast('Ссылка скопирована')
    } catch {
      toast(url)
    }
  }
  return (
    <div className="screen sub">
      <TopBar title="Установка на телефон" onBack={pop} />
      {inTelegram && (
        <div className="card notice rise">
          Ярлык из меню Telegram открывает сам Telegram. Чтобы NEX запускался как отдельное приложение, установите его из браузера.
        </div>
      )}
      <div className="card mt12 rise-1">
        {steps.map((s, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-start', padding: '9px 0' }}>
            <div className="step-num">{i + 1}</div>
            <div className="grow" style={{ paddingTop: 3 }}>{s}</div>
          </div>
        ))}
      </div>
      <div className="ref-link mt12 rise-2">
        <span className="grow ellipsis">{url.replace(/^https:\/\//, '')}</span>
        <button className="icon-btn" aria-label="Скопировать" onClick={copy}>
          <ICopy size={18} />
        </button>
      </div>
      {inTelegram && (
        <button className="btn btn-ghost mt12" onClick={() => openLink(url)}>
          Открыть в браузере
        </button>
      )}
    </div>
  )
}
