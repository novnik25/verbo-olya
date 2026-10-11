export interface Style {
  id: string
  name: string
  prompt: string // system-промпт LLM; пустая строка = LLM не вызывается
  builtin: boolean
}

export interface HotkeyCombo {
  keys: number[] // нормализованные uiohook-коды (правые модификаторы приведены к левым)
  label: string  // например "Ctrl + Win"
}

export interface Settings {
  apiKeyEncrypted: string | null // base64 от safeStorage.encryptString
  hotkey: HotkeyCombo
  translateHotkey: HotkeyCombo // двойное нажатие -> мгновенный перевод выделенного текста
  speakHotkey: HotkeyCombo // двойное нажатие -> озвучить выделенный текст вслух
  speakVoiceRu: string // id голоса msedge-tts для русского текста
  speakVoiceEn: string // id голоса msedge-tts для английского текста
  speakRate: number // скорость речи в процентах (-50..+50), 0 = обычная
  recordMode: 'hold' | 'toggle'
  micDeviceId: string // 'default' или deviceId
  playbackDeviceId: string // куда играть речь и сигналы: 'default' или deviceId колонок/наушников
  language: 'auto' | 'ru' | 'en'
  sttEngine: 'auto' | 'cloud' | 'local' | 'local-first' // облако→локальный / только облако / только локальный / локальный→облако
  outputLang: import('./lang').OutputLang // как говорю / перевод en / перевод zh
  translateTargetLang: string // язык панели мгновенного перевода (код из TRANSLATE_LANGS)
  translateRecentLangs: string[] // последние выбранные языки перевода (до 3)
  saveTranslations: boolean // сохранять историю переводов (панель Ctrl+V×2 и вкладка «Переводчик»)
  phonetics: boolean // показывать транскрипцию иностранного текста везде, где есть перевод
  phoneticsStyle: import('./phonetics').PhoneticsStyle // значками МФА / русскими буквами / обоими
  settingsRev: number // версия схемы настроек для одноразовых миграций
  showDock: boolean // тонкая полоска-индикатор внизу экрана (клик — выбор языка)
  theme: 'dark' | 'light' // оформление главного окна
  dockLeft: string[]  // кружки слева от капсулы, в порядке показа
  dockRight: string[] // кружки справа от капсулы
  defaultStyleId: string
  styles: Style[]
  autostart: boolean
  sounds: boolean
  dictionary: string[] // личный словарь: имена, термины
  autoDictionary: boolean // запоминать частые термины из диктовок для подсказки распознаванию
  keepAudioDays: number
  sttModel: string
  llmModel: string
  onboardingDone: boolean
}

/** Настройки, видимые renderer'у: без шифрованного ключа. */
export type SettingsPublic = Omit<Settings, 'apiKeyEncrypted'> & {
  hasApiKey: boolean
  /** Windows отказала в шифровании — ключ лежит на диске открытым. Повод предупредить. */
  keyUnprotected: boolean
}

export type EntryStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface HistoryEntry {
  id: string        // `${Date.now()}-${случайный суффикс}`
  createdAt: string // ISO
  durationMs: number
  status: EntryStatus
  rawText?: string
  styledText?: string // финальный текст (вставленный/для копирования)
  styleId: string
  outputLang?: import('./lang').OutputLang // язык вывода на момент диктовки
  audioFile?: string  // имя файла в recordings/
  error?: string      // текст ошибки для failed
  attempts: number
  nextRetryAt?: string // ISO; для pending
  wordCount: number
}

/** Запись истории переводов — вкладка «Переводчик» и панель мгновенного перевода (Ctrl+V×2). */
export interface TranslationEntry {
  id: string
  createdAt: string // ISO
  source: string
  result: string
  targetLang: string // код из TRANSLATE_LANGS
  via: 'popup' | 'window' // откуда пришёл перевод: панель по Ctrl+V×2 или вкладка «Переводчик»
}

export interface DayActivity {
  date: string // YYYY-MM-DD (локальная дата)
  words: number
}

