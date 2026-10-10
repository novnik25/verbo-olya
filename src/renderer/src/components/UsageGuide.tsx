import { Fragment, useEffect, useRef, useState } from 'react'
import { APP_NAME } from '../../../shared/app'
import { vox } from '../api'
import './usage-guide.css'

const STEPS = [
  {
    title: 'Войдите на сайт', short: 'Регистрация', scene: 'login',
    description: 'Откройте страницу ключей и войдите через Google, GitHub или электронную почту. Если аккаунта ещё нет, создайте его на той же странице.',
    hint: 'Если сайт не открывается, включите VPN. Для работы самой программы VPN должен действовать и на приложения Windows.'
  },
  {
    title: 'Создайте и скопируйте ключ', short: 'Получить ключ', scene: 'key',
    description: 'После входа нажмите «Create API Key» — это кнопка создания ключа. Задайте ему имя, например Verbo, и подтвердите создание. Скопируйте показанное значение целиком.',
    hint: 'Ключ — это код доступа для программы. Здесь показан пример: свой код вы получите на сайте.'
  },
  {
    title: 'Вставьте ключ в Verbo', short: 'Вставить ключ', scene: 'activate',
    description: 'Вернитесь в программу, щёлкните поле ключа и нажмите Ctrl + V. Затем нажмите «Продолжить». После проверки откроется главное окно.',
    hint: 'Настроить доступ нужно один раз: программа сохранит ключ. Если проверка не прошла, под полем появится причина.'
  },
  {
    title: 'Говорите вместо печати', short: 'Диктовка', scene: 'dictate',
    description: 'Щёлкните поле, куда хотите написать: в переписке, документе или браузере. Удерживайте Ctrl + Win и говорите. Отпустите клавиши — текст появится в этом поле.',
    hint: 'Win — клавиша со значком Windows. Для диктовки нужен микрофон; разрешите доступ к нему, если Windows попросит.'
  },
  {
    title: 'Переводите выделенный текст', short: 'Перевод', scene: 'translate',
    description: 'Выделите иностранное слово или фразу в любой программе. Быстро нажмите Ctrl + V два раза. Внизу экрана появятся перевод и произношение слов.',
    hint: 'Если текст уже скопирован, откройте вкладку «Переводчик» и вставьте его туда. Под переводом можно выбрать запись произношения.'
  },
  {
    title: 'Слушайте текст вслух', short: 'Озвучивание', scene: 'speak',
    description: 'Выделите текст и быстро нажмите Ctrl + C два раза — программа прочитает его вслух. В панели перевода можно нажать кнопку с динамиком рядом с текстом.',
    hint: 'Во время чтения на нижней полоске доступны пауза и остановка. Голос и скорость меняются в настройках.'
  },
  {
    title: 'Переводите текст на картинке', short: 'Область экрана', scene: 'region',
    description: 'Если текст нельзя выделить, наведите мышь на нижнюю полоску Verbo. Нажмите кнопку перевода, выберите «Перевести область экрана» и обведите нужный текст.',
    hint: 'Это подходит для картинок, видео, игр и сканов. Скриншот также можно вставить или перетащить на вкладку «Переводчик».'
  }
] as const

type Scene = (typeof STEPS)[number]['scene']
const STEP_MS = 7500

