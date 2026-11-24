import { useEffect, useState } from 'react'
import { api, type EventItem, type Me, type Stats } from './api'
import type { Nav } from './main'
import { FeedList } from './feed'
import { AreaChart, BarChart, Count, Delta, Donut, Ico, Seg, Skel, kzt, nf, short } from './ui'

export interface PageProps {
  me: Me
  nav: Nav
  setNav: (n: Nav) => void
  tick: number
}
type Range = 'week' | 'month' | 'quarter' | 'year'
const RANGES: { id: Range; label: string }[] = [
  { id: 'week', label: '7 дней' },
  { id: 'month', label: '30 дней' },
  { id: 'quarter', label: 'Квартал' },
  { id: 'year', label: 'Год' },
]
const PERIOD: Record<Range, string> = { week: 'за 7 дней', month: 'за 30 дней', quarter: 'за квартал', year: 'за год' }

function useStats(range: Range, tick: number) {
  const [s, setS] = useState<Stats | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    api
      .stats(range)
      .then((r) => live && (setS(r), setErr('')))
      .catch((e) => live && setErr((e as Error).message))
    return () => {
      live = false
    }
  }, [range, tick])
  return { s, err }
}

function Kpi({ i, title, icon, value, fmt, unit, delta, foot, hero }: { i: number; title: string; icon: React.ReactNode; value: number; fmt?: (n: number) => string; unit?: string; delta?: React.ReactNode; foot?: React.ReactNode; hero?: boolean }) {
  return (
    <div className={`card kpi s3 rise ${hero ? 'hero' : ''}`} style={{ ['--i' as string]: i }}>
      <div className="kpi__head">
        {title}
        <span className="kpi__ico">{icon}</span>
      </div>
      <div className="kpi__fig">
        <Count value={value} format={fmt} />
        {unit && <small>{unit}</small>}
      </div>
      <div className="kpi__foot">
        {delta}
        {foot}
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className="grid">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card s3" style={{ minHeight: 150 }}>
          <Skel w={120} />
          <div style={{ height: 50 }} />
          <Skel h={30} w="70%" />
        </div>
      ))}
      <div className="card s8" style={{ minHeight: 320 }}><Skel h={260} /></div>
      <div className="card s4" style={{ minHeight: 320 }}><Skel h={260} /></div>
    </div>
  )
}

