import { useEffect, useState } from 'react'
import { APP_NAME } from '../../../shared/app'
import type { SettingsPublic, KeyExportResult, KeyImportResult } from '../../../shared/types'
import { MIN_PASSPHRASE } from '../../../shared/types'
import { SPEED_STEPS, snapRate } from '../../../shared/speech-rate'
import { RU_VOICES, EN_VOICES } from '../../../shared/voices'
import { TRANSLATE_LANGS } from '../../../shared/lang'
import { PHONETICS_STYLES } from '../../../shared/phonetics'
import type { PhoneticsStyle } from '../../../shared/phonetics'
import { vox } from '../api'
import { HotkeyCapture } from '../components/HotkeyCapture'

const GROUPS = [
  { id: 'input', label: 'Диктовка' },
  { id: 'recognition', label: 'Распознавание' },
  { id: 'translate', label: 'Перевод' },
  { id: 'speech', label: 'Озвучивание' },
  { id: 'interface', label: 'Интерфейс' },
  { id: 'account', label: 'Доступ и данные' }
] as const
type GroupId = (typeof GROUPS)[number]['id']

function Block(props: { title: string; note?: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="block">
      <div className="block-head">
        <h2>{props.title}</h2>
        {props.note && <p className="block-note">{props.note}</p>}
      </div>
      <div className="form">{props.children}</div>
    </section>
  )
}