export interface Stats {
  totalWords: number
  wpm: number       // totalWords / суммарные минуты записи (по done)
  streakDays: number
  longestStreak: number      // самая длинная серия подряд идущих дней с диктовками за всю историю
  totalEntries: number       // всего успешных диктовок
  totalDurationMs: number    // суммарная длительность записей
  fixedWords: number         // слова, добавленные/изменённые стилем (rawText vs styledText)
  words30: number            // слова за последние 30 дней
  wordsPrev30: number        // за предыдущие 30 (для тренда)
  byDay: DayActivity[]       // последние 140 дней подряд (включая нулевые), старые → новые
  styleBreakdown: Array<{ styleId: string; count: number }> // по убыванию count
  langBreakdown: Array<{ lang: string; count: number }> // языки вывода по убыванию
  topTerms: string[]         // автословарь (пусто, если выключен)
}

/** Полная сводка для вкладки «Статистика»: диктовка + перевод + озвучивание. */
export interface StatsPayload extends Stats {
  usage: UsageStats
}

/** Счётчики использования одного раздела (перевод / озвучивание). */
export interface UsageBucket {
  total: number
  chars: number
  byKey: Record<string, number> // язык перевода или голос озвучивания → число обращений
  byDay: Record<string, number> // YYYY-MM-DD → число обращений
}

export interface UsageData {
  translate: UsageBucket
  speak: UsageBucket
}

export interface UsageSummary {
  total: number
  chars: number
  last30: number
  activeDays: number
  minutes: number // оценка длительности озвучивания по объёму текста
  top: Array<{ key: string; count: number }>
}

export interface UsageStats {
  translate: UsageSummary
  speak: UsageSummary
}

export type OverlayState =
  | { phase: 'recording'; level: number } // level 0..1
  | { phase: 'transcribing' }
  | { phase: 'styling' }
  | { phase: 'done' }
  | { phase: 'empty' }
  | { phase: 'queued' }
  | { phase: 'error'; message: string }
  | { phase: 'copied'; text: string } // вставить было некуда — карточка с текстом и «Копировать»
  | { phase: 'idle'; lang: import('./lang').OutputLang } // кружок-переключатель языка
  | { phase: 'hidden' }
  | {
      // панель мгновенного перевода выделенного текста (Ctrl+V ×2)
      phase: 'translate'
      source: string
      result: string
      target: string
      loading: boolean
      error?: string
      // транскрипция: язык стороны есть, только если она иностранная и транскрипция включена
      sourceLang?: string
      resultLang?: string
      sourcePhonetics?: import('./phonetics').Phonetics
      resultPhonetics?: import('./phonetics').Phonetics
      phoneticsStyle?: import('./phonetics').PhoneticsStyle
      phoneticsPending?: boolean // запросы транскрипции ещё не вернулись
      phoneticsNote?: string // транскрипция не загрузилась или загрузилась не вся
    }
  | {
      // панель озвучивания выделенного текста (Ctrl+C ×2) или перевода («Слушать»)
      phase: 'speaking'
      voice: string // человекочитаемое имя голоса
      voiceId: string // id голоса — активная кнопка в переключателе
      lang: 'ru' | 'en' // язык прочитанного текста: предлагаем только его голоса
      paused: boolean
      rate: number // текущий темп речи в процентах — переключается прямо из панели
    }

/** Короткую фразу подобрать несложно, поэтому не принимаем её вовсе. Нужна и окну, и главному процессу. */
export const MIN_PASSPHRASE = 8

/** Чем закончилось сохранение ключа в файл — окно объясняет причину словами. */
export type KeyExportResult = 'ok' | 'no-key' | 'cancelled' | 'weak-passphrase'
/** Запрет доступа отличается от неверного ключа: менять ключ бесполезно. */
export type KeyCheck = 'ok' | 'invalid' | 'malformed' | 'blocked' | 'forbidden' | 'unreachable'
/**
 * Чем закончилось чтение файла ключа. 'rejected' — сервис ключ не принял,
 * 'unreachable' — до сервиса не достучались: ключ при этом может быть годным,
 * и валить вину на него нельзя.
 */
export type KeyImportResult =
  | 'ok'
  | 'cancelled'
  | 'damaged'
  | 'wrong-passphrase'
  | 'rejected'
  | 'unreachable'
  | 'blocked'
  | 'forbidden'