export function Overview({ me, setNav, tick, feed, onPick }: PageProps & { feed: EventItem[]; onPick: (e: EventItem) => void }) {
  const [range, setRange] = useState<Range>('month')
  const { s, err } = useStats(range, tick)
  const finance = me.perms.includes('finance')
  if (err && !s) return <div className="card empty">{err}</div>
  return (
    <>
      <div className="toolbar">
        <Seg value={range} options={RANGES} onChange={setRange} />
        <div className="grow" />
        {me.perms.includes('orders.read') && (
          <button className="btn ghost sm" onClick={() => setNav({ page: 'orders' })}>
            Открытых заявок: {s?.orders_open ?? 0}
          </button>
        )}
        {me.perms.includes('kyc.read') && !!s?.kyc_pending && (
          <button className="btn wine sm" onClick={() => setNav({ page: 'kyc' })}>
            Ждут проверки: {s.kyc_pending}
          </button>
        )}
      </div>
      {!s ? (
        <Loading />
      ) : (
        <div className="grid">
          <Kpi i={0} hero title="Оборот" icon={<Ico.trend />} value={s.volume} fmt={short} unit="₸" delta={<Delta cur={s.volume} prev={s.previous.volume} />} foot={PERIOD[range]} />
          {finance && s.fee != null ? (
            <Kpi i={1} title="Комиссия" icon={<Ico.wallet />} value={s.fee - (s.bonus_spent ?? 0)} fmt={short} unit="₸" delta={<Delta cur={s.fee - (s.bonus_spent ?? 0)} prev={(s.previous.fee ?? 0) - (s.previous.bonus_spent ?? 0)} />} foot="за вычетом бонусов" />
          ) : (
            <Kpi i={1} title="Средний чек" icon={<Ico.wallet />} value={s.avg_check} fmt={short} unit="₸" foot={PERIOD[range]} />
          )}
          <Kpi i={2} title="Сделки" icon={<Ico.swap />} value={s.orders_done} delta={<Delta cur={s.orders_done} prev={s.previous.orders_done} />} foot={`из ${nf(s.orders)} заявок`} />
          <Kpi i={3} title="Новые пользователи" icon={<Ico.users />} value={s.users_new} delta={<Delta cur={s.users_new} prev={s.previous.users_new} />} foot={`всего ${nf(s.users_total)}`} />

          <div className="card s8 rise" style={{ ['--i' as string]: 4 }}>
            <div className="chead">
              <h3>Оборот по завершённым сделкам</h3>
              <div className="legend">
                <span><i style={{ background: '#eae1d7' }} />Оборот, ₸</span>
              </div>
            </div>
            <AreaChart key={range + s.series.length} data={s.series as never} k="volume" bucket={s.bucket} label="Оборот" fmt={(n) => short(n) + ' ₸'} height={250} />
          </div>
          <div className="card s4 rise" style={{ ['--i' as string]: 5 }}>
            <div className="chead">
              <h3>Конверсия заявок</h3>
              <span className="meta">{PERIOD[range]}</span>
            </div>
            <Donut
              key={range}
              center={s.orders ? nf((s.orders_done / s.orders) * 100) + '%' : '0%'}
              sub="завершено"
              parts={[
                { label: 'Завершены', value: s.orders_done, color: '#eae1d7' },
                { label: 'В работе', value: Math.max(0, s.orders - s.orders_done - s.orders_rejected - s.orders_cancelled), color: '#8f2434' },
                { label: 'Отклонены', value: s.orders_rejected, color: '#e5677a' },
                { label: 'Отменены', value: s.orders_cancelled, color: 'rgba(234,225,215,.25)' },
              ]}
            />
            <div className="kv mt16" style={{ gridTemplateColumns: '1fr auto', marginBottom: 0 }}>
              <div>Средний чек</div>
              <div>{kzt(s.avg_check)}</div>
              <div>Активных клиентов</div>
              <div>{nf(s.users_active)}</div>
            </div>
          </div>

          <div className="card s5 rise" style={{ ['--i' as string]: 6 }}>
            <div className="chead">
              <h3>Популярные направления</h3>
              <span className="meta">по обороту</span>
            </div>
            {s.pairs.length ? (
              <div className="bars">
                {s.pairs.slice(0, 6).map((p, i) => (
                  <div key={p.pair} className="bars__row">
                    <b>{p.pair}</b>
                    <span>{short(p.volume)} ₸ · {nf(p.n)}</span>
                    <div className="bars__track">
                      <div className="bars__fill" style={{ width: `${(p.volume / s.pairs[0].volume) * 100}%`, ['--i' as string]: i }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">Сделок за период нет</div>
            )}
          </div>
          <div className="card s7 rise" style={{ ['--i' as string]: 7 }}>
            <div className="chead">
              <h3>Лента событий</h3>
              <span className="meta">обновляется сама</span>
            </div>
            <FeedList items={feed} onPick={onPick} limit={7} />
          </div>

          <div className="card s4 rise" style={{ ['--i' as string]: 8 }}>
            <div className="chead"><h3>База клиентов</h3></div>
            <Donut
              center={nf(s.users_total)}
              sub="всего"
              parts={[
                { label: 'Верифицированы', value: s.users_verified, color: '#eae1d7' },
                { label: 'Заполнили профиль', value: Math.max(0, s.users_profile - s.users_verified), color: '#8f2434' },
                { label: 'Без профиля', value: Math.max(0, s.users_total - s.users_profile), color: 'rgba(234,225,215,.22)' },
              ]}
            />
          </div>
          <div className="card s8 rise" style={{ ['--i' as string]: 9 }}>
            <div className="chead">
              <h3>Заявки по периодам</h3>
              <div className="legend">
                <span><i style={{ background: '#8f2434' }} />Все</span>
                <span><i style={{ background: '#eae1d7' }} />Завершённые</span>
              </div>
            </div>
            <BarChart key={range} data={s.series as never} k="orders" k2="done" bucket={s.bucket} label="Заявок" label2="Завершено" height={180} />
          </div>
        </div>
      )}
    </>
  )
}

export function Finance({ tick }: PageProps) {
  const [range, setRange] = useState<Range>('month')
  const { s, err } = useStats(range, tick)
  if (err && !s) return <div className="card empty">{err}</div>
  const fee = s?.fee ?? 0
  const bonus = s?.bonus_spent ?? 0
  return (
    <>
      <div className="toolbar">
        <Seg value={range} options={RANGES} onChange={setRange} />
      </div>
      {!s ? (
        <Loading />
      ) : (
        <div className="grid">
          <Kpi i={0} hero title="Оборот" icon={<Ico.trend />} value={s.volume} fmt={short} unit="₸" delta={<Delta cur={s.volume} prev={s.previous.volume} />} foot={PERIOD[range]} />
          <Kpi i={1} title="Комиссия 3%" icon={<Ico.wallet />} value={fee} fmt={short} unit="₸" delta={<Delta cur={fee} prev={s.previous.fee} />} foot="до бонусов" />
          <Kpi i={2} title="Оплачено бонусами" icon={<Ico.gift />} value={bonus} fmt={short} unit="₸" delta={<Delta cur={bonus} prev={s.previous.bonus_spent} invert />} foot={fee ? `${nf((bonus / fee) * 100, 1)}% комиссии` : ''} />
          <Kpi i={3} title="Чистый доход" icon={<Ico.coins />} value={fee - bonus} fmt={short} unit="₸" delta={<Delta cur={fee - bonus} prev={(s.previous.fee ?? 0) - (s.previous.bonus_spent ?? 0)} />} foot={PERIOD[range]} />

          <div className="card s8 rise" style={{ ['--i' as string]: 4 }}>
            <div className="chead">
              <h3>Комиссия и бонусы</h3>
              <div className="legend">
                <span><i style={{ background: '#eae1d7' }} />Комиссия</span>
                <span><i style={{ background: 'rgba(234,225,215,.45)' }} />Бонусы</span>
              </div>
            </div>
            <AreaChart key={range} data={s.series as never} k="fee" k2="bonus" bucket={s.bucket} label="Комиссия" label2="Бонусы" fmt={(n) => short(n) + ' ₸'} height={260} />
          </div>
          <div className="card s4 wmd rise" style={{ ['--i' as string]: 5 }}>
            <div className="chead"><h3>Обязательства</h3></div>
            <div className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
              <div>Бонусы на счетах клиентов</div>
              <div>{kzt(s.bonus_balance)}</div>
              <div>Выплачено по рефералам, всего</div>
              <div>{kzt(s.ref_paid)}</div>
              <div>Средний чек</div>
              <div>{kzt(s.avg_check)}</div>
              <div>Средняя комиссия со сделки</div>
              <div>{kzt(s.orders_done ? fee / s.orders_done : 0)}</div>
            </div>
            <p className="xs faint" style={{ margin: 0, lineHeight: 1.5 }}>Бонусы на счетах клиентов могут быть списаны в счёт будущих комиссий. Это сумма, которую сервис может недополучить.</p>
          </div>

          <div className="card s7 rise" style={{ ['--i' as string]: 6 }}>
            <div className="chead"><h3>Оборот по направлениям</h3></div>
            {s.pairs.length ? (
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>Направление</th>
                      <th className="r">Сделок</th>
                      <th className="r">Оборот</th>
                      <th className="r">Комиссия</th>
                      <th className="r">Доля</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.pairs.map((p) => (
                      <tr key={p.pair} style={{ cursor: 'default' }}>
                        <td><b>{p.pair}</b></td>
                        <td className="r">{nf(p.n)}</td>
                        <td className="r">{kzt(p.volume)}</td>
                        <td className="r">{kzt(p.volume * 0.03)}</td>
                        <td className="r muted">{nf((p.volume / (s.volume || 1)) * 100, 1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">Сделок за период нет</div>
            )}
          </div>
          <div className="card s5 rise" style={{ ['--i' as string]: 7 }}>
            <div className="chead"><h3>Клиенты по уровням</h3></div>
            <Donut
              center={nf(s.users_total)}
              sub="клиентов"
              parts={[
                { label: 'Standard', value: s.tiers.standard, color: 'rgba(234,225,215,.22)' },
                { label: 'Silver', value: s.tiers.silver, color: '#d6d6dc' },
                { label: 'Gold', value: s.tiers.gold, color: '#e6c37a' },
                { label: 'Black', value: s.tiers.black, color: '#8f2434' },
              ]}
            />
          </div>
        </div>
      )}
    </>
  )
}
