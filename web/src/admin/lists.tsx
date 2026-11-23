import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type KycFull, type KycRow, type Order, type Page, type UserFull, type UserRow } from './api'
import type { PageProps } from './pages'
import { Confirm, DOC_NAME, Drawer, Ico, KYC_ST, Modal, ORDER_ST, Seg, Skel, ago, amt, dOnly, dt, initials, kzt, nf, short, useToast, userName } from './ui'

/* ---------------- общие части ---------------- */
function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v)
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms)
    return () => clearTimeout(t)
  }, [v, ms])
  return d
}
function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <Ico.search />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={40} />
    </label>
  )
}
function Pager({ p, onPage }: { p: Page<unknown>; onPage: (n: number) => void }) {
  const size = p.size ?? 50
  const pages = Math.max(1, Math.ceil(p.total / size))
  return (
    <div className="pager">
      <span>
        {p.total ? `${nf(p.page * size + 1)}–${nf(Math.min(p.total, (p.page + 1) * size))} из ${nf(p.total)}` : 'Ничего не найдено'}
      </span>
      <div>
        <button className="btn ghost sm" disabled={p.page <= 0} onClick={() => onPage(p.page - 1)}>Назад</button>
        <button className="btn ghost sm" disabled={p.page >= pages - 1} onClick={() => onPage(p.page + 1)}>Дальше</button>
      </div>
    </div>
  )
}
function Rows({ n = 8, cols = 6 }: { n?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: n }, (_, i) => (
        <tr key={i} style={{ cursor: 'default' }}>
          {Array.from({ length: cols }, (_, j) => (
            <td key={j}><Skel h={14} w={j === 0 ? 50 : '80%'} /></td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}
const Empty = ({ text }: { text: string }) => (
  <div className="empty">
    <Ico.inbox />
    {text}
  </div>
)
const KycBadge = ({ s }: { s: string }) => <span className={`st ${s}`}>{KYC_ST[s] ?? s}</span>
const handle = (u: { username?: string | null; id: number }) => (u.username ? '@' + u.username : 'ID ' + u.id)

/* ---------------- заявки ---------------- */
export function Orders({ me, nav, setNav, tick }: PageProps) {
  const toast = useToast()
  const [status, setStatus] = useState('open')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<Page<Order> | null>(null)
  const [busy, setBusy] = useState(false)
  const openId = nav.open?.kind === 'order' ? nav.open.id : null

  const load = useCallback(() => {
    setBusy(true)
    api
      .orders({ status, q: dq, page })
      .then(setData)
      .catch((e) => toast({ title: (e as Error).message, kind: 'bad' }))
      .finally(() => setBusy(false))
  }, [status, dq, page, toast])
  useEffect(load, [load, tick])
  useEffect(() => setPage(0), [status, dq])

  const exportCsv = async () => {
    try {
      const b = await api.ordersCsv({ status, q: dq })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = `nex-orders-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) {
      toast({ title: (e as Error).message, kind: 'bad' })
    }
  }

  return (
    <>
      <div className="toolbar">
        <Seg
          value={status}
          onChange={setStatus}
          options={[
            { id: 'open', label: 'Открытые' },
            { id: 'new', label: 'Новые' },
            { id: 'accepted', label: 'В работе' },
            { id: 'completed', label: 'Завершённые' },
            { id: 'rejected', label: 'Отклонённые' },
            { id: 'all', label: 'Все' },
          ]}
        />
        <div className="grow" />
        <Search value={q} onChange={(v) => setQ(v.replace(/\D/g, ''))} placeholder="Номер заявки или ID клиента" />
        {me.perms.includes('orders.export') && (
          <button className="btn ghost" onClick={exportCsv}>
            <Ico.down /> CSV
          </button>
        )}
      </div>
      <div className="card flat rise">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>№</th>
                <th>Клиент</th>
                <th>Обмен</th>
                <th className="r">В тенге</th>
                <th>Способ</th>
                <th>Статус</th>
                <th>Создана</th>
              </tr>
            </thead>
            {!data ? (
              <Rows cols={7} />
            ) : (
              <tbody style={{ opacity: busy ? 0.6 : 1, transition: 'opacity .2s' }}>
                {data.rows.map((o) => (
                  <tr key={o.id} onClick={() => setNav({ page: 'orders', open: { kind: 'order', id: o.id } })}>
                    <td className="mono">#{o.id}</td>
                    <td>
                      <div className="who">
                        <span className="avatar sm">{initials(o.user?.first_name, o.user?.last_name)}</span>
                        <span>
                          <b>{userName(o.user)}</b>
                          <small>{o.user ? handle(o.user) : ''}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <b>{amt(o.amount_from, o.from_cur)}</b>
                      <div className="sub">→ {amt(o.amount_to, o.to_cur)}</div>
                    </td>
                    <td className="r">{o.amount_kzt != null ? kzt(o.amount_kzt) : ''}</td>
                    <td className="muted">{o.method}</td>
                    <td><span className={`st ${o.status}`}>{ORDER_ST[o.status]}</span></td>
                    <td className="muted">{ago(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
          {data && !data.rows.length && <Empty text="Заявок нет" />}
        </div>
        {data && <Pager p={data} onPage={setPage} />}
      </div>
      <OrderDrawer
        id={openId}
        me={me}
        onClose={() => setNav({ page: 'orders' })}
        onUser={(uid) => setNav({ page: 'users', open: { kind: 'user', id: uid } })}
        onChanged={load}
      />
    </>
  )
}

function OrderDrawer({ id, me, onClose, onUser, onChanged }: { id: number | null; me: PageProps['me']; onClose: () => void; onUser: (id: number) => void; onChanged: () => void }) {
  const toast = useToast()
  const [o, setO] = useState<Order | null>(null)
  const [ask, setAsk] = useState<'accept' | 'complete' | 'reject' | null>(null)
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (id == null) return
    last.current = id
    setO(null)
    api.order(id).then(setO).catch((e) => toast({ title: (e as Error).message, kind: 'bad' }))
  }, [id, toast])
  const act = async (a: 'accept' | 'complete' | 'reject', note: string) => {
    try {
      const r = await api.orderAct(o!.id, a, note)
      setO({ ...o!, ...r, user: o!.user })
      toast({ title: a === 'accept' ? `Заявка #${o!.id} принята` : a === 'complete' ? `Заявка #${o!.id} завершена` : `Заявка #${o!.id} отклонена`, kind: a === 'reject' ? 'warn' : 'good', text: 'Клиент получил уведомление' })
      onChanged()
    } catch (e) {
      toast({ title: (e as Error).message, kind: 'bad' })
    }
  }
  const canAct = me.perms.includes('orders.act')
  const foot =
    o && canAct && (o.status === 'new' || o.status === 'accepted') ? (
      <>
        <button className="btn danger" onClick={() => setAsk('reject')}>Отклонить</button>
        {o.status === 'new' ? (
          <button className="btn primary" onClick={() => setAsk('accept')}>Принять в работу</button>
        ) : (
          <button className="btn primary" onClick={() => setAsk('complete')}>Обмен выполнен</button>
        )}
      </>
    ) : undefined
  return (
    <>
      <Drawer open={id != null} onClose={onClose} title={`Заявка #${id ?? last.current}`} sub={o ? `${dt(o.created_at)} · ${ORDER_ST[o.status]}` : ''} foot={foot}>
        {!o ? (
          <div className="stack"><Skel h={90} /><Skel h={200} /></div>
        ) : (
          <>
            <div className="card" style={{ background: 'linear-gradient(140deg,#8f2434,#5b0f1f 60%,#3a0912)', marginBottom: 14 }}>
              <div className="xs" style={{ opacity: 0.75, fontWeight: 600 }}>Клиент отдаёт</div>
              <div className="big">{amt(o.amount_from, o.from_cur)}</div>
              <div className="xs mt12" style={{ opacity: 0.75, fontWeight: 600 }}>Клиент получает</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{amt(o.amount_to, o.to_cur)}</div>
            </div>
            <div className="kv">
              <div>Статус</div>
              <div><span className={`st ${o.status}`}>{ORDER_ST[o.status]}</span></div>
              <div>Курс</div>
              <div>{nf(o.rate, 6)}</div>
              <div>Комиссия</div>
              <div>{nf(o.fee_pct, 2)}% · {amt(o.fee_amount, o.to_cur)}</div>
              {!!o.bonus_used_kzt && (
                <>
                  <div>Оплачено бонусами</div>
                  <div>{kzt(o.bonus_used_kzt)}</div>
                </>
              )}
              <div>Эквивалент</div>
              <div>{o.amount_kzt != null ? kzt(o.amount_kzt) : 'нет'}</div>
              <div>Способ</div>
              <div>{o.method}</div>
              {o.details && (
                <>
                  <div>Реквизиты</div>
                  <div className="mono">{o.details}</div>
                </>
              )}
              {o.note && (
                <>
                  <div>Комментарий клиента</div>
                  <div>{o.note}</div>
                </>
              )}
              {o.admin_note && (
                <>
                  <div>Комментарий оператора</div>
                  <div>{o.admin_note}</div>
                </>
              )}
              {o.handled_by_name && (
                <>
                  <div>Обработал</div>
                  <div>{o.handled_by_name}</div>
                </>
              )}
            </div>
            <div className="sect">Клиент</div>
            {o.user && (
              <div className="kv">
                <div>Имя</div>
                <div>{userName(o.user)}</div>
                <div>Telegram</div>
                <div>{handle(o.user)}</div>
                <div>Телефон</div>
                <div>{o.user.phone ?? 'не указан'}</div>
                <div>Верификация</div>
                <div><KycBadge s={o.user.kyc_status} /></div>
              </div>
            )}
            {o.user && me.perms.includes('users.read') && (
              <button className="btn ghost block" onClick={() => onUser(o.user!.id)}>
                <Ico.user /> Карточка клиента
              </button>
            )}
            <div className="sect">История</div>
            <div className="checks">
              <div className="ok"><i>1</i>Создана<small>{dt(o.created_at)}</small></div>
              {o.accepted_at && <div className="ok"><i>2</i>Принята в работу<small>{dt(o.accepted_at)}</small></div>}
              {o.completed_at && <div className="ok"><i>✓</i>Завершена<small>{dt(o.completed_at)}</small></div>}
              {o.rejected_at && <div className="no"><i>×</i>Отклонена<small>{dt(o.rejected_at)}</small></div>}
            </div>
          </>
        )}
      </Drawer>
      {ask && o && (
        <Confirm
          title={ask === 'accept' ? `Принять заявку #${o.id}?` : ask === 'complete' ? `Отметить заявку #${o.id} выполненной?` : `Отклонить заявку #${o.id}?`}
          text={ask === 'complete' ? 'Сделайте это только после того, как клиент получил средства. Клиенту придёт уведомление, начислятся бонусы.' : ask === 'reject' ? 'Клиент увидит причину, бонусы вернутся на его счёт.' : 'Клиент получит уведомление, что заявка в работе.'}
          okText={ask === 'accept' ? 'Принять' : ask === 'complete' ? 'Выполнено' : 'Отклонить'}
          danger={ask === 'reject'}
          input={ask === 'reject' ? 'Причина для клиента' : 'Комментарий (необязательно)'}
          required={ask === 'reject'}
          onOk={(v) => act(ask, v)}
          onClose={() => setAsk(null)}
        />
      )}
    </>
  )
}

/* ---------------- пользователи ---------------- */
export function Users({ me, nav, setNav, tick }: PageProps) {
  const toast = useToast()
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('new')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<Page<UserRow> | null>(null)
  const openId = nav.open?.kind === 'user' ? nav.open.id : null

  const load = useCallback(() => {
    api
      .users({ filter: filter === 'all' ? undefined : filter, q: dq, sort, page })
      .then(setData)
      .catch((e) => toast({ title: (e as Error).message, kind: 'bad' }))
  }, [filter, dq, sort, page, toast])
  useEffect(load, [load, tick])
  useEffect(() => setPage(0), [filter, dq, sort])

  return (
    <>
      <div className="toolbar">
        <Seg
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'Все' },
            { id: 'verified', label: 'Верифицированы' },
            { id: 'pending', label: 'На проверке' },
            { id: 'noprofile', label: 'Без профиля' },
            { id: 'vip', label: 'От 1 млн ₸' },
            { id: 'blocked', label: 'Заблокированы' },
          ]}
        />
        <div className="grow" />
        <Search value={q} onChange={setQ} placeholder="Имя, @username, ID, телефон" />
        <select className="input" style={{ width: 190, height: 42 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка">
          <option value="new">Сначала новые</option>
          <option value="volume">По обороту</option>
          <option value="seen">По активности</option>
        </select>
      </div>
      <div className="card flat rise">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Телефон</th>
                <th>Верификация</th>
                <th className="r">Оборот</th>
                <th className="r">Бонусы</th>
                <th>Регистрация</th>
                <th>Был в сети</th>
              </tr>
            </thead>
            {!data ? (
              <Rows cols={7} />
            ) : (
              <tbody>
                {data.rows.map((u) => (
                  <tr key={u.id} onClick={() => setNav({ page: 'users', open: { kind: 'user', id: u.id } })}>
                    <td>
                      <div className="who">
                        <span className="avatar sm">{initials(u.first_name, u.last_name)}</span>
                        <span>
                          <b>
                            {userName(u)} {u.blocked && <span className="st blocked" style={{ marginLeft: 6 }}>Заблокирован</span>}
                          </b>
                          <small>{handle(u)}</small>
                        </span>
                      </div>
                    </td>
                    <td className="mono muted">{u.phone ?? ''}{u.phone_verified && <span className="good"> ✓</span>}</td>
                    <td><KycBadge s={u.kyc_status} /></td>
                    <td className="r">{u.volume_kzt ? short(u.volume_kzt) + ' ₸' : <span className="faint">0</span>}</td>
                    <td className="r muted">{nf(u.bonus_kzt)}</td>
                    <td className="muted">{dOnly(u.created_at)}</td>
                    <td className="muted">{ago(u.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
          {data && !data.rows.length && <Empty text="Никого не нашли" />}
        </div>
        {data && <Pager p={data} onPage={setPage} />}
      </div>
      <UserDrawer id={openId} me={me} onClose={() => setNav({ page: 'users' })} onOrder={(oid) => setNav({ page: 'orders', open: { kind: 'order', id: oid } })} onKyc={(uid) => setNav({ page: 'kyc', open: { kind: 'kyc', id: uid } })} onChanged={load} />
    </>
  )
}

function UserDrawer({ id, me, onClose, onOrder, onKyc, onChanged }: { id: number | null; me: PageProps['me']; onClose: () => void; onOrder: (id: number) => void; onKyc: (id: number) => void; onChanged: () => void }) {
  const toast = useToast()
  const [u, setU] = useState<UserFull | null>(null)
  const [ask, setAsk] = useState<'block' | 'unblock' | 'reset' | 'bonus' | null>(null)
  const last = useRef<number | null>(null)
  const reload = useCallback(() => {
    if (id == null) return
    api.user(id).then(setU).catch((e) => toast({ title: (e as Error).message, kind: 'bad' }))
  }, [id, toast])
  useEffect(() => {
    if (id == null) return
    last.current = id
    setU(null)
    reload()
  }, [id, reload])
  const p = (x: string) => me.perms.includes(x)
  const done = (title: string) => {
    toast({ title, kind: 'good' })
    reload()
    onChanged()
  }
  return (
    <>
      <Drawer
        open={id != null}
        onClose={onClose}
        head={u ? <span className="avatar">{initials(u.first_name, u.last_name)}</span> : undefined}
        title={u ? userName(u) : `ID ${id ?? last.current}`}
        sub={u ? `${handle(u)} · с ${dOnly(u.created_at)}` : ''}
        foot={
          u && (p('users.block') || p('users.bonus')) ? (
            <>
              {p('users.bonus') && <button className="btn ghost" onClick={() => setAsk('bonus')}><Ico.gift /> Бонусы</button>}
              {p('users.block') && (u.blocked ? <button className="btn good" onClick={() => setAsk('unblock')}>Разблокировать</button> : <button className="btn danger" onClick={() => setAsk('block')}>Заблокировать</button>)}
            </>
          ) : undefined
        }
      >
        {!u ? (
          <div className="stack"><Skel h={110} /><Skel h={220} /></div>
        ) : (
          <>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
              <div className="card" style={{ padding: 16 }}>
                <div className="xs muted">Оборот</div>
                <div style={{ fontSize: 19, fontWeight: 700, marginTop: 6 }}>{short(u.volume_kzt)} ₸</div>
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div className="xs muted">Бонусы</div>
                <div style={{ fontSize: 19, fontWeight: 700, marginTop: 6 }}>{nf(u.bonus_kzt)} ₸</div>
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div className="xs muted">Уровень</div>
                <div style={{ marginTop: 8 }}><span className={`tier ${u.loyalty.tier}`}>{u.loyalty.tier_name}</span></div>
              </div>
            </div>
            <div className="kv">
              {u.full_name && (
                <>
                  <div>ФИО</div>
                  <div>{u.full_name}</div>
                </>
              )}
              {u.birth_date && (
                <>
                  <div>Дата рождения</div>
                  <div>{dOnly(u.birth_date)}</div>
                </>
              )}
              <div>Телефон</div>
              <div>{u.phone ?? 'не указан'} {u.phone_verified && <span className="good xs">подтверждён</span>}</div>
              <div>Telegram ID</div>
              <div className="mono">{u.id}</div>
              <div>Верификация</div>
              <div><KycBadge s={u.kyc_status} />{u.kyc_note && <div className="xs muted mt8">{u.kyc_note}</div>}</div>
              <div>Рефералы</div>
              <div>{nf(u.referrals)} · заработано {kzt(u.ref_earned_kzt)}</div>
              <div>Код приглашения</div>
              <div className="mono">{u.ref_code ?? ''}</div>
              <div>Был в сети</div>
              <div>{ago(u.last_seen_at)}</div>
            </div>
            <div className="row wrap">
              {u.kyc_status !== 'none' && p('kyc.read') && <button className="btn ghost sm" onClick={() => onKyc(u.id)}><Ico.id /> Анкета верификации</button>}
              {u.kyc_status !== 'none' && p('kyc.reset') && <button className="btn danger sm" onClick={() => setAsk('reset')}>Сбросить верификацию</button>}
            </div>
            <div className="sect">Заявки · {u.orders.length}</div>
            {u.orders.length ? (
              <div className="card flat">
                <table className="t">
                  <tbody>
                    {u.orders.map((o) => (
                      <tr key={o.id} onClick={() => onOrder(o.id)}>
                        <td className="mono">#{o.id}</td>
                        <td>{amt(o.amount_from, o.from_cur)} → {o.to_cur}</td>
                        <td><span className={`st ${o.status}`}>{ORDER_ST[o.status]}</span></td>
                        <td className="muted r">{dOnly(o.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="muted sm">Заявок пока нет</div>
            )}
          </>
        )}
      </Drawer>
      {u && ask === 'block' && <Confirm title="Заблокировать клиента?" text="Клиент не сможет создавать заявки. Причина сохранится в журнале." okText="Заблокировать" danger input="Причина" required onOk={async (v) => (await api.userBlock(u.id, true, v), done('Клиент заблокирован'))} onClose={() => setAsk(null)} />}
      {u && ask === 'unblock' && <Confirm title="Разблокировать клиента?" okText="Разблокировать" onOk={async () => (await api.userBlock(u.id, false), done('Клиент разблокирован'))} onClose={() => setAsk(null)} />}
      {u && ask === 'reset' && (
        <Confirm
          title="Сбросить верификацию?"
          text="Анкета и фото документов будут удалены без возможности восстановления. Клиенту придётся пройти верификацию заново."
          okText="Удалить анкету"
          danger
          onOk={async () => {
            try {
              const r = await api.kycReset(u.id)
              done(`Верификация сброшена, удалено файлов: ${r.files}`)
            } catch (e) {
              toast({ title: (e as Error).message, kind: 'bad' })
            }
          }}
          onClose={() => setAsk(null)}
        />
      )}
      {u && ask === 'bonus' && <BonusModal onClose={() => setAsk(null)} onOk={async (d, r) => (await api.userBonus(u.id, d, r), done(d > 0 ? `Начислено ${nf(d)} ₸ бонусов` : `Списано ${nf(-d)} ₸ бонусов`))} />}
    </>
  )
}

function BonusModal({ onOk, onClose }: { onOk: (delta: number, reason: string) => Promise<void>; onClose: () => void }) {
  const toast = useToast()
  const [sign, setSign] = useState<'add' | 'sub'>('add')
  const [v, setV] = useState('')
  const [r, setR] = useState('')
  const [busy, setBusy] = useState(false)
  const n = Number(v.replace(/\D/g, ''))
  return (
    <Modal onClose={onClose}>
      <h3>Бонусы клиента</h3>
      <p>Бонусами клиент оплачивает часть комиссии. Действие попадёт в журнал.</p>
      <div className="stack">
        <Seg value={sign} onChange={setSign} options={[{ id: 'add', label: 'Начислить' }, { id: 'sub', label: 'Списать' }]} />
        <input className="input" inputMode="numeric" placeholder="Сумма, ₸" value={v ? nf(n) : ''} onChange={(e) => setV(e.target.value)} autoFocus />
        <input className="input" placeholder="Причина" value={r} onChange={(e) => setR(e.target.value)} maxLength={200} />
      </div>
      <div className="row">
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button
          className="btn primary"
          disabled={!n || !r.trim() || busy || n > 1_000_000}
          onClick={async () => {
            setBusy(true)
            try {
              await onOk(sign === 'add' ? n : -n, r.trim())
              onClose()
            } catch (e) {
              toast({ title: (e as Error).message, kind: 'bad' })
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <span className="spinner" /> : 'Сохранить'}
        </button>
      </div>
    </Modal>
  )
}

/* ---------------- верификация ---------------- */
export function Kyc({ me, nav, setNav, tick }: PageProps) {
  const toast = useToast()
  const [status, setStatus] = useState('pending')
  const [rows, setRows] = useState<KycRow[] | null>(null)
  const openId = nav.open?.kind === 'kyc' ? nav.open.id : null
  const load = useCallback(() => {
    api
      .kyc(status)
      .then((r) => setRows(r.rows))
      .catch((e) => toast({ title: (e as Error).message, kind: 'bad' }))
  }, [status, toast])
  useEffect(load, [load, tick])
  return (
    <>
      <div className="toolbar">
        <Seg
          value={status}
          onChange={(v) => {
            setRows(null)
            setStatus(v)
          }}
          options={[
            { id: 'pending', label: 'Ждут проверки' },
            { id: 'verified', label: 'Подтверждены' },
            { id: 'rejected', label: 'Отклонены' },
          ]}
        />
      </div>
      <div className="card flat rise">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Документ</th>
                <th>Автопроверка</th>
                <th>Телефон</th>
                <th>{status === 'pending' ? 'Отправлена' : 'Статус'}</th>
              </tr>
            </thead>
            {!rows ? (
              <Rows cols={5} n={5} />
            ) : (
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} onClick={() => setNav({ page: 'kyc', open: { kind: 'kyc', id: u.id } })}>
                    <td>
                      <div className="who">
                        <span className="avatar sm">{initials(u.first_name, u.last_name)}</span>
                        <span>
                          <b>{userName(u)}</b>
                          <small>{handle(u)}</small>
                        </span>
                      </div>
                    </td>
                    <td>{DOC_NAME[u.doc_type ?? ''] ?? u.doc_type ?? ''}</td>
                    <td>
                      {u.checks_total ? (
                        u.checks_failed ? <span className="st rejected">Замечаний: {u.checks_failed}</span> : <span className="st completed">Все {u.checks_total} пройдены</span>
                      ) : (
                        <span className="faint">нет</span>
                      )}
                    </td>
                    <td className="mono muted">{u.phone ?? ''}{u.phone_verified && <span className="good"> ✓</span>}</td>
                    <td className="muted">{status === 'pending' ? ago(u.kyc_submitted_at) : <KycBadge s={u.kyc_status} />}</td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
          {rows && !rows.length && <Empty text={status === 'pending' ? 'Очередь пуста, все анкеты рассмотрены' : 'Анкет нет'} />}
        </div>
      </div>
      <KycDrawer id={openId} me={me} onClose={() => setNav({ page: 'kyc' })} onChanged={load} />
    </>
  )
}

const FILE_NAME: Record<string, string> = { doc_front: 'Документ, лицевая сторона', doc_back: 'Документ, оборот', selfie: 'Селфи с документом', face: 'Фото лица', doc_face: 'Фото из документа' }
const FIELD_NAME: [string, string][] = [
  ['full_name', 'ФИО'],
  ['birth_date', 'Дата рождения'],
  ['citizenship', 'Гражданство'],
  ['doc_type', 'Документ'],
  ['doc_number', 'Номер документа'],
  ['personal_number', 'ИИН'],
  ['issued_by', 'Кем выдан'],
  ['issue_date', 'Дата выдачи'],
  ['expiry_date', 'Действует до'],
  ['birth_place', 'Место рождения'],
  ['address', 'Адрес'],
  ['phone', 'Телефон'],
]

function KycDrawer({ id, me, onClose, onChanged }: { id: number | null; me: PageProps['me']; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const [k, setK] = useState<KycFull | null>(null)
  const [imgs, setImgs] = useState<Record<string, string>>({})
  const [zoom, setZoom] = useState('')
  const [ask, setAsk] = useState<'approve' | 'reject' | null>(null)
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (id == null) return
    last.current = id
    setK(null)
    setImgs({})
    let live = true
    const urls: string[] = []
    api
      .kycOne(id)
      .then(async (r) => {
        if (!live) return
        setK(r)
        for (const f of r.files) {
          try {
            const u = await api.kycFile(id, f)
            urls.push(u)
            if (live) setImgs((m) => ({ ...m, [f]: u }))
          } catch {
            /* файл недоступен */
          }
        }
      })
      .catch((e) => toast({ title: (e as Error).message, kind: 'bad' }))
    // Расшифрованные фото документов не задерживаются в памяти браузера
    return () => {
      live = false
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [id, toast])
  const fmt = (key: string, v: string | null | undefined) => (!v ? '' : key === 'doc_type' ? DOC_NAME[v] ?? v : /date/.test(key) && /^\d{4}-\d{2}-\d{2}/.test(v) ? dOnly(v) : v)
  const pending = k?.user.kyc_status === 'pending'
  const canAct = me.perms.includes('kyc.act')
  return (
    <>
      <Drawer
        open={id != null}
        onClose={onClose}
        title={k ? k.data.full_name || userName(k.user) : 'Анкета'}
        sub={k ? `${handle(k.user)} · ${KYC_ST[k.user.kyc_status]}` : `ID ${id ?? last.current}`}
        foot={
          k && pending && canAct ? (
            <>
              <button className="btn danger" onClick={() => setAsk('reject')}>Отклонить</button>
              <button className="btn primary" onClick={() => setAsk('approve')}>Подтвердить</button>
            </>
          ) : undefined
        }
      >
        {!k ? (
          <div className="stack"><Skel h={220} /><Skel h={260} /></div>
        ) : (
          <>
            <div className="photos">
              {k.files.map((f) => (
                <div key={f} className={`photo ${f === 'selfie' ? 'wide' : ''}`} onClick={() => imgs[f] && setZoom(imgs[f])}>
                  {imgs[f] ? <img src={imgs[f]} alt={FILE_NAME[f] ?? f} /> : <Skel h={400} r={0} />}
                  <span>{FILE_NAME[f] ?? f}</span>
                </div>
              ))}
            </div>
            {k.checks.length > 0 && (
              <>
                <div className="sect">Автоматическая проверка</div>
                <div className="checks">
                  {k.checks.map((c, i) => (
                    <div key={i} className={c.ok === true ? 'ok' : c.ok === false ? 'no' : 'na'}>
                      <i>{c.ok === true ? '✓' : c.ok === false ? '×' : '?'}</i>
                      {c.label}
                      {c.note && <small>{c.note}</small>}
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="sect">Данные анкеты</div>
            <div className="kv">
              {FIELD_NAME.filter(([key]) => k.data[key]).map(([key, label]) => (
                <Pair key={key} label={label} value={fmt(key, k.data[key])} />
              ))}
            </div>
            <div className="note">Сверьте ФИО, номер и даты с фото документа. На селфи лицо должно совпадать с фото в документе, а документ должен быть тем же.</div>
            {k.user.kyc_note && <div className="kv mt16"><div>Причина отказа</div><div>{k.user.kyc_note}</div></div>}
          </>
        )}
      </Drawer>
      {zoom && (
        <div className="zoom" onClick={() => setZoom('')}>
          <img src={zoom} alt="" />
        </div>
      )}
      {k && ask && (
        <Confirm
          title={ask === 'approve' ? 'Подтвердить верификацию?' : 'Отклонить анкету?'}
          text={ask === 'approve' ? 'Клиенту откроются повышенные лимиты, он получит уведомление.' : 'Клиент увидит причину и сможет отправить анкету заново.'}
          okText={ask === 'approve' ? 'Подтвердить' : 'Отклонить'}
          danger={ask === 'reject'}
          input={ask === 'reject' ? 'Причина для клиента, например: фото документа нечитаемо' : undefined}
          required={ask === 'reject'}
          onOk={async (v) => {
            try {
              await api.kycDecide(k.user.id, ask === 'approve', v)
              toast({ title: ask === 'approve' ? 'Верификация подтверждена' : 'Анкета отклонена', kind: ask === 'approve' ? 'good' : 'warn', text: 'Клиент получил уведомление' })
              setK({ ...k, user: { ...k.user, kyc_status: ask === 'approve' ? 'verified' : 'rejected', kyc_note: ask === 'reject' ? v : null } })
              onChanged()
            } catch (e) {
              toast({ title: (e as Error).message, kind: 'bad' })
            }
          }}
          onClose={() => setAsk(null)}
        />
      )}
    </>
  )
}
const Pair = ({ label, value }: { label: string; value: string }) => (
  <>
    <div>{label}</div>
    <div>{value}</div>
  </>
)