export function SettingsPage(props: {
  settings: SettingsPublic
  onChanged: () => void
}): JSX.Element {
  const s = props.settings
  const [group, setGroup] = useState<GroupId>('input')
  const [mics, setMics] = useState<Array<{ id: string; label: string }>>([])
  const [speakers, setSpeakers] = useState<Array<{ id: string; label: string }>>([])
  const [key, setKey] = useState('')
  const [keyStatus, setKeyStatus] = useState<
    'idle' | 'checking' | 'ok' | 'bad' | 'malformed' | 'blocked' | 'offline'
  >('idle')
  // фраза для файла переноса: живёт только в поле, никуда не сохраняется
  const [passphrase, setPassphrase] = useState('')
  const [transfer, setTransfer] = useState<'idle' | KeyExportResult | KeyImportResult>('idle')
  const [localInstalled, setLocalInstalled] = useState<boolean | null>(null)
  const [localUpgradable, setLocalUpgradable] = useState(false)
  // Кнопка установки GPU-ускорения временно скрыта (см. local-whisper-gpu-report.md): текущие
  // Windows-сборки whisper.cpp v1.9.2 ненадёжны — CUDA 12.4 теряет первые слова записи, а CUDA 11.8
  // вовсе не грузит GPU-бэкенд (в ассете релиза нет cublas-DLL). gpuReady оставлен — если движок
  // всё же был установлен раньше (до скрытия кнопки), статус «GPU (NVIDIA)» по-прежнему показываем.
  const [gpuReady, setGpuReady] = useState(false)
  const [localProgress, setLocalProgress] = useState<{ pct: number; phase: 'engine' | 'model' } | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [voiceTest, setVoiceTest] = useState<'idle' | 'checking'>('idle')
  const [voiceTestError, setVoiceTestError] = useState<string | null>(null)

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        // без разрешения на микрофон список приходит без названий устройств —
        // выбрать «те самые колонки» из безымянного перечня невозможно
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true })
        tmp.getTracks().forEach((t) => t.stop())
        const devs = await navigator.mediaDevices.enumerateDevices()
        setMics([
          { id: 'default', label: 'Устройство по умолчанию' },
          ...devs
            .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
            .map((d) => ({ id: d.deviceId, label: d.label || 'Микрофон' }))
        ])
        setSpeakers([
          { id: 'default', label: 'Устройство по умолчанию' },
          ...devs
            .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default')
            .map((d) => ({ id: d.deviceId, label: d.label || 'Устройство воспроизведения' }))
        ])
      } catch {
        setMics([{ id: 'default', label: 'Устройство по умолчанию' }])
        setSpeakers([{ id: 'default', label: 'Устройство по умолчанию' }])
      }
    }
    void load()
    // колонки втыкают и вынимают при открытых настройках — список обязан это заметить
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [])

  useEffect(() => {
    void vox
      .localStatus()
      .then((r) => {
        setLocalInstalled(r.installed)
        setLocalUpgradable(r.upgradable)
        setGpuReady(r.gpuReady)
      })
      // статус не прочитался — считаем «не установлен», чтобы кнопка установки
      // всё равно была видна: иначе раздел выглядел пустым и модуль было не поставить
      .catch(() => setLocalInstalled(false))
    return vox.on('local:progress', (data) =>
      setLocalProgress(data as { pct: number; phase: 'engine' | 'model' })
    )
  }, [])

  const patch = (p: Partial<SettingsPublic>): void => {
    void vox.updateSettings(p).then(props.onChanged)
  }

  const downloadLocalEngine = async (): Promise<void> => {
    setLocalError(null)
    setLocalProgress({ pct: 0, phase: 'engine' })
    const res = await vox.localDownload()
    setLocalProgress(null)
    if (res.ok) {
      setLocalInstalled(true)
      setLocalUpgradable(false)
    } else {
      setLocalError(res.message ?? 'Не удалось загрузить локальный модуль')
    }
  }

  const removeLocalEngine = async (): Promise<void> => {
    await vox.localRemove()
    setLocalInstalled(false)
    setGpuReady(false) // localRemove удаляет всю папку whisper/, включая whisper/gpu/
  }

  const saveKey = async (): Promise<void> => {
    setKeyStatus('checking')
    try {
      const res = await vox.verifyApiKey(key)
      if (res === 'ok') {
        await vox.setApiKey(key)
        setKey('')
        props.onChanged()
      }
      // каждая причина отказа доносится своей фразой: советы человеку разные
      setKeyStatus(
        res === 'ok'
          ? 'ok'
          : res === 'unreachable'
            ? 'offline'
            : res === 'malformed'
              ? 'malformed'
              : res === 'blocked'
                ? 'blocked'
                : 'bad'
      )
    } catch {
      setKeyStatus('bad')
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Настройки</h1>
      </div>

      <div className="subnav" role="tablist" aria-label="Разделы настроек">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            role="tab"
            aria-selected={group === g.id}
            className={`subnav-item ${group === g.id ? 'active' : ''}`}
            onClick={() => setGroup(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>

      {group === 'input' && (
        <>
          <Block
            title="Запуск диктовки"
            note="Сочетание работает во всех приложениях. Распознанный текст вставляется в активное поле ввода и одновременно копируется в буфер обмена."
          >
            <div className="field">
              <label>Сочетание клавиш</label>
              <HotkeyCapture current={s.hotkey} onCaptured={(hotkey) => patch({ hotkey })} />
            </div>

            <div className="field">
              <label>Режим записи</label>
              <select
                value={s.recordMode}
                onChange={(e) => patch({ recordMode: e.target.value as 'hold' | 'toggle' })}
              >
                <option value="hold">Удержание — запись идёт, пока сочетание нажато</option>
                <option value="toggle">Переключение — первое нажатие начинает, второе завершает</option>
              </select>
            </div>
          </Block>

          <Block title="Источник звука" note="Устройство, с которого выполняется запись речи.">
            <div className="field">
              <label>Микрофон</label>
              <select value={s.micDeviceId} onChange={(e) => patch({ micDeviceId: e.target.value })}>
                {mics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="switch">
              <input type="checkbox" checked={s.sounds} onChange={(e) => patch({ sounds: e.target.checked })} />
              Звуковое подтверждение начала и завершения записи
            </label>
          </Block>
        </>
      )}

      {group === 'recognition' && (
        <>
          <Block
            title="Язык и способ распознавания"
            note="Облачное распознавание точнее и быстрее, локальное работает автономно и не передаёт запись в интернет."
          >
            <div className="field">
              <label>Язык речи</label>
              <select
                value={s.language}
                onChange={(e) => patch({ language: e.target.value as SettingsPublic['language'] })}
              >
                <option value="ru">Русский — с поддержкой английских терминов</option>
                <option value="en">Английский</option>
                <option value="auto">Автоопределение — точность на смешанной речи ниже</option>
              </select>
            </div>

            <div className="field">
              <label>Способ распознавания</label>
              <select
                value={s.sttEngine}
                onChange={(e) => patch({ sttEngine: e.target.value as SettingsPublic['sttEngine'] })}
              >
                <option value="auto">Автоматически — облачный, при сбое локальный</option>
                <option value="local-first">Приоритет локального, резерв — облачный</option>
                <option value="cloud">Только облачный</option>
                <option value="local">Только локальный — без подключения к интернету</option>
              </select>
              <div className="desc">
                Локальный модуль обеспечивает распознавание речи без подключения к интернету.
                Перевод и синтез речи выполняются на стороне сервиса и требуют соединения.
              </div>
              {localInstalled === true && (
                <div className="inline">
                  <div className="ok">
                    {gpuReady
                      ? 'Локальный модуль установлен · ускорение GPU (NVIDIA)'
                      : 'Локальный модуль установлен'}
                  </div>
                  {localUpgradable && !localProgress && (
                    <button className="btn secondary" onClick={() => void downloadLocalEngine()}>
                      Обновить модуль
                    </button>
                  )}
                  <button className="link-btn danger" onClick={() => void removeLocalEngine()}>
                    Удалить
                  </button>
                </div>
              )}
              {localProgress && (
                <div className="desc">
                  {localProgress.phase === 'engine' ? 'Загрузка модуля' : 'Загрузка языковой модели'} —{' '}
                  {localProgress.pct}%
                </div>
              )}
              {localInstalled !== true && !localProgress && (
                <div className="inline">
                  <div className="desc">Модуль не установлен</div>
                  <button className="btn secondary" onClick={() => void downloadLocalEngine()}>
                    Установить (около 285 МБ)
                  </button>
                </div>
              )}
              {localError && <div className="err">{localError}</div>}
            </div>
          </Block>

          <Block
            title="Словарь терминов"
            note="Слова из словаря подсказываются распознаванию — имена, названия и профессиональная лексика передаются точнее."
          >
            <div className="field">
              <label>Личный словарь</label>
              <div className="desc">По одному слову или словосочетанию в строке</div>
              <textarea
                defaultValue={s.dictionary.join('\n')}
                onBlur={(e) =>
                  patch({ dictionary: e.target.value.split('\n').map((w) => w.trim()).filter(Boolean) })
                }
              />
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={s.autoDictionary}
                onChange={(e) => patch({ autoDictionary: e.target.checked })}
              />
              Пополнять словарь терминами, которые часто встречаются в диктовках
            </label>
          </Block>
        </>
      )}

      {group === 'translate' && (
        <>
          <Block
            title="Перевод диктовки"
            note="Речь распознаётся и вставляется уже переведённой, с пунктуацией целевого языка. Требуется подключение к интернету."
          >
            <div className="field">
              <label>Язык результата</label>
              <select
                value={s.outputLang}
                onChange={(e) => patch({ outputLang: e.target.value as SettingsPublic['outputLang'] })}
              >
                <option value="none">Без перевода — язык оригинала</option>
                <option value="en">Английский</option>
                <option value="zh">Китайский (упрощённый)</option>
              </select>
              <div className="desc">
                Переключается также из плавающей панели и меню в области уведомлений
              </div>
            </div>
          </Block>

          <Block
            title="Перевод выделенного текста"
            note="Двойное нажатие сочетания открывает панель перевода для текста, выделенного в любом приложении."
          >
            <div className="field">
              <label>Сочетание клавиш</label>
              <HotkeyCapture
                current={s.translateHotkey}
                doubleTap
                onCaptured={(translateHotkey) => patch({ translateHotkey })}
                onReset={() => patch({ translateHotkey: { keys: [29, 47], label: 'Ctrl + V ×2' } })}
              />
            </div>
            <div className="field">
              <label>Язык перевода по умолчанию</label>
              <select
                value={s.translateTargetLang}
                onChange={(e) => patch({ translateTargetLang: e.target.value })}
              >
                {TRANSLATE_LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={s.saveTranslations}
                onChange={(e) => patch({ saveTranslations: e.target.checked })}
              />
              Сохранять историю переводов на вкладке «Переводчик»
            </label>
          </Block>

          <Block
            title="Транскрипция"
            note="Под каждым иностранным словом показывается, как оно произносится: в панели перевода, при переводе области экрана и на вкладке «Переводчик». Русский текст не транскрибируется."
          >
            <label className="switch">
              <input
                type="checkbox"
                checked={s.phonetics}
                onChange={(e) => patch({ phonetics: e.target.checked })}
              />
              Показывать транскрипцию
            </label>
            <div className="field">
              <label>Как записывать произношение</label>
              <div className="desc">
                Значки — международная транскрипция, как в школьных словарях. Русские буквы
                подсказывают чтение, пока значки непривычны. Для китайского и японского
                всегда показывается латиница: пиньинь и ромадзи.
              </div>
              <select
                value={s.phoneticsStyle}
                disabled={!s.phonetics}
                onChange={(e) => patch({ phoneticsStyle: e.target.value as PhoneticsStyle })}
              >
                {PHONETICS_STYLES.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.label} — {st.example}
                  </option>
                ))}
              </select>
            </div>
          </Block>
        </>
      )}

      {group === 'speech' && (
        <>
        <Block
          title="Чтение вслух"
          note="Голос подбирается автоматически по языку текста. Синтез выполняется нейросетевыми голосами Microsoft."
        >
          <div className="field">
            <label>Сочетание клавиш</label>
            <div className="desc">Двойное нажатие читает выделенный текст вслух</div>
            <HotkeyCapture
              current={s.speakHotkey}
              doubleTap
              onCaptured={(speakHotkey) => patch({ speakHotkey })}
              onReset={() => patch({ speakHotkey: { keys: [29, 46], label: 'Ctrl + C ×2' } })}
            />
          </div>

          <div className="field">
            <label>Голоса</label>
            <div className="inline">
              <select value={s.speakVoiceRu} onChange={(e) => patch({ speakVoiceRu: e.target.value })}>
                {RU_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    Русский · {v.label}
                  </option>
                ))}
              </select>
              <select value={s.speakVoiceEn} onChange={(e) => patch({ speakVoiceEn: e.target.value })}>
                {EN_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    Английский · {v.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Темп речи</label>
            <div className="inline">
              {/* та же шкала, что и на плавающей панели: раньше здесь была своя,
                  и сохранённое там значение этот список показать не мог */}
              <select
                value={String(snapRate(s.speakRate))}
                onChange={(e) => patch({ speakRate: Number(e.target.value) })}
              >
                {SPEED_STEPS.map((st) => (
                  <option key={st.value} value={st.value}>
                    {st.label}
                  </option>
                ))}
              </select>
              <button
                className="btn secondary"
                disabled={voiceTest === 'checking'}
                onClick={() => {
                  setVoiceTest('checking')
                  setVoiceTestError(null)
                  void vox
                    .speakText('Проверка голоса. Так будет звучать чтение текста вслух.')
                    .then((r) => {
                      setVoiceTest('idle')
                      if (!r.ok) setVoiceTestError(r.message ?? 'Не удалось выполнить синтез речи')
                    })
                    .catch(() => {
                      setVoiceTest('idle')
                      setVoiceTestError('Не удалось выполнить синтез речи')
                    })
                }}
              >
                {voiceTest === 'checking' ? 'Подготовка…' : 'Прослушать образец'}
              </button>
            </div>
            {voiceTestError && <div className="err">{voiceTestError}</div>}
          </div>
        </Block>

        <Block
          title="Устройство воспроизведения"
          note="Куда играть речь и звуковые сигналы: встроенные динамики, подключённые колонки или наушники."
        >
          <div className="field">
            <label>Воспроизводить звук</label>
            <select
              value={s.playbackDeviceId}
              onChange={(e) => patch({ playbackDeviceId: e.target.value })}
            >
              {speakers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
              {/* выбранное устройство могли отключить: без этой строки список показал
                  бы пустоту, и выбор выглядел бы сброшенным, хотя он сохранён */}
              {s.playbackDeviceId !== 'default' &&
                !speakers.some((d) => d.id === s.playbackDeviceId) && (
                  <option value={s.playbackDeviceId}>Выбранное устройство сейчас недоступно</option>
                )}
            </select>
            <div className="desc">
              Если устройство отключат, звук вернётся в системное — чтение не оборвётся.
            </div>
          </div>
        </Block>
        </>
      )}

      {group === 'interface' && (
        <Block
          title="Плавающая панель и запуск"
          note="Панель у нижнего края экрана даёт доступ к языку результата, переводу и озвучиванию без открытия приложения и переносится на тот экран, где находится указатель."
        >
          <div className="field">
            <label>Оформление</label>
            <select
              value={s.theme}
              onChange={(e) => patch({ theme: e.target.value as SettingsPublic['theme'] })}
            >
              <option value="dark">Тёмное — как у плавающей панели</option>
              <option value="light">Светлое</option>
            </select>
          </div>
          <label className="switch">
            <input type="checkbox" checked={s.showDock} onChange={(e) => patch({ showDock: e.target.checked })} />
            Показывать плавающую панель
          </label>
          <label className="switch">
            <input type="checkbox" checked={s.autostart} onChange={(e) => patch({ autostart: e.target.checked })} />
            Запускать при входе в Windows — свёрнуто в область уведомлений
          </label>
        </Block>
      )}

      {group === 'account' && (
        <>
          <Block
            title="Ключ доступа"
            note={
              s.keyUnprotected
                ? 'Ключ подключает облачное распознавание, обработку текста и перевод. Сейчас он хранится на этом компьютере без защиты — см. предупреждение ниже.'
                : 'Ключ подключает облачное распознавание, обработку текста и перевод. Хранится на этом компьютере в зашифрованном виде.'
            }
          >
            <div className="field">
              <label>Ключ доступа</label>
              <div className="desc">
                {s.hasApiKey ? 'Ключ сохранён. Введите новый, чтобы заменить.' : 'Вставьте ключ, полученный при регистрации в сервисе'}
              </div>
              {s.keyUnprotected && (
                <div className="warn-box">
                  Windows не смогла зашифровать ключ, поэтому он хранится на этом компьютере
                  в открытом виде — его прочитает любой, кто получит доступ к вашей учётной
                  записи. Чаще всего это следствие повреждённого профиля Windows.
                  Перезагрузите компьютер и сохраните ключ заново: если защита восстановится,
                  это предупреждение исчезнет.
                </div>
              )}
              <div className="inline">
                <input
                  type="password"
                  placeholder="gsk_…"
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value)
                    setKeyStatus('idle')
                  }}
                />
                <button className="btn" onClick={() => void saveKey()} disabled={!key || keyStatus === 'checking'}>
                  {keyStatus === 'checking' ? 'Проверка…' : 'Сохранить'}
                </button>
              </div>
              {keyStatus === 'ok' && <div className="ok">Ключ проверен и сохранён</div>}
              {keyStatus === 'bad' && (
                <div className="err">
                  Сервис не принял этот ключ. Проверьте, что скопировано значение целиком, или
                  создайте новый ключ на console.groq.com/keys
                </div>
              )}
              {keyStatus === 'malformed' && (
                <div className="err">
                  В ключе есть посторонние знаки — скопируйте его заново целиком, без кавычек и
                  пробелов по краям
                </div>
              )}
              {keyStatus === 'blocked' && (
                <div className="err">
                  Сервис не обслуживает страну, из которой пришёл запрос. Включите VPN для всей
                  системы, а не только в браузере: {APP_NAME} ходит в сеть отдельно от него.
                </div>
              )}
              {keyStatus === 'offline' && (
                <div className="err">
                  Сервис недоступен: проверить ключ не удалось. Убедитесь в наличии подключения к
                  интернету и повторите попытку.
                </div>
              )}
            </div>

            <div className="field">
              <label>Перенос ключа на другой компьютер</label>
              <div className="desc">
                Файл ключа закрывается парольной фразой — без неё он бесполезен. Придумайте
                фразу здесь, а на другом компьютере введите её же, чтобы открыть файл.
                Фразу мы не храним и восстановить не сможем.
              </div>
              <input
                type="password"
                placeholder={`Парольная фраза, минимум ${MIN_PASSPHRASE} знаков`}
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value)
                  setTransfer('idle')
                }}
              />
              <div className="key-transfer">
                {s.hasApiKey && (
                  <button
                    className="link-btn"
                    disabled={passphrase.length < MIN_PASSPHRASE}
                    onClick={() => void vox.exportKey(passphrase).then(setTransfer)}
                  >
                    Сохранить ключ в файл
                  </button>
                )}
                <button
                  className="link-btn"
                  onClick={() =>
                    void vox.importKey(passphrase).then((r) => {
                      setTransfer(r)
                      if (r === 'ok') {
                        setPassphrase('')
                        props.onChanged()
                      }
                    })
                  }
                >
                  Открыть ключ из файла
                </button>
              </div>
              {transfer === 'ok' && (
                <div className="ok">
                  Готово. Если сохраняли файл — перенесите его и откройте здесь же, введя ту
                  же фразу.
                </div>
              )}
              {transfer === 'weak-passphrase' && (
                <div className="err">Фраза короче {MIN_PASSPHRASE} знаков — придумайте длиннее</div>
              )}
              {transfer === 'wrong-passphrase' && (
                <div className="err">Фраза не подошла. Проверьте раскладку и регистр.</div>
              )}
              {transfer === 'damaged' && (
                <div className="err">Это не файл ключа или он повреждён</div>
              )}
              {transfer === 'rejected' && (
                <div className="err">Ключ из файла прочитан, но сервис его не принял</div>
              )}
              {transfer === 'unreachable' && (
                <div className="err">
                  Ключ из файла прочитан, но проверить его не удалось: сервис недоступен.
                  Проверьте подключение к интернету и повторите.
                </div>
              )}
              {transfer === 'no-key' && (
                <div className="err">Сначала сохраните ключ выше — переносить нечего</div>
              )}
            </div>
          </Block>

          <Block
            title="Хранение данных"
            note="Аудиозаписи нужны для повторного распознавания, если оно не удалось с первого раза. Текст диктовок сохраняется независимо от них."
          >
            <div className="field">
              <label>Срок хранения аудиозаписей, дней</label>
              <input
                type="number"
                min={1}
                max={90}
                defaultValue={s.keepAudioDays}
                onBlur={(e) =>
                  patch({ keepAudioDays: Math.min(90, Math.max(1, Math.round(Number(e.target.value)) || 7)) })
                }
              />
            </div>
          </Block>
        </>
      )}
    </div>
  )
}
