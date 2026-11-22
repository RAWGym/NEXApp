import { useState } from 'react'
import { useApp } from '../store'
import { TopBar } from '../components/ui'
import { DOCS, FAQ } from '../docs'
import { Item } from './Profile'
import { IDoc, IDown } from '../components/Icons'
import { CONFIG } from '../config'
import { openTgLink } from '../lib/tg'

export function DocsList() {
  const { pop, push } = useApp()
  return (
    <div className="screen sub">
      <TopBar title="Документы" onBack={pop} />
      <div className="list">
        {DOCS.map((d) => (
          <Item key={d.id} icon={<IDoc />} title={d.title} sub={`Редакция от ${d.updated}`} onClick={() => push({ name: 'doc', id: d.id })} />
        ))}
      </div>
    </div>
  )
}

export function DocView({ id }: { id: string }) {
  const { pop } = useApp()
  const d = DOCS.find((x) => x.id === id) ?? DOCS[0]
  return (
    <div className="screen sub">
      <TopBar title={d.title} onBack={pop} />
      <div className="card doc">
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
              <IDown size={18} className="chev" style={{ transform: open === i ? 'rotate(180deg)' : '', transition: 'transform .2s' }} />
            </button>
            {open === i && <div className="small muted" style={{ padding: '0 16px 16px', lineHeight: 1.55 }}>{f.a}</div>}
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
  const steps = [
    'Откройте эту страницу в Safari.',
    'Нажмите кнопку «Поделиться» внизу экрана (квадрат со стрелкой).',
    'Выберите «На экран Домой».',
    'Нажмите «Добавить». Иконка NEX появится на главном экране.',
  ]
  return (
    <div className="screen sub">
      <TopBar title="Установка на iPhone" onBack={pop} />
      <div className="card">
        {steps.map((s, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-start', padding: '8px 0' }}>
            <div className="coin sm" style={{ background: 'linear-gradient(160deg,#8f2434,#5b0f1f)', fontSize: 13 }}>{i + 1}</div>
            <div className="grow" style={{ paddingTop: 4 }}>{s}</div>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ margin: '14px 6px' }}>
        На Android откройте меню браузера Chrome и выберите «Установить приложение».
      </p>
    </div>
  )
}
