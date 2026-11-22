import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { TopBar, useToast, Spinner } from '../components/ui'
import { PinSetup } from '../components/Lock'
import { IBell, IFace, ILock } from '../components/Icons'
import {
  bioAvailable,
  bioEnabled,
  bioName,
  bioWith,
  clearPin,
  disableBio,
  disablePush,
  enableBio,
  enablePush,
  pinEnabled,
  pushState,
  setPin,
  type PushState,
} from '../lib/security'
import { api } from '../lib/api'
import { haptic } from '../lib/tg'

const PUSH_NOTE: Record<PushState, string> = {
  unsupported: 'В Telegram уведомления приходят от бота',
  'need-install': 'На iPhone доступно в приложении с экрана «Домой»',
  denied: 'Запрещены в настройках телефона: Настройки → NEX → Уведомления',
  off: 'Статусы заявок, верификация, курс',
  on: 'Статусы заявок, верификация, курс',
}

export function Security() {
  const { pop, push } = useApp()
  const toast = useToast()
  const [ps, setPs] = useState<PushState>('off')
  const [bioOk, setBioOk] = useState(false)
  const [bio, setBio] = useState(bioEnabled())
  const [pin, setPinOn] = useState(pinEnabled())
  const [busy, setBusy] = useState<string>('')
  const [pinSetup, setPinSetup] = useState(false)
  const [keys, setKeys] = useState<Awaited<ReturnType<typeof api.passkeys>>>([])

  useEffect(() => {
    pushState().then(setPs)
    bioAvailable().then(setBioOk)
    api.passkeys().then(setKeys).catch(() => {})
  }, [])

  const togglePush = async () => {
    setBusy('push')
    try {
      if (ps === 'on') {
        await disablePush()
        setPs('off')
      } else {
        const st = await enablePush()
        setPs(st)
        if (st === 'on') {
          haptic('success')
          api.pushTest().catch(() => {})
        } else if (st === 'denied') toast('Разрешите уведомления в настройках телефона')
      }
    } catch {
      toast('Не удалось изменить уведомления')
    } finally {
      setBusy('')
    }
  }

  const toggleBio = async () => {
    setBusy('bio')
    try {
      if (bio) {
        await disableBio()
        setBio(false)
        setKeys([])
        toast(`Вход ${bioWith} отключён`)
      } else {
        await enableBio()
        setBio(true)
        haptic('success')
        toast(`Вход ${bioWith} включён`)
        api.passkeys().then(setKeys).catch(() => {})
      }
    } catch (e) {
      const err = e as Error
      if (!/NotAllowed|Abort|cancel/i.test(err.name + err.message)) toast(err.message || 'Не удалось подключить вход')
    } finally {
      setBusy('')
    }
  }

  if (pinSetup)
    return (
      <PinSetup
        onCancel={() => setPinSetup(false)}
        onDone={async (p) => {
          await setPin(p)
          setPinOn(true)
          setPinSetup(false)
          toast('Код-пароль установлен')
        }}
      />
    )

  return (
    <div className="screen sub">
      <TopBar title="Вход и уведомления" onBack={pop} />

      <h2 className="section" style={{ marginTop: 6 }}>Уведомления</h2>
      <div className="list">
        <div className="list-item">
          <div className="muted" style={{ display: 'flex' }}><IBell /></div>
          <div className="grow">
            <div style={{ fontWeight: 500 }}>Push-уведомления</div>
            <div className="sub">{PUSH_NOTE[ps]}</div>
          </div>
          {busy === 'push' ? <Spinner /> : (ps === 'on' || ps === 'off') && <Switch on={ps === 'on'} onClick={togglePush} />}
          {ps === 'need-install' && <button className="link-btn" onClick={() => push({ name: 'install' })}>Как</button>}
        </div>
      </div>

      <h2 className="section">Вход в приложение</h2>
      <div className="list">
        <div className="list-item">
          <div className="muted" style={{ display: 'flex' }}><IFace /></div>
          <div className="grow">
            <div style={{ fontWeight: 500 }}>{bioName}</div>
            <div className="sub">{bioOk ? 'Быстрый вход без кода из Telegram' : 'Недоступно на этом устройстве или в Telegram'}</div>
          </div>
          {busy === 'bio' ? <Spinner /> : bioOk && <Switch on={bio} onClick={toggleBio} />}
        </div>
        <div className="list-item">
          <div className="muted" style={{ display: 'flex' }}><ILock /></div>
          <div className="grow">
            <div style={{ fontWeight: 500 }}>Код-пароль</div>
            <div className="sub">4 цифры при каждом открытии приложения</div>
          </div>
          <Switch
            on={pin}
            onClick={() => {
              if (pin) {
                clearPin()
                setPinOn(false)
                toast('Код-пароль отключён')
              } else setPinSetup(true)
            }}
          />
        </div>
        {pin && (
          <button className="list-item" onClick={() => setPinSetup(true)}>
            <div className="grow" style={{ fontWeight: 500 }}>Сменить код-пароль</div>
          </button>
        )}
      </div>
      {(bio || pin) && <p className="xs faint" style={{ margin: '8px 4px 0' }}>Приложение блокируется при запуске и если было свёрнуто дольше минуты.</p>}

      {keys.length > 0 && (
        <>
          <h2 className="section">Устройства для входа</h2>
          <div className="list">
            {keys.map((k) => (
              <div key={k.id} className="list-item">
                <div className="grow">
                  <div style={{ fontWeight: 500 }}>{k.device || 'Устройство'}</div>
                  <div className="sub">Подключено {new Date(k.created_at).toLocaleDateString('ru-RU')}{k.last_used_at ? `, вход ${new Date(k.last_used_at).toLocaleDateString('ru-RU')}` : ''}</div>
                </div>
                <button
                  className="link-btn"
                  onClick={async () => {
                    await api.deletePasskey(k.id).catch(() => {})
                    setKeys(keys.filter((x) => x.id !== k.id))
                    toast('Устройство удалено')
                  }}
                >
                  Удалить
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="card mt16 small muted" style={{ lineHeight: 1.55 }}>
        Лицо или отпечаток проверяются на вашем телефоне. NEX получает только подтверждение входа, без изображения лица и отпечатка. Код-пароль хранится на этом устройстве в зашифрованном виде.
      </div>
    </div>
  )
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <span className={`switch ${on ? 'on' : ''}`} onClick={onClick} role="switch" aria-checked={on}>
      <i />
    </span>
  )
}
