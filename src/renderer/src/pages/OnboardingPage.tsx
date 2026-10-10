import { useState } from 'react'
import { APP_NAME } from '../../../shared/app'
import { vox } from '../api'
import { WaveMark } from '../App'
import { KeyAccessError } from '../components/KeyAccessError'
import { UsageGuideButton } from '../components/UsageGuide'

export function OnboardingPage(props: { onDone: () => void }): JSX.Element {
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<
    | 'idle'
    | 'checking'
    | 'bad'
    | 'malformed'
    | 'blocked'
    | 'forbidden'
    | 'offline'
    | 'damaged'
    | 'wrong-passphrase'
    | 'rejected'
    | 'unreachable'
    | 'save-failed'
  >('idle')
  // фраза, которой закрыт файл ключа на том компьютере, откуда его принесли
  const [passphrase, setPassphrase] = useState('')

  const importFile = async (): Promise<void> => {
    const r = await vox.importKey(passphrase)
    if (r === 'ok') {
      await vox.updateSettings({ onboardingDone: true })
      props.onDone()
    } else if (r !== 'cancelled') {
      setStatus(r)
    }
  }

  const submit = async (): Promise<void> => {
    setStatus('checking')
    try {
      const res = await vox.verifyApiKey(key)
      if (res !== 'ok') {
        // «посторонние знаки» и «страна не обслуживается» — не вина ключа,
        // и лечатся они не повторной вставкой; поэтому фразы разные
        setStatus(
          res === 'unreachable'
            ? 'offline'
            : res === 'malformed'
              ? 'malformed'
              : res === 'blocked' || res === 'forbidden'
                ? res
                : 'bad'
        )
        return
      }
      await vox.setApiKey(key)
      await vox.updateSettings({ onboardingDone: true })
      props.onDone()
    } catch {
      setStatus('save-failed')
    }
  }

  return (
    <div className="onboard">
      <div className="onboard-mark">
        <WaveMark size={28} />
        <span className="onboard-word">{APP_NAME}</span>
      </div>
      <h1>Голос, перевод и озвучивание в любом приложении</h1>
      <p className="sub">
        Удерживайте <kbd>Ctrl</kbd> <span className="kbd-plus">+</span> <kbd>Win</kbd> и говорите —
        распознанный текст появится в активном поле ввода. Для работы нужен бесплатный ключ доступа:
        платёжные данные не запрашиваются.
      </p>
      <UsageGuideButton />
      <ol>
        <li>
          Откройте{' '}
          <button
            className="link-btn link-inline"
            onClick={() => void vox.openExternal('https://console.groq.com/keys')}
          >
            console.groq.com/keys
          </button>{' '}
          и войдите в аккаунт — доступен вход через Google
        </li>
        <li>Создайте ключ на открывшейся странице и скопируйте его</li>
        <li>Вставьте ключ в поле ниже</li>
      </ol>
      <div className="inline">
        <input
          type="password"
          placeholder="gsk_…"
          value={key}
          disabled={status === 'checking'}
          onChange={(e) => { setKey(e.target.value); setStatus('idle') }}
          onKeyDown={(e) => e.key === 'Enter' && key && status !== 'checking' && void submit()}
        />
        <button className="btn" onClick={() => void submit()} disabled={!key || status === 'checking'}>
          {status === 'checking' ? 'Проверка…' : 'Продолжить'}
        </button>
      </div>
      {status === 'bad' && (
        <p className="err">Ключ не принят сервисом. Скопируйте значение целиком и повторите ввод.</p>
      )}
      {status === 'malformed' && (
        <p className="err">
          В ключе есть посторонние знаки. Скопируйте его заново целиком — без кавычек, пробелов и
          слова Bearer.
        </p>
      )}
      {(status === 'blocked' || status === 'forbidden') && <KeyAccessError reason={status} />}
      {status === 'save-failed' && (
        <p className="err">Не удалось проверить или сохранить ключ. Повторите попытку.</p>
      )}
      {status === 'offline' && (
        <p className="err">
          Сервис недоступен: проверить ключ не удалось. Убедитесь в наличии подключения к интернету
          и повторите попытку.
        </p>
      )}
      {status === 'damaged' && (
        <p className="err">Это не файл ключа или он повреждён. Проверьте файл или введите ключ вручную.</p>
      )}
      {status === 'wrong-passphrase' && (
        <p className="err">Фраза не подошла. Проверьте раскладку и регистр.</p>
      )}
      {status === 'rejected' && (
        <p className="err">Ключ из файла прочитан, но сервис его не принял.</p>
      )}
      {status === 'unreachable' && (
        <p className="err">
          Ключ из файла прочитан, но проверить его не удалось: сервис недоступен. Проверьте
          подключение к интернету и повторите.
        </p>
      )}
      <div className="onboard-alt">
        {APP_NAME} уже настроен на другом компьютере? Введите фразу, которой закрыт файл ключа,
        и откройте его.
        <div className="inline onboard-transfer">
          <input
            type="password"
            placeholder="Парольная фраза от файла"
            value={passphrase}
            onChange={(e) => {
              setPassphrase(e.target.value)
              setStatus('idle')
            }}
          />
          {/* не блокируем без фразы: файлы, сохранённые старыми версиями, открываются без неё */}
          <button className="btn" onClick={() => void importFile()}>
            Открыть файл ключа
          </button>
        </div>
      </div>
    </div>
  )
}
