import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { Coin, Sheet, TopBar, useToast } from '../components/ui'
import { CurrencyPicker } from '../components/CurrencyPicker'
import { IDown, ISwap, ICheck, IClock } from '../components/Icons'
import { cur, type CurrencyCode } from '../lib/currencies'
import { crossRate } from '../lib/market'
import { fmtAmount, fmtMoney, parseNum, rateLabel } from '../lib/format'
import { api, ApiError, ORDER_COOLDOWN_SEC, type Order } from '../lib/api'
import { CONFIG } from '../config'
import { haptic } from '../lib/tg'
import { pricing, BONUS_MAX_SHARE } from '../lib/pricing'
import { ProfileForm } from '../components/ProfileForm'
import { IGift, IId, IShieldCheck } from '../components/Icons'

const METHODS: { id: string; label: string; hint: string }[] = [
  { id: 'cash', label: 'Наличные', hint: 'Встреча в офисе или в городе' },
  { id: 'card', label: 'На карту', hint: 'Перевод на банковскую карту' },
  { id: 'wallet', label: 'На кошелёк', hint: 'Перевод на криптокошелёк' },
]

export function Exchange() {
  const { market, exchangePreset, push, refreshOrders, user, orders } = useApp()
  const [dupId, setDupId] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  // Пауза между заявками: считаем от последней созданной
  const lastCreated = orders.reduce((m, o) => Math.max(m, new Date(o.created_at).getTime()), 0)
  const cooldownLeft = Math.max(0, Math.ceil((lastCreated + ORDER_COOLDOWN_SEC * 1000 - now) / 1000))
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
  const [useBonus, setUseBonus] = useState(true)
  const [needProfile, setNeedProfile] = useState(false)
  const [needKyc, setNeedKyc] = useState(false)

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
  const loy = user?.loyalty
  // Комиссия зависит от суммы (скидка на крупные суммы), поэтому при вводе «получаю» подбираем сумму за пару итераций
  const priceFor = (amt: number) => pricing(loy?.volume_kzt ?? 0, amt * crossRate(market, from, 'KZT'), !!loy?.welcome)
  let amount = parseNum(amountStr)
  if (lastEdited === 'to') {
    const want = parseNum(receiveStr)
    let fp = CONFIG.feePct
    for (let i = 0; i < 3; i++) {
      amount = want / rate / (1 - fp / 100)
      fp = priceFor(amount).fee
    }
  }
  const price = priceFor(amount)
  const k = 1 - price.fee / 100
  const gross = amount * rate
  const fee = gross * (1 - k)
  const feeKzt = fee * crossRate(market, to, 'KZT')
  const bonusKzt = useBonus && loy ? Math.floor(Math.min(loy.bonus_kzt, feeKzt * BONUS_MAX_SHARE)) : 0
  const bonusTo = bonusKzt * crossRate(market, 'KZT', to)
  const receive = gross - fee + bonusTo
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
  const limitErr =
    amount > 0 && amountKzt < CONFIG.minKzt
      ? `Минимальная сумма заявки ${fmtAmount(CONFIG.minKzt / crossRate(market, from, 'KZT'), from)} ${from} (${fmtAmount(CONFIG.minKzt, 'KZT')} ₸)`
      : amountKzt > CONFIG.maxKztVerified
        ? `Максимум ${fmtAmount(CONFIG.maxKztVerified / crossRate(market, from, 'KZT'), from)} ${from} за заявку`
        : ''
  const valid = amount > 0 && from !== to && agree && !limitErr
  const docsNeeded = !verified && amountKzt > CONFIG.maxKzt && amountKzt <= CONFIG.maxKztVerified

  const submit = async () => {
    setSending(true)
    try {
      const o = await api.createOrder({
        from,
        to,
        amount: Number(amount.toFixed(cur(from).decimals)),
        method: METHODS.find((m) => m.id === method)!.label,
        details: details.trim() || undefined,
        note: note.trim() || undefined,
        use_bonus: bonusKzt > 0,
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
      setConfirm(false)
      if (e instanceof ApiError && e.data.code === 'duplicate') setDupId(Number(e.data.order_id))
      else if (e instanceof ApiError && e.data.code === 'profile') setNeedProfile(true)
      else if (e instanceof ApiError && e.data.code === 'kyc') setNeedKyc(true)
      else toast((e as Error).message)
      if (e instanceof ApiError && e.data.code === 'cooldown') refreshOrders()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="screen">
      <TopBar title="Обмен" />

      <div className="card rise">
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

      <div className="card rise-1" style={{ marginTop: 0 }}>
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

      <div className="card mt12 rise-2" style={{ padding: '6px 16px' }}>
        <div className="kv">
          <span className="k">Курс</span>
          <span className="v">
            {rateLabel(from, to, rate)}
          </span>
        </div>
        <div className="kv">
          <span className="k">
            Комиссия {price.fee !== CONFIG.feePct && <s className="faint">{CONFIG.feePct}%</s>} {price.fee}%
          </span>
          <span className="v">{amount ? fmtMoney(fee, to) : '0'}</span>
        </div>
        {price.discounts.map((d) => (
          <div className="kv disc" key={d.id}>
            <span className="k">{d.label}</span>
            <span className="v">−{d.off}%</span>
          </div>
        ))}
        {!!loy?.bonus_kzt && (
          <div className="kv">
            <label className="k row" style={{ gap: 8 }}>
              <span className={`switch ${useBonus ? 'on' : ''}`} onClick={() => setUseBonus(!useBonus)} role="switch" aria-checked={useBonus}>
                <i />
              </span>
              <span>
                <IGift size={15} style={{ verticalAlign: -2 }} /> Списать бонусы
              </span>
            </label>
            <span className="v">{bonusKzt ? `+${fmtMoney(bonusTo, to)}` : `${fmtAmount(loy.bonus_kzt, 'KZT')} ₸`}</span>
          </div>
        )}
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
        </div>
      )}
      {docsNeeded && (
        <button className="notice-row mt8" onClick={() => push({ name: 'kyc' })}>
          <IShieldCheck size={18} />
          <span className="grow">
            Для суммы больше {fmtAmount(CONFIG.maxKzt, 'KZT')} ₸ нужно подтвердить документ.{' '}
            {user?.kyc_status === 'pending' ? 'Документы на проверке.' : 'Это займёт пару минут.'}
          </span>
          {user?.kyc_status !== 'pending' && <span className="link-btn">Пройти</span>}
        </button>
      )}
      {!user?.profile_done && amount > 0 && (
        <button className="notice-row mt8" onClick={() => setNeedProfile(true)}>
          <IId size={18} />
          <span className="grow">Перед первой заявкой укажите ФИО, телефон и дату рождения</span>
          <span className="link-btn">Указать</span>
        </button>
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

      <button
        className="btn btn-primary mt16"
        disabled={!valid || cooldownLeft > 0 || docsNeeded}
        onClick={() => {
          if (!user?.profile_done) return setNeedProfile(true)
          const dup = orders.find(
            (o) => (o.status === 'new' || o.status === 'accepted') && o.from_cur === from && o.to_cur === to && Math.abs(o.amount_from - amount) <= amount * 0.01,
          )
          if (dup) return setDupId(dup.id)
          setConfirm(true)
        }}
      >
        {cooldownLeft > 0 ? `Новая заявка через ${Math.floor(cooldownLeft / 60)}:${String(cooldownLeft % 60).padStart(2, '0')}` : 'Перевести'}
      </button>
      {cooldownLeft > 0 && (
        <div className="xs faint mt8" style={{ textAlign: 'center' }}>Чтобы избежать повторов, новую заявку можно отправить раз в 5 минут</div>
      )}
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
          <div className="kv"><span className="k">Комиссия {price.fee}%</span><span className="v">{fmtMoney(fee, to)}</span></div>
          {bonusKzt > 0 && <div className="kv disc"><span className="k">Оплачено бонусами</span><span className="v">+{fmtMoney(bonusTo, to)}</span></div>}
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

      <Sheet open={needProfile} onClose={() => setNeedProfile(false)} title="Данные для заявки">
        <p className="small muted" style={{ margin: '0 4px 4px' }}>Нужны один раз, чтобы оператор знал, с кем проводит сделку.</p>
        <ProfileForm compact onSaved={() => setNeedProfile(false)} />
      </Sheet>

      <Sheet open={needKyc} onClose={() => setNeedKyc(false)} title="Подтвердите документ">
        <p className="small muted" style={{ margin: '0 4px 16px' }}>
          Для обмена больше {fmtAmount(CONFIG.maxKzt, 'KZT')} ₸ нужна проверка документа: данные и фото удостоверения, паспорта или ВНЖ и селфи с документом. Около 3 минут.
        </p>
        <button className="btn btn-primary" onClick={() => (setNeedKyc(false), push({ name: 'kyc' }))}>Пройти проверку</button>
      </Sheet>

      <Sheet open={dupId != null} onClose={() => setDupId(null)}>
        <div style={{ textAlign: 'center', padding: '10px 6px 4px' }}>
          <div className="glow-icon" style={{ justifyContent: 'center', width: '100%' }}>
            <IClock size={52} style={{ color: 'var(--amber)' }} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, marginTop: 12 }}>Заявка уже на рассмотрении</div>
          <p className="muted small" style={{ margin: '10px 0 20px' }}>
            Такая же заявка №{dupId} уже отправлена оператору. Повторно отправлять не нужно: оператор свяжется с вами в Telegram.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              const id = dupId!
              setDupId(null)
              push({ name: 'order', id })
            }}
          >
            Открыть заявку №{dupId}
          </button>
          <button className="btn btn-ghost mt12" onClick={() => setDupId(null)}>Понятно</button>
        </div>
      </Sheet>

      <Sheet open={!!done} onClose={() => setDone(null)}>
        <div style={{ textAlign: 'center', padding: '10px 6px 4px' }}>
          <div className="pop-in" style={{ width: 72, height: 72, borderRadius: '50%', margin: '0 auto 16px', display: 'grid', placeItems: 'center', background: 'linear-gradient(160deg,#8f2434,#5b0f1f)' }}>
            <ICheck size={34} className="check-draw" strokeWidth={2.2} />
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