function PlayIcon(props: { pause?: boolean }): JSX.Element {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {props.pause
      ? <path d="M9 5v14M15 5v14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      : <path d="m8 5 11 7-11 7V5Z" fill="currentColor" />}
  </svg>
}

function KeyChord(props: { letter: string; twice?: boolean }): JSX.Element {
  return <div className="guide-keychord"><kbd>Ctrl</kbd><span>+</span><kbd>{props.letter}</kbd>
    {props.twice && <span className="guide-twice">два раза</span>}
  </div>
}

function Wave(): JSX.Element {
  return <div className="guide-wave">{Array.from({ length: 15 }, (_, i) =>
    <span key={i} style={{ animationDelay: `${i * 80}ms`, height: `${12 + ((i * 7) % 25)}px` }} />
  )}</div>
}

function Example(props: { scene: Scene }): JSX.Element {
  const { scene } = props
  return <div className="guide-example" data-scene={scene} aria-hidden="true">
    <div className="guide-example-bar"><span className="guide-window-dots"><i /><i /><i /></span>
      <span>{scene === 'login' || scene === 'key' ? 'console.groq.com/keys' : `${APP_NAME} · наглядный пример`}</span>
    </div>
    <div className="guide-example-content">
      {scene === 'login' && <>
        <div className="guide-mini-title">Вход в аккаунт</div>
        <div className="guide-fake-button guide-login-target">Войти через Google</div>
        <div className="guide-or">или</div>
        <div className="guide-fake-field">Ваша электронная почта</div>
        <div className="guide-check guide-delayed">Аккаунт готов — можно создать ключ</div>
      </>}
      {scene === 'key' && <>
        <div className="guide-mini-title">Ключи доступа</div>
        <div className="guide-fake-button guide-create-target">Create API Key · создать ключ</div>
        <div className="guide-key-created guide-reveal"><span>Ключ для Verbo</span>
          <div className="guide-key-value">gsk_•••••••••••• <span className="guide-copy">Копировать</span></div>
        </div>
        <div className="guide-check guide-delayed">Скопируйте код целиком</div>
      </>}
      {scene === 'activate' && <>
        <div className="guide-mini-title">Добро пожаловать в Verbo</div>
        <div className="guide-fake-field guide-key-input"><span className="guide-typed">••••••••••••••••</span></div>
        <div className="guide-fake-button guide-continue-target">Продолжить</div>
        <div className="guide-check guide-delayed">Ключ проверен · можно пользоваться</div>
      </>}
      {scene === 'dictate' && <>
        <div className="guide-mini-title">Сообщение в переписке</div>
        <div className="guide-document"><span className="guide-typed">Привет! Встречаемся завтра в десять.</span></div>
        <div className="guide-recording"><Wave /><span>Говорите, удерживая клавиши</span></div>
        <KeyChord letter="Win" />
      </>}
      {scene === 'translate' && <>
        <div className="guide-document"><span className="guide-selection">Good morning!</span></div>
        <KeyChord letter="V" twice />
        <div className="guide-translation guide-reveal"><div className="guide-pron"><span>Good<small>[gʊd]</small></span><span>morning!<small>[ˈmɔːnɪŋ]</small></span></div>
          <div className="guide-result">Доброе утро!</div>
        </div>
      </>}
      {scene === 'speak' && <>
        <div className="guide-document"><span className="guide-read-along">Сегодня отличный день.</span></div>
        <KeyChord letter="C" twice />
        <div className="guide-speaker"><svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="m11 5-6 4H2v6h3l6 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg><Wave /></div>
        <div className="guide-check">Слушайте · ставьте на паузу, когда нужно</div>
      </>}
      {scene === 'region' && <>
        <div className="guide-screen-photo"><span>WELCOME!</span><div className="guide-region-box" /></div>
        <div className="guide-region-label">Перевести область экрана</div>
        <div className="guide-translation guide-reveal"><span className="guide-result">Добро пожаловать!</span></div>
      </>}
    </div>
    {(scene === 'login' || scene === 'key' || scene === 'activate') &&
      <svg className="guide-pointer" width="26" height="30" viewBox="0 0 26 30"><path d="m3 2 2 23 6-6 5 9 5-3-5-9 8-1L3 2Z" fill="var(--ink)" stroke="var(--bg)" strokeWidth="2" /></svg>}
  </div>
}

function UsageGuide(props: { onClose: () => void; configured: boolean }): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const current = STEPS[step]

  useEffect(() => {
    dialog.current?.showModal()
    const visibility = (): void => { if (document.hidden) setPlaying(false) }
    document.addEventListener('visibilitychange', visibility)
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [])

  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => {
      if (step === STEPS.length - 1) setPlaying(false)
      else setStep(step + 1)
    }, STEP_MS)
    return () => clearTimeout(timer)
  }, [playing, step])

  const selectStep = (index: number): void => {
    setStep(Math.max(0, Math.min(STEPS.length - 1, index)))
    setPlaying(false)
  }

  return <dialog ref={dialog} className="usage-guide" aria-labelledby="guide-title" onClose={props.onClose}
    onKeyDown={(e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        selectStep(step + (e.key === 'ArrowRight' ? 1 : -1))
      }
    }}>
    <div className="guide-header"><div><div className="guide-eyebrow">Знакомство с Verbo</div><h2 id="guide-title">От первого запуска до первого перевода</h2></div>
      <button type="button" className="guide-close" aria-label="Закрыть инструкцию" onClick={() => dialog.current?.close()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
    </div>
    <div className="guide-body">
      <nav className="guide-steps" aria-label="Шаги инструкции">{STEPS.map((item, i) =>
        <button type="button" key={item.scene} className={i === step ? 'active' : ''} aria-current={i === step ? 'step' : undefined} onClick={() => selectStep(i)}>
          <span className="guide-step-number">{i + 1}</span><span>{item.short}</span>
        </button>
      )}<p>Просмотр работает без ключа и без интернета.</p></nav>
      <section className="guide-main" data-playing={playing}>
        <div className="guide-caption" aria-live="polite"><span className="guide-eyebrow">Шаг {step + 1} из {STEPS.length}</span><h3>{current.title}</h3><p>{current.description}</p></div>
        <Fragment key={step}><Example scene={current.scene} /></Fragment>
        <p className="guide-hint">{current.hint}</p>
      </section>
    </div>
    <div className="guide-progress" key={step} data-playing={playing} aria-hidden="true"><span /></div>
    <div className="guide-controls">
      <button type="button" className="guide-play" onClick={() => { if (!playing && step === STEPS.length - 1) setStep(0); setPlaying(!playing) }} aria-label={playing ? 'Пауза' : 'Воспроизвести инструкцию'}>
        <PlayIcon pause={playing} /><span>{playing ? 'Пауза' : 'Смотреть'}</span>
      </button>
      <div className="guide-navigation"><button type="button" className="btn secondary" disabled={step === 0} onClick={() => selectStep(step - 1)}>Назад</button>
        {step < STEPS.length - 1
          ? <button type="button" className="btn" onClick={() => selectStep(step + 1)}>Далее</button>
          : <button type="button" className="btn" onClick={() => dialog.current?.close()}>{props.configured ? 'Вернуться в программу' : 'Перейти к настройке'}</button>}
      </div>
    </div>
    {step < 2 && <div className="guide-site-link"><button type="button" className="link-btn" onClick={() => void vox.openExternal('https://console.groq.com/keys')}>Открыть страницу ключей в браузере</button></div>}
  </dialog>
}

export function UsageGuideButton(props: { compact?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const launch = useRef<HTMLButtonElement>(null)
  return <>
    <button ref={launch} type="button" className={props.compact ? 'guide-launch compact' : 'guide-launch'} onClick={() => setOpen(true)}>
      <span className="guide-launch-icon"><PlayIcon /></span><span>{props.compact ? 'Как пользоваться' : 'Посмотреть, как пользоваться'}
        {!props.compact && <small>Анимированная инструкция · ключ пока не нужен</small>}
      </span>
    </button>
    {open && <UsageGuide onClose={() => { setOpen(false); launch.current?.focus() }} configured={!!props.compact} />}
  </>
}