export const IPC = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsSetApiKey: 'settings:set-api-key',
  settingsVerifyKey: 'settings:verify-key',
  hotkeyCapture: 'hotkey:capture',
  historyList: 'history:list',
  historyDelete: 'history:delete',
  historyRetry: 'history:retry',
  historyChanged: 'history:changed', // main → renderer (событие)
  statsGet: 'stats:get',
  copyText: 'clipboard:copy',
  openExternal: 'shell:open-external',
  // отдельный канал вместо расширения openExternal: адрес фиксирован в главном
  // процессе, окно не может подставить произвольную схему
  openOcrSettings: 'shell:open-ocr-settings',
  keyExport: 'key:export',
  keyImport: 'key:import',
  appVersion: 'app:version',
  langChanged: 'lang:changed',   // main → renderer push OutputLang
  netChanged: 'net:changed',     // main → overlay push boolean (есть ли интернет)
  overlayMouse: 'overlay:mouse', // overlay → main {interactive: boolean}
  overlayDismiss: 'overlay:dismiss', // main → overlay, закрыть открытые меню (Esc)
  translateRetarget: 'translate:retarget', // overlay → main, сменить язык перевода и перевести заново
  translateReplace: 'translate:replace',   // overlay → main, вставить перевод вместо выделения
  translateClose: 'translate:close',       // overlay → main, закрыть панель перевода
  ocrImage: 'ocr:image',
  ocrRegion: 'ocr:region',                 // overlay → main, выбрать область экрана и перевести
  regionPicked: 'region:picked',           // окно выбора → main, {x,y,width,height} | null                   // renderer → main, ArrayBuffer с картинкой → распознанный текст
  translateRun: 'translate:run',           // renderer → main, {text, targetLang} — перевод из вкладки «Переводчик»
  phoneticsGet: 'phonetics:get',           // renderer → main, {text, lang} — транскрипция иностранного текста
  translationsList: 'translations:list',       // renderer → main, (search?) — список истории переводов
  translationsDelete: 'translations:delete',   // renderer → main, (id)
  translationsClear: 'translations:clear',     // renderer → main
  translationsChanged: 'translations:changed', // main → renderer (событие)
  openTab: 'main:open-tab', // main → renderer, payload — id вкладки для переключения главного окна
  openMain: 'main:open',    // overlay → main, показать главное окно (опционально сразу на вкладке)
  dictateToggle: 'dictate:toggle',       // overlay → main, начать/остановить диктовку кнопкой
  speakSelection: 'speak:selection',     // overlay → main, озвучить выделенный текст
  translateSelection: 'translate:selection', // overlay → main, перевести выделенный текст
  speakText: 'speak:text',           // renderer → main, {text, voice?} — озвучить текст
  speakControl: 'speak:control',     // overlay → main, {action: 'pause'|'resume'|'stop'}
  ttsPlay: 'tts:play',               // main → recorder, {id, mp3: ArrayBuffer, paused?}
  ttsControl: 'tts:control',         // main → recorder, {action: 'pause'|'resume'|'stop'}
  ttsEnded: 'tts:ended',             // recorder → main, {id, error?}
  localStatus: 'local:status',
  localDownload: 'local:download',
  localGpu: 'local:gpu', // установка GPU-сборки (cublas/CUDA) поверх уже установленного CPU-движка
  localRemove: 'local:remove',
  localProgress: 'local:progress', // main → renderer push { pct, phase }
  overlayState: 'overlay:state',   // main → overlay
  recStart: 'rec:start',           // main → recorder, payload {deviceId, sounds}
  recStop: 'rec:stop',             // main → recorder
  recChunk: 'rec:chunk',           // recorder → main, ArrayBuffer
  recLevel: 'rec:level',           // recorder → main, number 0..1
  recStopped: 'rec:stopped',       // recorder → main, {durationMs}
  recConvert: 'rec:convert',       // main → recorder, payload {id, data: ArrayBuffer}
  recConverted: 'rec:converted'    // recorder → main, {id, wav: ArrayBuffer | null}
} as const

export const MIN_RECORDING_MS = 300
export const MAX_RECORDING_MS = 5 * 60_000
export const GROQ_BASE = 'https://api.groq.com/openai/v1'
