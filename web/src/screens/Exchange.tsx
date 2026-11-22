import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { Coin, Sheet, TopBar, useToast } from '../components/ui'
import { CurrencyPicker } from '../components/CurrencyPicker'
import { IDown, ISwap, ICheck } from '../components/Icons'
import { cur, type CurrencyCode } from '../lib/currencies'
import { crossRate } from '../lib/market'
import { fmtAmount, fmtMoney, parseNum, rateLabel } from '../lib/format'
import { api, type Order } from '../lib/api'
import { CONFIG } from '../config'
import { haptic, inTelegram, requestContact } from '../lib/tg'

const METHODS: { id: string; label: string; hint: string }[] = [
  { id: 'cash', label: 'Наличные', hint: 'Встреча в офисе или в городе' },
  { id: 'card', label: 'На карту', hint: 'Перевод на банковскую карту' },
  { id: 'wallet', label: 'На кошелёк', hint: 'Перевод на криптокошелёк' },
]

export function Exchange() {
  const { market, exchangePreset, push, refreshOrders, user } = useApp()
  const toast = useToast()
  const [from, setFrom] = useState<CurrencyCode>(exchangePreset?.from ?? 'KZT')
  const [to, setTo] = useState<CurrencyCode>(exchangePreset?.to ?? 'USD')
  const [amountStr, setAmountStr] = useState('')
  const [lastEdited, setLastEdited] = useState<'from' | 'to'>('from')
  const [receiveStr, setReceiveStr] = useState('')
  const [method, setMethod] = useState('cash')
  const [details, setDetails] = useState('')
  const [note, setNote] = useState('')
  const [agree, setAgree] = useState(false)
  const [picker, setPicker] = useState<'from' | 'to' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<Order | null>(null)

  useEffect(() => {
    if (exchangePreset?.from) setFrom(exchangePreset.from)
    if (exchangePreset?.to) setTo(exchangePreset.to)
  }, [exchangePreset])

  useEffect(() => {
    // Для криптовалюты по умолчанию предлагаем перевод на кошелёк
    if (cur(to).type === 'crypto') setMethod('wallet')
    else if (method === 'wallet') setMethod('cash')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to])

  const rate = crossRate(market, from, to)
  const k = 1 - CONFIG.feePct / 100
  const amount = lastEdited === 'from' ? parseNum(amountStr) : parseNum(receiveStr) / rate / k
  const gross = amount * rate
  const fee = gross * (1 - k)
  const receive = gross - fee
  const fromShown = lastEdited === 'from' ? amountStr : amount ? trim(amount, cur(from).decimals) : ''
  const toShown = lastEdited === 'to' ? receiveStr : receive ? trim(receive, cur(to).decimals) : ''

  const swap = () => {
    haptic('select')
    setFrom(to)
    setTo(from)
    setAmountStr(fromShown ? trim(amount * rate * k, cur(to).decimals) : '')
    setLastEdited('from')
  }

  const amountKzt = amount * crossRate(market, from, 'KZT')
  const verified = user?.kyc_status === 'verified'
  const maxKzt = verified ? CONFIG.maxKztVerified : CONFIG.maxKzt
  const limitErr =
    amount > 0 && amountKzt < CONFIG.minKzt
      ? `Минимальная сумма заявки ${fmtAmount(CONFIG.minKzt / crossRate(market, from, 'KZT'), from)} ${from} (${fmtAmount(CONFIG.minKzt, 'KZT')} ₸)`
      : amountKzt > maxKzt
        ? `Максимум ${fmtAmount(maxKzt / crossRate(market, from, 'KZT'), from)} ${from} за заявку${verified ? '' : '. Пройдите верификацию, чтобы увеличить лимит до ' + fmtAmount(CONFIG.maxKztVerified, 'KZT') + ' ₸'}`
        : ''
  const valid = amount > 0 && from !== to && agree && !limitErr

  const submit = async () => {
    setSending(true)
    try {
      // Если у пользователя нет @username, предложим поделиться номером, чтобы оператор мог связаться
      if (inTelegram && !user?.username && !user?.phone) await requestContact()
      const o = await api.createOrder({
        from,
        to,
        amount: Number(amount.toFixed(cur(from).decimals)),
        method: METHODS.find((m) => m.id === method)!.label,
        details: details.trim() || undefined,
        note: note.trim() || undefined,
      })
      haptic('success')
      setConfirm(false)
      setDone(o)
      setAmountStr('')
      setReceiveStr('')
      setDetails('')
      setNote('')
      refreshOrders()
    } catch (e) {
      haptic('error')
      toast((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="screen">
      <TopBar title="Обмен" />

      <div className="card">
        <div className="small muted">Отдаёте</div>
        <div className="row mt12">
          <button className="row" style={{ gap: 8 }} onClick={() => setPicker('from')}>
            <Coin code={from} size="sm" />
            <span style={{ fontWeight: 600, fontSize: 17 }}>{from}</span>
            <IDown size={16} className="muted" />
          </button>
          <input
            className="grow right"
            inputMode="decimal"
            placeholder="0"
            value={fromShown}
            onChange={(e) => {
              setAmountStr(clean(e.target.value))
              setLastEdited('from')
            }}
            style={amountInput}
          />
        </div>
        <div className="xs faint right mt8">{cur(from).name}</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', margin: '-14px 0', position: 'relative', zIndex: 2 }}>
        <button
          onClick={swap}
          aria-label="Поменять местами"
          style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(160deg,#8f2434,#5b0f1f)', border: '3px solid var(--bg)', display: 'grid', placeItems: 'center' }}
        >
          <ISwap size={20} style={{ transform: 'rotate(90deg)' }} />
        </button>
      </div>

      <div className="card" style={{ marginTop: 0 }}>
        <div className="small muted">Получаете</div>
        <div className="row mt12">
          <button className="row" style={{ gap: 8 }} onClick={() => setPicker('to')}>
            <Coin code={to} size="sm" />
            <span style={{ fontWeight: 600, fontSize: 17 }}>{to}</span>
            <IDown size={16} className="muted" />
          </button>
          <input
            className="grow right"
            inputMode="decimal"
            placeholder="0"
            value={toShown}
            onChange={(e) => {
              setReceiveStr(clean(e.target.value))
              setLastEdited('to')
            }}
            style={amountInput}
          />
        </div>
        <div className="xs faint right mt8">{cur(to).name}</div>
      </div>

      <div className="card mt12" style={{ padding: '6px 16px' }}>
        <div className="kv">
          <span className="k">Курс</span>
          <span className="v">
            {rateLabel(from, to, rate)}
          </span>
        </div>
        <div className="kv">
          <span className="k">Комиссия сервиса {CONFIG.feePct}%</span>
          <span className="v">{amount ? fmtMoney(fee, to) : '0'}</span>
        </div>
        <div className="kv">
          <span className="k">Вы получите</span>
          <span className="v" style={{ fontWeight: 700, fontSize: 16 }}>
            {amount ? fmtMoney(receive, to) : '0'}
          </span>
        </div>
      </div>

      {limitErr && (
        <div className="small mt8" style={{ color: 'var(--amber)', padding: '0 4px' }}>
          {limitErr}
          {!verified && amountKzt > maxKzt && (
            <button style={{ color: 'var(--accent)', textDecoration: 'underline', marginLeft: 6 }} onClick={() => push({ name: 'kyc' })}>
              Пройти
            </button>
          )}
        </div>
      )}

      <h2 className="section" style={{ marginTop: 22 }}>Способ получения</h2>
      <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
        {METHODS.map((m) => (
          <button key={m.id} className={`chip ${method === m.id ? 'on' : ''}`} onClick={() => setMethod(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="xs faint mt8" style={{ marginLeft: 4 }}>{METHODS.find((m) => m.id === method)?.hint}</div>

      <label className="field">
        <span>{method === 'wallet' ? 'Адрес кошелька и сеть' : method === 'card' ? 'Банк получателя' : 'Город'} (необязательно)</span>
        <input
          className="input"
          value={details}
          maxLength={200}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={method === 'wallet' ? 'Например, TRC20 T...' : method === 'card' ? 'Например, Kaspi' : 'Например, Алматы'}
        />
      </label>
      <label className="field">
        <span>Комментарий для оператора</span>
        <textarea className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Удобное время для связи и другие детали" />
      </label>

      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          Я принимаю{' '}
          <a onClick={(e) => (e.preventDefault(), push({ name: 'doc', id: 'offer' }))} href="#">
            публичную оферту
          </a>
          ,{' '}
          <a onClick={(e) => (e.preventDefault(), push({ name: 'doc', id: 'rules' }))} href="#">
            правила обмена
          </a>{' '}
          и{' '}
          <a onClick={(e) => (e.preventDefault(), push({ name: 'doc', id: 'aml' }))} href="#">
            политику AML/KYC
          </a>
        </span>
      </label>

      <button className="btn btn-primary mt16" disabled={!valid} onClick={() => setConfirm(true)}>
        Перевести
      </button>
      {!amount && <div className="xs faint mt8" style={{ textAlign: 'center' }}>Введите сумму, чтобы увидеть итог</div>}

      <CurrencyPicker open={picker === 'from'} onClose={() => setPicker(null)} value={from} exclude={to} onPick={setFrom} title="Отдаёте" />
      <CurrencyPicker open={picker === 'to'} onClose={() => setPicker(null)} value={to} exclude={from} onPick={setTo} title="Получаете" />

      <Sheet open={confirm} onClose={() => !sending && setConfirm(false)} title="Подтвердите заявку">
        <div className="row" style={{ justifyContent: 'center', gap: 14, margin: '6px 0 18px' }}>
          <Coin code={from} size="lg" />
          <ISwap />
          <Coin code={to} size="lg" />
        </div>
        <div className="card" style={{ padding: '6px 16px' }}>
          <div className="kv"><span className="k">Отдаёте</span><span className="v">{fmtMoney(amount, from)}</span></div>
          <div className="kv"><span className="k">Курс</span><span className="v">{rateLabel(from, to, rate)}</span></div>
          <div className="kv"><span className="k">Комиссия {CONFIG.feePct}%</span><span className="v">{fmtMoney(fee, to)}</span></div>
          <div className="kv"><span className="k">Способ</span><span className="v">{METHODS.find((m) => m.id === method)?.label}</span></div>
          <div className="kv"><span className="k">Вы получите</span><span className="v" style={{ fontWeight: 700 }}>{fmtMoney(receive, to)}</span></div>
        </div>
        <p className="small muted" style={{ margin: '14px 4px' }}>
          После отправки оператор примет заявку и напишет вам в Telegram, чтобы согласовать детали. Курс фиксируется на 30 минут.
        </p>
        <button className="btn btn-primary" onClick={submit} disabled={sending}>
          {sending ? 'Отправляем…' : 'Отправить заявку'}
        </button>
      </Sheet>

      <Sheet open={!!done} onClose={() => setDone(null)}>
        <div style={{ textAlign: 'center', padding: '10px 6px 4px' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', margin: '0 auto 16px', display: 'grid', placeItems: 'center', background: 'linear-gradient(160deg,#8f2434,#5b0f1f)' }}>
            <ICheck size={34} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>Заявка №{done?.id} отправлена</div>
          <p className="muted small" style={{ margin: '10px 0 20px' }}>
            Оператор уже получил уведомление. Как только он примет заявку, вам придёт сообщение от бота, а статус обновится здесь.
          </p>
          {done && (
            <div className="card" style={{ padding: '6px 16px', textAlign: 'left' }}>
              <div className="kv"><span className="k">Вы отдаёте</span><span className="v">{fmtMoney(done.amount_from, done.from_cur)}</span></div>
              <div className="kv"><span className="k">Вы получите</span><span className="v">{fmtMoney(done.amount_to, done.to_cur)}</span></div>
            </div>
          )}
          <button
            className="btn btn-primary mt16"
            onClick={() => {
              const id = done!.id
              setDone(null)
              push({ name: 'order', id })
            }}
          >
            Открыть заявку
          </button>
        </div>
      </Sheet>
    </div>
  )
}

const amountInput: React.CSSProperties = {
  background: 'none',
  border: 0,
  outline: 'none',
  fontSize: 24,
  fontWeight: 600,
  minWidth: 0,
  width: '100%',
}

function clean(s: string) {
  return s.replace(/[^\d.,]/g, '').replace(',', '.').replace(/(\..*)\./g, '$1')
}
function trim(n: number, dp: number) {
  return String(Number(n.toFixed(Math.min(dp, n >= 1000 ? 2 : dp))))
}
