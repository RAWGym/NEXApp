import { useApp } from '../store'
import { TopBar, useToast } from '../components/ui'
import { Avatar } from './Home'
import { IBell, IChat, IChev, IDoc, IInfo, ILogout, IPhone, IQuestion, IShieldCheck, VerifiedBadge } from '../components/Icons'
import { CONFIG, DEMO } from '../config'
import { addToHome, canAddToHome, inTelegram, isStandalone, openTgLink } from '../lib/tg'
import { api } from '../lib/api'
import { fmtAmount } from '../lib/format'

const KYC_TEXT = {
  none: { t: 'Не пройдена', c: 'var(--muted)' },
  pending: { t: 'На проверке', c: 'var(--amber)' },
  verified: { t: 'Подтверждён', c: 'var(--green)' },
  rejected: { t: 'Отклонена', c: 'var(--red)' },
}

export function Profile() {
  const { user, push, orders } = useApp()
  const toast = useToast()
  const ks = KYC_TEXT[user?.kyc_status ?? 'none']
  const done = orders.filter((o) => o.status === 'completed').length

  return (
    <div className="screen">
      <TopBar title="Профиль" />
      <div className="card" style={{ textAlign: 'center', padding: '24px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Avatar size={76} />
        </div>
        <div className="row mt12" style={{ justifyContent: 'center', gap: 6, fontSize: 20, fontWeight: 600 }}>
          {user?.first_name} {user?.last_name ?? ''}
          {user?.kyc_status === 'verified' && <VerifiedBadge size={20} />}
        </div>
        {user?.username && <div className="small muted">@{user.username}</div>}
        <div className="row mt16" style={{ justifyContent: 'center', gap: 28 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{done}</div>
            <div className="xs faint">обменов</div>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: ks.c }}>{ks.t}</div>
            <div className="xs faint">верификация</div>
          </div>
        </div>
      </div>

      <h2 className="section">Аккаунт</h2>
      <div className="list">
        <Item icon={<IShieldCheck />} title="Верификация" sub={user?.kyc_status === 'verified' ? `Лимит до ${fmtAmount(CONFIG.maxKztVerified, 'KZT')} ₸ за заявку` : 'Анкета и документы'} right={<span className="xs" style={{ color: ks.c }}>{ks.t}</span>} onClick={() => push({ name: 'kyc' })} />
        <Item icon={<IBell />} title="Уведомления о курсе" sub="Сообщим в Telegram" onClick={() => push({ name: 'alerts' })} />
        {canAddToHome() ? (
          <Item icon={<IPhone />} title="Добавить на экран «Домой»" sub="Открывать NEX как приложение" onClick={() => addToHome()} />
        ) : (
          !isStandalone && !inTelegram && <Item icon={<IPhone />} title="Установить на iPhone" sub="NEX как отдельное приложение" onClick={() => push({ name: 'install' })} />
        )}
      </div>

      <h2 className="section">Помощь</h2>
      <div className="list">
        <Item icon={<IChat />} title="Поддержка" sub={`@${CONFIG.supportUsername}`} onClick={() => openTgLink(`https://t.me/${CONFIG.supportUsername}`)} />
        <Item icon={<IQuestion />} title="Частые вопросы" onClick={() => push({ name: 'faq' })} />
        <Item icon={<IDoc />} title="Документы" sub="Оферта, соглашение, политики" onClick={() => push({ name: 'docs' })} />
      </div>

      {!inTelegram && (
        <div className="list mt16">
          <Item
            icon={<ILogout />}
            title="Выйти"
            onClick={() => {
              api.logout()
              toast('Вы вышли')
              setTimeout(() => location.reload(), 400)
            }}
          />
        </div>
      )}

      <div className="xs faint mt24" style={{ textAlign: 'center' }}>
        <IInfo size={14} style={{ verticalAlign: -2 }} /> NEX Digital Asset Exchange · версия 1.0{DEMO ? ' · демо' : ''}
      </div>
    </div>
  )
}

export function Item({ icon, title, sub, right, onClick }: { icon?: React.ReactNode; title: string; sub?: string; right?: React.ReactNode; onClick?: () => void }) {
  return (
    <button className="list-item" onClick={onClick}>
      {icon && <div className="muted" style={{ display: 'flex' }}>{icon}</div>}
      <div className="grow">
        <div style={{ fontWeight: 500 }}>{title}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right}
      <IChev className="chev" size={18} />
    </button>
  )
}
