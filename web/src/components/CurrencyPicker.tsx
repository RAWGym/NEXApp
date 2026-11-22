import { useState } from 'react'
import { Coin, Sheet } from './ui'
import { CURRENCIES, type CurrencyCode } from '../lib/currencies'
import { ICheck } from './Icons'

export function CurrencyPicker({
  open,
  onClose,
  value,
  exclude,
  onPick,
  title,
}: {
  open: boolean
  onClose: () => void
  value: CurrencyCode
  exclude?: CurrencyCode
  onPick: (c: CurrencyCode) => void
  title: string
}) {
  const [q, setQ] = useState('')
  const list = CURRENCIES.filter(
    (c) => c.code !== exclude && (c.code.toLowerCase().includes(q.toLowerCase()) || c.name.toLowerCase().includes(q.toLowerCase())),
  )
  const group = (t: 'fiat' | 'crypto') => list.filter((c) => c.type === t)
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <input className="input" placeholder="Поиск валюты" value={q} onChange={(e) => setQ(e.target.value)} />
      {(['fiat', 'crypto'] as const).map((t) =>
        group(t).length ? (
          <div key={t}>
            <div className="xs faint" style={{ margin: '16px 4px 8px', textTransform: 'uppercase', letterSpacing: 1 }}>
              {t === 'fiat' ? 'Валюты' : 'Криптовалюты'}
            </div>
            <div className="list">
              {group(t).map((c) => (
                <button
                  key={c.code}
                  className="list-item"
                  onClick={() => {
                    onPick(c.code)
                    onClose()
                    setQ('')
                  }}
                >
                  <Coin code={c.code} />
                  <div className="grow">
                    <div className="title">{c.code}</div>
                    <div className="sub">{c.name}</div>
                  </div>
                  {c.code === value && <ICheck />}
                </button>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </Sheet>
  )
}
