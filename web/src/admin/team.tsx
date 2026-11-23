import { useCallback, useEffect, useState } from 'react'
import { api, type AuditRow, type Page, type Role, type SessionRow, type TeamMember } from './api'
import type { PageProps } from './pages'
import { Confirm, Ico, Modal, ROLE_NAME, Seg, Skel, ago, dt, initials, nf, useToast } from './ui'

const ROLE_INFO: Record<Role, string> = {
  owner: 'Полный доступ, управление командой',
  admin: 'Все разделы, кроме управления командой',
  operator: 'Заявки и верификация',
  viewer: 'Только просмотр статистики и списков',
}

function LinkModal({ title, link, minutes, onClose }: { title: string; link: string; minutes: number; onClose: () => void }) {
  const toast = useToast()
  return (
    <Modal onClose={onClose}>
      <h3>{title}</h3>
      <p>Отправьте ссылку сотруднику лично. Она действует {minutes} минут и только один раз. Ссылку больше нигде не покажем.</p>
      <div className="copybox">
        <code>{link}</code>
        <button
          className="btn ghost sm"
          onClick={() => {
            navigator.clipboard.writeText(link).then(() => toast({ title: 'Ссылка скопирована', kind: 'good' }))
          }}
        >
          <Ico.copy /> Копировать
        </button>
      </div>
      <div className="row">
        <button className="btn primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  )
}

function InviteModal({ onClose, onLink }: { onClose: () => void; onLink: (l: string, m: number) => void }) {
  const toast = useToast()
  const [role, setRole] = useState<Role>('operator')
  const [tg, setTg] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal onClose={onClose}>
      <h3>Пригласить сотрудника</h3>
      <p>Коды входа будут приходить сотруднику в Telegram, поэтому нужен его Telegram ID. Узнать его можно у бота @userinfobot.</p>
      <div className="stack">
        <div className="field">
          <label>Роль</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(['operator', 'admin', 'viewer', 'owner'] as Role[]).map((r) => (
              <option key={r} value={r}>{ROLE_NAME[r]}: {ROLE_INFO[r].toLowerCase()}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Telegram ID</label>
          <input className="input mono" inputMode="numeric" value={tg} onChange={(e) => setTg(e.target.value.replace(/\D/g, '').slice(0, 15))} placeholder="например, 123456789" />
        </div>
        <div className="field">
          <label>Имя</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </div>
      </div>
      <div className="row">
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button
          className="btn primary"
          disabled={!tg || busy}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await api.teamInvite({ role, tg_id: Number(tg), name: name.trim() })
              onLink(r.link, r.expires_in_min)
            } catch (e) {
              toast({ title: (e as Error).message, kind: 'bad' })
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <span className="spinner" /> : 'Создать ссылку'}
        </button>
      </div>
    </Modal>
  )
}

export function Team({ me }: PageProps) {
  const toast = useToast()
  const [data, setData] = useState<{ admins: TeamMember[]; sessions: SessionRow[] } | null>(null)
  const [invite, setInvite] = useState(false)
  const [link, setLink] = useState<{ title: string; link: string; minutes: number } | null>(null)
  const [ask, setAsk] = useState<{ m: TeamMember; act: 'disable' | 'enable' | 'revoke' | 'reset' | 'role'; role?: Role } | null>(null)
  const manage = me.perms.includes('team.manage')
  const load = useCallback(() => {
    api.team().then(setData).catch((e) => toast({ title: (e as Error).message, kind: 'bad' }))
  }, [toast])
  useEffect(load, [load])

  const run = async () => {
    if (!ask) return
    try {
      const r = await api.teamAct(ask.m.id, ask.act, ask.role)
      if (r.link) setLink({ title: `Смена пароля: ${ask.m.login}`, link: r.link, minutes: 30 })
      else toast({ title: 'Готово', kind: 'good' })
      load()
    } catch (e) {
      toast({ title: (e as Error).message, kind: 'bad' })
    }
  }

  const askText: Record<string, [string, string, boolean]> = {
    disable: ['Отключить доступ?', 'Все сессии сотрудника завершатся, войти он не сможет.', true],
    enable: ['Включить доступ?', 'Сотрудник снова сможет войти.', false],
    revoke: ['Завершить все сессии?', 'Сотруднику придётся войти заново.', false],
    reset: ['Создать ссылку для смены пароля?', 'Старый пароль перестанет работать после смены, все сессии завершатся.', false],
    role: ['Сменить роль?', 'Сессии сотрудника завершатся, права изменятся при следующем входе.', false],
  }

  return (
    <>
      <div className="toolbar">
        <div className="grow muted sm">Вход в панель только по паролю и коду из Telegram. Все действия записываются в журнал.</div>
        {manage && (
          <button className="btn primary" onClick={() => setInvite(true)}>
            <Ico.plus /> Пригласить
          </button>
        )}
      </div>
      <div className="card flat rise">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Роль</th>
                <th>Статус</th>
                <th>Последний вход</th>
                <th className="r">Сессии</th>
                {manage && <th />}
              </tr>
            </thead>
            <tbody>
              {!data
                ? [0, 1, 2].map((i) => (
                    <tr key={i}>
                      <td colSpan={6}><Skel h={30} /></td>
                    </tr>
                  ))
                : data.admins.map((m) => (
                    <tr key={m.id} style={{ cursor: 'default' }}>
                      <td>
                        <div className="who">
                          <span className="avatar sm">{initials(m.name || m.login)}</span>
                          <span>
                            <b>{m.name || m.login} {m.id === me.id && <span className="faint xs">(вы)</span>}</b>
                            <small className="mono">{m.login}{m.tg_id ? ` · TG ${m.tg_id}` : ''}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        {manage && m.id !== me.id ? (
                          <select className="input" style={{ height: 34, width: 170, fontSize: 13 }} value={m.role} onChange={(e) => setAsk({ m, act: 'role', role: e.target.value as Role })}>
                            {(['owner', 'admin', 'operator', 'viewer'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}
                          </select>
                        ) : (
                          <span className="chip">{ROLE_NAME[m.role]}</span>
                        )}
                      </td>
                      <td>
                        {!m.active ? <span className="st rejected">Отключён</span> : m.locked_until && Date.parse(m.locked_until) > Date.now() ? <span className="st pending">Временно заблокирован</span> : <span className="st completed">Активен</span>}
                      </td>
                      <td className="muted">{m.last_login_at ? ago(m.last_login_at) : 'не входил'}</td>
                      <td className="r">{nf(m.sessions)}</td>
                      {manage && (
                        <td className="r">
                          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                            <button className="btn ghost sm" onClick={() => setAsk({ m, act: 'reset' })}>Пароль</button>
                            {m.sessions > 0 && m.id !== me.id && <button className="btn ghost sm" onClick={() => setAsk({ m, act: 'revoke' })}>Выйти везде</button>}
                            {m.id !== me.id && (m.active ? <button className="btn danger sm" onClick={() => setAsk({ m, act: 'disable' })}>Отключить</button> : <button className="btn good sm" onClick={() => setAsk({ m, act: 'enable' })}>Включить</button>)}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid mt24">
        <div className="card s7 rise" style={{ ['--i' as string]: 1 }}>
          <div className="chead">
            <h3>Активные сессии</h3>
            <button
              className="btn ghost sm"
              onClick={async () => {
                await api.revokeOthers()
                toast({ title: 'Другие ваши сессии завершены', kind: 'good' })
                load()
              }}
            >
              Завершить мои другие сессии
            </button>
          </div>
          {data?.sessions.length ? (
            <div className="feed">
              {data.sessions.map((s) => {
                const a = data.admins.find((x) => x.id === s.admin_id)
                return (
                  <div key={s.id} className="feed__item" style={{ cursor: 'default' }}>
                    <div className="feed__ico u"><Ico.user /></div>
                    <div className="feed__txt">
                      <b>{a?.name || a?.login} · {s.ua}</b>
                      <small>Вход {dt(s.created_at)}, активность {ago(s.last_seen_at)}</small>
                    </div>
                    {s.current && <span className="chip up">эта сессия</span>}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="muted sm">Нет активных сессий</div>
          )}
        </div>
        <div className="card s5 rise" style={{ ['--i' as string]: 2 }}>
          <div className="chead"><h3>Роли</h3></div>
          <div className="kv" style={{ gridTemplateColumns: '130px 1fr', marginBottom: 0 }}>
            {(['owner', 'admin', 'operator', 'viewer'] as Role[]).map((r) => (
              <Fragment2 key={r} a={ROLE_NAME[r]} b={ROLE_INFO[r]} />
            ))}
          </div>
          <p className="xs faint" style={{ margin: '12px 2px 0', lineHeight: 1.5 }}>Сессия завершается после 30 минут без действий и не длится дольше 12 часов. Сессия привязана к браузеру.</p>
        </div>
      </div>

      {invite && (
        <InviteModal
          onClose={() => setInvite(false)}
          onLink={(l, m) => {
            setInvite(false)
            setLink({ title: 'Ссылка-приглашение', link: l, minutes: m })
          }}
        />
      )}
      {link && <LinkModal {...link} onClose={() => setLink(null)} />}
      {ask && <Confirm title={askText[ask.act][0]} text={(ask.act === 'role' ? `${ask.m.login}: ${ROLE_NAME[ask.m.role]} → ${ROLE_NAME[ask.role!]}. ` : `${ask.m.login}. `) + askText[ask.act][1]} okText="Подтвердить" danger={askText[ask.act][2]} onOk={run} onClose={() => setAsk(null)} />}
    </>
  )
}
const Fragment2 = ({ a, b }: { a: string; b: string }) => (
  <>
    <div>{a}</div>
    <div>{b}</div>
  </>
)

const ACTION: Record<string, string> = {
  login: 'Вход в панель',
  logout: 'Выход',
  'login.bad_password': 'Неверный пароль',
  'login.bad_code': 'Неверный код',
  'login.denied_by_owner': 'Вход отклонён кнопкой «Это не я»',
  'session.ua_mismatch': 'Сессия из другого браузера, завершена',
  'order.accept': 'Заявка принята',
  'order.complete': 'Заявка завершена',
  'order.reject': 'Заявка отклонена',
  'orders.export': 'Выгрузка заявок в CSV',
  'user.view': 'Просмотр карточки клиента',
  'user.block': 'Клиент заблокирован',
  'user.unblock': 'Клиент разблокирован',
  'user.bonus': 'Изменение бонусов',
  'kyc.view': 'Просмотр анкеты',
  'kyc.file': 'Просмотр фото документа',
  'kyc.approve': 'Верификация подтверждена',
  'kyc.reject': 'Верификация отклонена',
  'kyc.reset': 'Верификация сброшена',
  'team.invite': 'Приглашение сотрудника',
  'team.role': 'Смена роли',
  'team.disable': 'Доступ отключён',
  'team.enable': 'Доступ включён',
  'team.reset': 'Ссылка для смены пароля',
  'team.revoke': 'Сессии сотрудника завершены',
  'sessions.revoke_others': 'Завершены другие сессии',
  'password.reset': 'Пароль изменён',
  'account.created': 'Создана учётная запись',
  'invite.owner': 'Приглашение владельца',
  'invite.reset_self': 'Запрос смены пароля',
}
const risky = (a: string) => /bad_|denied|mismatch|block|reset|disable|role|export/.test(a)

export function Audit({ tick }: PageProps) {
  const toast = useToast()
  const [page, setPage] = useState(0)
  const [kind, setKind] = useState('all')
  const [data, setData] = useState<Page<AuditRow> | null>(null)
  useEffect(() => {
    api.audit(page).then(setData).catch((e) => toast({ title: (e as Error).message, kind: 'bad' }))
  }, [page, tick, toast])
  const rows = (data?.rows ?? []).filter((r) => kind === 'all' || (kind === 'security' ? /login|session|password|team|account|invite/.test(r.action) : kind === 'pii' ? /view|file|export/.test(r.action) : /order|kyc\.(approve|reject|reset)|user\.(block|unblock|bonus)/.test(r.action)))
  return (
    <>
      <div className="toolbar">
        <Seg value={kind} onChange={setKind} options={[{ id: 'all', label: 'Все' }, { id: 'actions', label: 'Действия' }, { id: 'pii', label: 'Доступ к данным' }, { id: 'security', label: 'Безопасность' }]} />
        <div className="grow" />
        <span className="muted xs">Записи журнала нельзя изменить или удалить</span>
      </div>
      <div className="card flat rise">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Время</th>
                <th>Сотрудник</th>
                <th>Действие</th>
                <th>Объект</th>
                <th>Подробности</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ cursor: 'default' }}>
                  <td className="muted">{dt(r.created_at)}</td>
                  <td>{r.admin_users ? <b>{r.admin_users.name || r.admin_users.login}</b> : <span className="faint">система</span>}</td>
                  <td className={risky(r.action) ? 'warn' : ''}>{ACTION[r.action] ?? r.action}</td>
                  <td className="mono muted">{r.target ?? ''}</td>
                  <td className="muted xs" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.meta ? Object.entries(r.meta).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(', ') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !rows.length && <div className="empty">Записей нет</div>}
          {!data && <div style={{ padding: 20 }}><Skel h={200} /></div>}
        </div>
        {data && (
          <div className="pager">
            <span>Страница {page + 1} из {Math.max(1, Math.ceil(data.total / 50))}</span>
            <div>
              <button className="btn ghost sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Новее</button>
              <button className="btn ghost sm" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>Старее</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
