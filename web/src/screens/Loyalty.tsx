import { useApp } from '../store'
import { TopBar, useToast, CountUp } from '../components/ui'
import { ICopy, IGift, IShare, IUsers, ICrown } from '../components/Icons'
import { TIERS, LARGE, FEE_PCT, MIN_FEE, WELCOME_OFF, REF_SHARE, BONUS_MAX_SHARE } from '../lib/pricing'
import { fmtAmount } from '../lib/format'
import { haptic, openTgLink } from '../lib/tg'
import { ProfileForm } from '../components/ProfileForm'

const kzt = (n: number) => `${fmtAmount(n, 'KZT')} ₸`

export function TierCard() {
  const { user, push } = useApp()
  const l = user?.loyalty
  if (!l) return null
  const cur = TIERS.find((t) => t.id === l.tier) ?? TIERS[0]
  const progress = l.next_tier ? Math.min(1, (l.volume_kzt - cur.min) / (l.next_tier.min - cur.min)) : 1
  return (
    <button className={`tier-card tier-${l.tier} rise`} onClick={() => push({ name: 'loyalty' })}>
      <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
        <div>
          <div className="xs tier-label">Уровень</div>
          <div className="tier-name">{l.tier_name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="xs tier-label">Ваша комиссия</div>
          <div className="tier-fee">{Math.max(MIN_FEE, FEE_PCT - l.tier_off)}%</div>
        </div>
      </div>
      <div className="tier-bar mt16">
        <i style={{ transform: `scaleX(${progress})` }} />
      </div>
      <div className="row xs mt8" style={{ justifyContent: 'space-between', width: '100%', opacity: 0.75 }}>
        <span>Оборот {kzt(l.volume_kzt)}</span>
        <span>{l.next_tier ? `До ${l.next_tier.name}: ${kzt(l.next_tier.min - l.volume_kzt)}` : 'Максимальный уровень'}</span>
      </div>
    </button>
  )
}

export function Loyalty() {
  const { user, pop } = useApp()
  const toast = useToast()
  const l = user?.loyalty
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(l!.ref_link)
      haptic('success')
      toast('Ссылка скопирована')
    } catch {
      toast(l!.ref_link)
    }
  }
  const share = () => {
    const text = `Меняю валюту и крипту в NEX. По моей ссылке комиссия на первый обмен ниже на ${WELCOME_OFF}%`
    openTgLink(`https://t.me/share/url?url=${encodeURIComponent(l!.ref_link)}&text=${encodeURIComponent(text)}`)
  }
  return (
    <div className="screen sub">
      <TopBar title="Бонусы и уровни" onBack={pop} />
      <TierCard />

      <div className="grid2 mt12 stagger">
        <div className="card stat">
          <IGift size={20} className="muted" />
          <div className="stat-v"><CountUp value={l?.bonus_kzt ?? 0} format={(v) => kzt(Math.round(v))} /></div>
          <div className="xs faint">бонусов на счёте</div>
        </div>
        <div className="card stat">
          <IUsers size={20} className="muted" />
          <div className="stat-v">{l?.referrals ?? 0}</div>
          <div className="xs faint">приглашено друзей</div>
        </div>
      </div>

      <h2 className="section">Приглашайте друзей</h2>
      <div className="card ref-card">
        <p className="small" style={{ margin: 0 }}>
          Другу комиссия на первый обмен ниже на <b>{WELCOME_OFF}%</b>. Вам <b>{Math.round(REF_SHARE * 100)}%</b> от комиссии каждого его обмена бонусами, без ограничений по сроку.
        </p>
        <div className="ref-link mt12">
          <span className="grow ellipsis">{l?.ref_link}</span>
          <button className="icon-btn" aria-label="Скопировать" onClick={copy}>
            <ICopy size={18} />
          </button>
        </div>
        <button className="btn btn-primary mt12" onClick={share}>
          <IShare size={18} /> Поделиться ссылкой
        </button>
        {!!l?.ref_earned_kzt && <div className="xs faint mt8" style={{ textAlign: 'center' }}>Всего заработано: {kzt(l.ref_earned_kzt)}</div>}
      </div>

      <h2 className="section">Уровни</h2>
      <div className="list stagger">
        {TIERS.map((t) => (
          <div key={t.id} className={`list-item tier-row ${l?.tier === t.id ? 'on' : ''}`}>
            <div className={`tier-dot tier-${t.id}`}>
              <ICrown size={16} />
            </div>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{t.name}</div>
              <div className="sub">{t.min ? `Оборот от ${kzt(t.min)}` : 'С первого обмена'}</div>
            </div>
            <div className="v" style={{ fontWeight: 600 }}>{Math.max(MIN_FEE, FEE_PCT - t.off)}%</div>
          </div>
        ))}
      </div>

      <h2 className="section">Как это работает</h2>
      <div className="card small muted" style={{ lineHeight: 1.6 }}>
        <p style={{ marginTop: 0 }}>Уровень растёт от суммы завершённых обменов и не сгорает. Скидка уровня действует на все заявки.</p>
        <p>
          Крупные суммы дешевле: от {kzt(LARGE[1].min)} комиссия ниже на {LARGE[1].off}%, от {kzt(LARGE[0].min)} на {LARGE[0].off}%. Скидки складываются, минимальная комиссия {MIN_FEE}%.
        </p>
        <p style={{ marginBottom: 0 }}>
          Бонусами можно оплатить до {Math.round(BONUS_MAX_SHARE * 100)}% комиссии: включите «Списать бонусы» при обмене. Если заявка отклонена или отменена, бонусы возвращаются.
        </p>
      </div>
    </div>
  )
}

export function Personal() {
  const { pop } = useApp()
  return (
    <div className="screen sub">
      <TopBar title="Личные данные" onBack={pop} />
      <ProfileForm onSaved={pop} />
    </div>
  )
}
