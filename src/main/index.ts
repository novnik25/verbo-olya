import { app, Notification, clipboard, desktopCapturer, ipcMain, net, safeStorage } from 'electron'
import type { BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, promises as fsp } from 'fs'
import { GROQ_BASE, IPC, MAX_RECORDING_MS } from '../shared/types'
import type { OverlayState } from '../shared/types'
import { SettingsService } from './core/settings'
import { HistoryService } from './core/history'
import { TranslationStore } from './core/translations'
import { UsageStore, spokenChars } from './core/usage'
import { runSpeechLoop } from './core/speech-loop'
import { scaleRect } from '../shared/region'
import { snapRate } from '../shared/speech-rate'
import { QueueService } from './core/queue'
import type { ProcessResult } from './core/queue'
import { DictationPipeline } from './core/pipeline'
import { transcribe, applyStyle, findWorkingLlmModel, findVisionModel, recognizeWithVision } from './services/groq'
import type { TextResult } from './services/groq'
import { DEFAULT_SETTINGS, migrateStyles } from '../shared/styles-presets'
import { insertText, makePsPaste, makeRunHelper, makeUiohookPaste } from './services/inserter'
import { RecorderController } from './services/recorder'
import { transcribeLocal, localStatus } from './services/whisper-local'
import { extractTerms } from './core/terms'
import { buildLlmPrompt, languagePin, looksTranslated, stripCreditTail, stripEllipsis } from '../shared/lang'
import type { OutputLang } from '../shared/lang'
import { captureSelection, makeUiohookCopy } from './services/selection'
import { translateText, translateFailMessage } from './services/translate'
import { makeRunner, recognizeImageBuffer } from './services/ocr'
import type { OcrResult } from './services/ocr'
import { planSpeech, synthesize, pickVoice, voiceLabel, warmUp, MIN_SPEECH_BYTES, SpeechError } from './services/tts'
import { HotkeyService } from './services/hotkeys'
import { activeDisplay, activeDisplayId, createMainWindow, createRegionWindow, createOverlayWindow, createRecorderWindow, positionOverlay, setupPermissions, titleBarColors } from './windows'
import { setupTray } from './tray'
import { registerIpc } from './ipc'
import { initLog, log } from './core/logger'
import { makeKeyCrypto } from './core/key-crypto'
import { configureServiceFetch, serviceFetch } from './services/http'
import { PhoneticsMemory, foreignLang } from './core/phonetics'
import { PhoneticsService } from './services/phonetics'
import type { PhoneticsReply } from '../shared/phonetics'

// Замок берётся по папке, производной от name в package.json, — ДО setPath ниже.
// Поэтому у версии для Оли там своё имя (verbo-olya): с прежним «verbo» она молча
// выходила бы, пока на том же компьютере запущен основной Verbo.
if (!app.requestSingleInstanceLock()) {
  // немедленный выход: второй экземпляр не должен дойти до whenReady и сервисов
  app.exit(0)
}

// Chromium сам обходит прокси для loopback. Отключать прокси всему приложению
// нельзя: VPN может работать именно через системные настройки Windows.

// сбой внутри сторонней библиотеки (например синтеза речи) не должен ронять
// приложение диалогом Electron: пишем в журнал и продолжаем работу
process.on('uncaughtException', (err) => {
  try {
    log(`НЕОБРАБОТАННАЯ ОШИБКА: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
  } catch {
    /* журнал мог быть ещё не готов */
  }
})
process.on('unhandledRejection', (reason) => {
  try {
    log(`НЕОБРАБОТАННЫЙ ОТКАЗ: ${reason instanceof Error ? reason.message : String(reason)}`)
  } catch {
    /* ничего */
  }
})

// Свои идентификатор и папка данных, НЕ как у основного Verbo (com.voxflow.app,
// %AppData%\VoxFlow): общая папка смешала бы настройки, историю и ключ двух
// программ, а общий идентификатор — их уведомления и запись автозапуска.
// Идентификатор совпадает с appId в electron-builder.yml.
app.setAppUserModelId('com.verbo.olya')
app.setPath('userData', join(app.getPath('appData'), 'VerboOlya'))

const dataDir = app.getPath('userData')
initLog(dataDir)
const recordingsDir = join(dataDir, 'recordings')
const startHidden = process.argv.includes('--hidden')

const crypto = makeKeyCrypto({
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (s) => safeStorage.encryptString(s),
  decryptString: (b) => safeStorage.decryptString(b),
  warn: log
})

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let recorderWindow: BrowserWindow | null = null
let quitting = false
let overlayHideTimer: ReturnType<typeof setTimeout> | null = null

const settings = new SettingsService(join(dataDir, 'settings.json'), crypto)
// ключ мог остаться открытым с прошлого запуска: предупреждение в журнале нужно
// каждый раз, а не только в тот момент, когда его сохраняли
if (settings.getPublic().keyUnprotected) {
  log('ключ доступа хранится в открытом виде: шифрование Windows недоступно')
}
const history = new HistoryService(join(dataDir, 'history.json'))
const translations = new TranslationStore(join(dataDir, 'translations.json'))

// транскрипция иностранного текста; узнанные слова запоминаются, чтобы не спрашивать снова
const phoneticsService = new PhoneticsService({
  memory: new PhoneticsMemory(join(dataDir, 'phonetics.json')),
  getApiKey: () => settings.getApiKey(),
  fallbackModel: () => settings.get().llmModel,
  log
})
const phonetics = {
  /** Без исключений: сбой записи памяти на диск не должен ронять панель перевода. */
  async forText(text: string, lang?: string): Promise<PhoneticsReply> {
    try {
      return await phoneticsService.forText(text, lang)
    } catch (err) {
      log(`транскрипция: СБОЙ — ${err instanceof Error ? err.message : String(err)}`)
      return { ok: false, message: 'Не удалось получить транскрипцию' }
    }
  }
}
// счётчики использования переводчика и озвучивания (только числа, без текстов)
const usage = new UsageStore(join(dataDir, 'usage.json'))

// однократная за сессию авто-замена отключённой Groq LLM-модели
let llmAutofixTried = false

// точка офлайна на полоске: важна достижимость СЕРВЕРА (VPN мог отвалиться
// при живом интернете — net.isOnline() этого не видит)
let serverReachablePushed: boolean | null = null
function pushServerReachable(v: boolean): void {
  if (v === serverReachablePushed) return
  serverReachablePushed = v
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send(IPC.netChanged, v)
  }
}
async function probeServer(): Promise<void> {
  if (!net.isOnline()) {
    pushServerReachable(false)
    return
  }
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 4000)
    // без ключа ответ будет 401 — но это значит, что сервер ДОСТИЖИМ
    await serviceFetch(`${GROQ_BASE}/models`, { method: 'HEAD', signal: ctl.signal })
    clearTimeout(timer)
    pushServerReachable(true)
  } catch {
    pushServerReachable(false)
  }
}

// автословарь: частые термины из недавних диктовок — подсказка распознаванию
let autoTerms: string[] = []
function refreshAutoTerms(): void {
  if (!settings.get().autoDictionary) {
    autoTerms = []
    return
  }
  const recentDone = history.list().filter((e) => e.status === 'done').slice(0, 300)
  autoTerms = extractTerms(recentDone.map((e) => e.styledText ?? e.rawText ?? ''))
}

/**
 * Подсказка распознаванию. Whisper воспринимает prompt как «предыдущий контекст
 * речи»: голый список АНГЛИЙСКИХ терминов уводил декодер в английский и вызывал
 * перевод русской речи. Поэтому термины подаются внутри рамки на языке диктовки.
 */
function sttPrompt(s: ReturnType<typeof settings.get>): string | undefined {
  // авто-режим: без подсказки вовсе, чтобы не смещать определение языка
  if (s.language === 'auto') return undefined
  const terms = [...new Set([...s.dictionary, ...autoTerms])].join(', ').slice(0, 160)
  if (s.language === 'en') return terms ? `Terms used: ${terms}.` : undefined
  const frame = 'Диктовка на русском языке.'
  return terms ? `${frame} Используемые термины: ${terms}.` : frame
}

function notify(title: string, body: string, onClick?: () => void): void {
  const n = new Notification({ title, body })
  if (onClick) n.on('click', onClick)
  n.show()
}

function showMain(): void {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
}

// фаза, которую сейчас показывает оверлей: плашку переносим за курсором между
// экранами, а открытую панель (перевод/озвучка) — нет, иначе она убежит из-под мыши
let overlayPhase: OverlayState['phase'] = 'idle'
let overlayDisplayId = -1

function overlaySend(state: OverlayState): void {
  if (!overlayWindow) return
  if (overlayHideTimer) clearTimeout(overlayHideTimer)
  overlayHideTimer = null
  // окно-оверлей постоянно на экране: вместо «спрятать» показываем полоску-переключатель языка
  const resolved: OverlayState =
    state.phase === 'hidden' ? { phase: 'idle', lang: settings.get().outputLang } : state
  overlayPhase = resolved.phase
  if (resolved.phase === 'idle' && !settings.get().showDock) {
    overlayWindow.hide()
    return
  }
  positionOverlay(overlayWindow)
  overlayDisplayId = activeDisplayId()
  if (!overlayWindow.isVisible()) overlayWindow.showInactive()
  overlayWindow.webContents.send(IPC.overlayState, resolved)
  if (['done', 'empty', 'queued', 'error'].includes(resolved.phase)) {
    overlayHideTimer = setTimeout(
      () => overlayIdle(),
      1600
    )
  } else if (resolved.phase === 'copied') {
    // карточке с текстом даём больше времени — её читают и с неё копируют
    overlayHideTimer = setTimeout(
      () => overlayIdle(),
      9000
    )
  }
}

/** Распознавание облаком (Groq) — как раньше; ключ обязателен. */
async function recognizeCloud(s: ReturnType<typeof settings.get>, apiKey: string, audio: Buffer): Promise<TextResult> {
  return transcribe({
    apiKey,
    audio,
    model: s.sttModel,
    language: s.language === 'auto' ? undefined : s.language,
    prompt: sttPrompt(s)
  })
}

/** Распознавание локальным whisper.cpp: конвертирует webm во временный wav и удаляет его. */
async function recognizeLocal(s: ReturnType<typeof settings.get>, audio: Buffer): Promise<TextResult | null> {
  const wav = await recorder.convertToWav(audio)
  if (!wav) return null
  const tmpPath = join(recordingsDir, `tmp-${Date.now()}.wav`)
  await fsp.writeFile(tmpPath, wav)
  try {
    return await transcribeLocal({
      baseDir: dataDir,
      wavPath: tmpPath,
      language: s.language === 'auto' ? undefined : s.language,
      prompt: sttPrompt(s)
    })
  } finally {
    await fsp.rm(tmpPath, { force: true })
  }
}

async function recognizeAndStyle(
  audio: Buffer,
  styleId: string,
  outputLang: OutputLang
): Promise<ProcessResult> {
  const s = settings.get()
  const apiKey = settings.getApiKey()
  const engine = s.sttEngine
  let stt: TextResult | null = null
  const localInstalled = (await localStatus(dataDir)).installed

  // 1) локальный движок как основной (режимы «только локально» и «сначала локальный»)
  if ((engine === 'local' || engine === 'local-first') && localInstalled) {
    stt = await recognizeLocal(s, audio)
  }

  if (engine === 'local') {
    if (!localInstalled) {
      stt = { ok: false, kind: 'permanent', message: 'Локальный движок не установлен — скачайте его в настройках' }
    } else if (!stt) {
      stt = { ok: false, kind: 'permanent', message: 'Не удалось подготовить аудио для локального распознавания' }
    }
  } else {
    // 2) облако: основной путь для auto/cloud, страховка для local-first
    if (!stt || !stt.ok) {
      const cloud: TextResult = apiKey
        ? await recognizeCloud(s, apiKey, audio)
        : { ok: false, kind: 'auth', message: 'Не задан API-ключ' }
      // мгновенно обновляем точку офлайна по фактическому результату обращения к серверу
      if (cloud.ok) pushServerReachable(true)
      else if (cloud.kind === 'transient') pushServerReachable(false)
      if (!stt || !stt.ok) stt = cloud
    }
    // 3) авто-режим: облако недоступно — пробуем локальный
    if (
      engine === 'auto' &&
      !stt.ok &&
      (stt.kind === 'transient' || stt.kind === 'auth') &&
      localInstalled
    ) {
      const local = await recognizeLocal(s, audio)
      if (local) stt = local
    }
  }

  if (!stt) return { ok: false, kind: 'auth', message: 'Не задан API-ключ' }
  if (!stt.ok) return stt
  // паузы и заминки распознавание отмечает многоточиями — это не часть текста
  stt = { ...stt, text: stripCreditTail(stripEllipsis(stt.text)) }
  if (!stt.text.trim()) return { ok: true, rawText: '', styledText: '' }
  const style = s.styles.find((st) => st.id === styleId)
  // стиль + (опционально) перевод — одним вызовом LLM
  let systemPrompt = buildLlmPrompt(style?.prompt ?? '', outputLang)
  if (!systemPrompt) return { ok: true, rawText: stt.text, styledText: stt.text }
  // вне режима переводчика жёстко закрепляем язык ответа по языку диктовки
  const pin = outputLang === 'none' ? languagePin(stt.text) : ''
  if (pin) systemPrompt = pin + '\n\n' + systemPrompt
  // applyStyle остаётся облачным с фолбэком на сырой текст при любом сбое (в т.ч. без ключа)
  const runStyle = (prompt: string): ReturnType<typeof applyStyle> =>
    applyStyle({
      apiKey: apiKey ?? '',
      model: settings.get().llmModel, // читаем свежую: авто-замена могла обновить модель
      systemPrompt: prompt,
      text: stt.text
    })
  let styled = await runStyle(systemPrompt)
  // Groq выводит старые модели из оборота: стиль тогда молча падал в «как есть».
  // Один раз за сессию подбираем живую модель из их списка и переключаемся навсегда.
  if (!styled.ok && styled.kind === 'permanent' && apiKey && !llmAutofixTried) {
    llmAutofixTried = true
    const replacement = await findWorkingLlmModel(apiKey)
    if (replacement && replacement !== s.llmModel) {
      settings.update({ llmModel: replacement })
      notify(
        'Модель оформления текста обновлена',
        `Прежняя модель недоступна в Groq — переключился на ${replacement}`
      )
      styled = await runStyle(systemPrompt)
    }
  }
  // защита от самовольного перевода: одна повторная попытка с усиленным требованием,
  // при повторном нарушении — вставляем оригинал без обработки
  if (styled.ok && outputLang === 'none' && looksTranslated(stt.text, styled.text)) {
    styled = await runStyle(
      (pin || 'Отвечай строго на языке исходного текста.') +
        '\nПредыдущий ответ был на НЕПРАВИЛЬНОМ языке — это ошибка.\n\n' +
        systemPrompt
    )
    if (styled.ok && looksTranslated(stt.text, styled.text)) {
      return { ok: true, rawText: stt.text, styledText: stt.text }
    }
  }
  if (!styled.ok) return { ok: true, rawText: stt.text, styledText: stt.text }
  return { ok: true, rawText: stt.text, styledText: stripEllipsis(styled.text) }
}

const recorder = new RecorderController({
  getWindow: () => recorderWindow!,
  recordingsDir,
  onLevel: (level) => {
    if (pipeline.state === 'recording') overlaySend({ phase: 'recording', level })
  }
})

const ocrScriptPath = app.isPackaged
  ? join(process.resourcesPath, 'ocr', 'ocr.ps1')
  : join(app.getAppPath(), 'resources', 'ocr', 'ocr.ps1')

// какая модель умеет читать картинки — выясняем раз за сессию:
// null означает «искали, подходящей нет», undefined — «ещё не искали»
let visionModel: string | null | undefined

/**
 * Запасной путь распознавания: читаем картинку в облаке. Нужен там, где в системе
 * не установлен языковой пакет распознавания Windows — без него встроенный движок
 * не работает вовсе, и раньше пользователь просто получал отказ.
 */
async function cloudOcr(image: Buffer): Promise<{ ok: boolean; text?: string; message?: string }> {
  const apiKey = settings.getApiKey()
  if (!apiKey) return { ok: false, message: 'ключ доступа не задан' }
  if (visionModel === undefined) {
    visionModel = await findVisionModel(apiKey)
    log(`распознавание в облаке: модель ${visionModel ?? 'не найдена'}`)
  }
  if (!visionModel) return { ok: false, message: 'подходящей модели нет' }
  const res = await recognizeWithVision({ apiKey, model: visionModel, image })
  if (!res.ok) {
    log(`распознавание в облаке: не удалось — ${res.message}`)
    return { ok: false, message: res.message }
  }
  log(`распознавание в облаке: получено символов ${res.text.length}`)
  return { ok: true, text: res.text }
}

/** Единая точка распознавания картинки: местный движок, при его отсутствии — облако. */
function runOcr(data: Buffer): Promise<OcrResult> {
  return recognizeImageBuffer({
    data,
    tmpDir: join(dataDir, 'ocr'),
    run: makeRunner(ocrScriptPath),
    cloud: cloudOcr
  })
}

const helperPath = app.isPackaged
  ? join(process.resourcesPath, 'paste-helper', 'PasteHelper.exe')
  : join(app.getAppPath(), 'resources', 'paste-helper', 'PasteHelper.exe')
// способы вставки: умный хелпер (понимает «фокус не в поле ввода») →
// нативный keyTap из нашего процесса → системный PowerShell
const pasteAttempts: Array<(text: string) => Promise<import('./services/inserter').PasteVerdict>> = [
  ...(existsSync(helperPath) ? [makeRunHelper(helperPath)] : []),
  makeUiohookPaste(),
  makePsPaste()
]

// панель мгновенного перевода выделенного текста (Ctrl+V ×2): текущая сессия — выделение
// и последний перевод, нужны IPC-обработчикам смены языка/замены/закрытия
type TranslateView = Extract<OverlayState, { phase: 'translate' }>
interface TranslateSession {
  source: string
  result: string
  /** Транскрипция оригинала от языка перевода не зависит: при смене языка её не спрашиваем снова. */
  sourcePhonetics?: Promise<PhoneticsReply>
  /** Последнее показанное состояние панели — к нему возвращаемся после чтения вслух. */
  view?: TranslateView
}
let translateSession: TranslateSession | null = null
/** Номер последнего запуска перевода: ответы опоздавших запусков панель не трогают. */
let translateRunSeq = 0

/** Двойное нажатие translateHotkey: захватить выделение в чужом окне и перевести его. */
async function handleTranslateTap(): Promise<void> {
  log('перевод: двойное нажатие поймано')
  const apiKey = settings.getApiKey()
  if (!apiKey) {
    showMain()
    return
  }
  hotkeys.suppress(2000)
  await hotkeys.waitKeysReleased()
  const source = await captureSelection({ clipboard, sendCopy: makeUiohookCopy() })
  log(`перевод: захвачено символов ${source.trim().length}`)
  if (!source.trim()) {
    // нечего переводить — открываем главное окно сразу на вкладке «Переводчик»
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.openTab, 'translate')
    showMain()
    return
  }
  translateSession = { source, result: '' }
  await runTranslate(settings.get().translateTargetLang)
}

/**
 * Перевод с восстановлением после сбоев — единственная точка для панели и окна.
 *
 * Раньше любой отказ превращался в одно «Не удалось перевести», и в журнал не
 * попадало ничего: причину — кончился лимит запросов, сервис ответил 500, модель
 * выведена из оборота — было не отличить от обрыва сети, хотя интернет работал.
 * Теперь подробность уходит в журнал, человеку остаётся понятная причина, а
 * устаревшая модель меняется на живую так же, как в оформлении диктовки.
 */
async function translateSafely(
  text: string,
  target: string
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const apiKey = settings.getApiKey()
  if (!apiKey) return { ok: false, message: 'Не задан ключ доступа — откройте настройки' }
  const run = (): Promise<TextResult> =>
    translateText({
      apiKey,
      model: settings.get().llmModel, // читаем свежую: авто-замена могла обновить модель
      text,
      targetLang: target,
      log
    })
  let res = await run()
  if (!res.ok && res.kind === 'permanent' && !llmAutofixTried) {
    llmAutofixTried = true
    const replacement = await findWorkingLlmModel(apiKey)
    if (replacement && replacement !== settings.get().llmModel) {
      settings.update({ llmModel: replacement })
      log(`перевод: прежняя модель недоступна, переключаюсь на ${replacement}`)
      notify('Модель перевода обновлена', 'Прежняя перестала отвечать — переключился на другую')
      res = await run()
    }
  }
  if (!res.ok) {
    log(`перевод: ОШИБКА — ${res.message}`)
    return { ok: false, message: translateFailMessage(res) }
  }
  return { ok: true, text: res.text }
}

/**
 * Переводит текущее выделение сессии на target и обновляет панель.
 *
 * Транскрипция оригинала запрашивается ВМЕСТЕ с переводом, а не после него:
 * она от перевода не зависит, и иначе значки появлялись бы на секунду позже.
 * Транскрипция перевода — только когда он готов. Каждый ответ дорисовывает
 * панель сам, не дожидаясь остальных.
 */
async function runTranslate(target: string): Promise<void> {
  const session = translateSession
  if (!session) return
  const run = ++translateRunSeq
  const { source } = session
  const s = settings.get()
  const sourceLang = s.phonetics ? foreignLang(source) ?? undefined : undefined
  const resultLang = s.phonetics && target !== 'ru' ? target : undefined
  // панель могли закрыть или перезапустить с другим языком, пока шли запросы
  const live = (): boolean => translateSession === session && translateRunSeq === run
  let view: TranslateView = {
    phase: 'translate',
    source,
    result: session.result,
    target,
    loading: true,
    sourceLang,
    resultLang,
    phoneticsStyle: s.phoneticsStyle,
    phoneticsPending: Boolean(sourceLang || resultLang)
  }
  const startedAt = Date.now()
  const show = (patch: Partial<TranslateView>): void => {
    if (!live()) return
    view = { ...view, ...patch }
    session.view = view
    // Оригинал можно слушать, пока перевод и значки ещё в пути. Чтение, начатое
    // ИЗ ЭТОЙ панели, пришедший ответ закрывать не должен — вместе с ним исчезли
    // бы «Пауза» и «Стоп»; панель перевода вернётся сама (overlayAfterSpeech).
    // Чтение, начатое раньше перевода, — другое дело: новую просьбу о переводе
    // показываем сразу, как и прежде.
    const speakingFromPanel = speakSession !== null && speakSession.startedAt >= startedAt
    if (!speakingFromPanel) overlaySend(view)
  }
  const showPhonetics = (side: 'sourcePhonetics' | 'resultPhonetics', r: PhoneticsReply): void => {
    if (!r.ok) show({ phoneticsNote: r.message })
    else show({ [side]: r.phonetics ?? undefined, ...(r.note ? { phoneticsNote: r.note } : {}) })
  }
  show({})

  if (sourceLang && !session.sourcePhonetics) {
    session.sourcePhonetics = phonetics.forText(source, sourceLang)
  }
  const sourceDone = sourceLang
    ? session.sourcePhonetics!.then((r) => showPhonetics('sourcePhonetics', r))
    : Promise.resolve()

  const res = await translateSafely(source, target)
  if (!live()) return
  if (!res.ok) {
    show({ result: '', loading: false, error: res.message, phoneticsPending: false })
    return
  }
  session.result = res.text
  usage.record('translate', { key: target, chars: source.length })
  if (s.saveTranslations) {
    translations.add({ source, result: res.text, targetLang: target, via: 'popup' })
  }
  show({ result: res.text, loading: false, error: undefined })

  const resultDone = resultLang
    ? phonetics.forText(res.text, resultLang).then((r) => showPhonetics('resultPhonetics', r))
    : Promise.resolve()
  await Promise.all([sourceDone, resultDone])
  show({ phoneticsPending: false })
}

/** Перевод из вкладки «Переводчик» в главном окне: пишет в историю переводов сам, без сессии оверлея. */
async function translateRun(
  text: string,
  targetLang: string
): Promise<{ ok: boolean; result?: string; message?: string }> {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, message: 'Введите текст для перевода' }
  const res = await translateSafely(trimmed, targetLang)
  if (!res.ok) return { ok: false, message: res.message }
  usage.record('translate', { key: targetLang, chars: trimmed.length })
  if (settings.get().saveTranslations) {
    translations.add({ source: trimmed, result: res.text, targetLang, via: 'window' })
  }
  return { ok: true, result: res.text }
}

function translateRetarget(lang: string): void {
  if (!translateSession) return
  const recent = [lang, ...settings.get().translateRecentLangs.filter((l) => l !== lang)].slice(0, 3)
  settings.update({ translateTargetLang: lang, translateRecentLangs: recent })
  void runTranslate(lang)
}

async function translateReplace(): Promise<void> {
  if (!translateSession || !translateSession.result) return
  const text = translateSession.result
  const how = await insertText(text, { clipboard, attempts: pasteAttempts, log })
  translateSession = null
  if (how === 'clipboard-only') overlaySend({ phase: 'copied', text })
  else overlayIdle()
}

function translateClose(): void {
  translateSession = null
  overlayIdle()
}

// ── перевод текста с выделенной области экрана ──────────────────────────────
let regionWindow: BrowserWindow | null = null
let regionResolve: ((r: Electron.Rectangle | null) => void) | null = null

/** Окно выбора области сообщило рамку (или отмену). Зовётся из registerIpc. */
function regionPicked(rect: Electron.Rectangle | null): void {
  regionWindow?.close()
  regionWindow = null
  const resolve = regionResolve
  regionResolve = null
  resolve?.(rect)
}

/** Показывает затемнение поверх активного экрана и ждёт выделения мышью. */
function pickRegion(display: Electron.Display): Promise<Electron.Rectangle | null> {
  return new Promise((resolve) => {
    regionResolve = resolve
    regionWindow = createRegionWindow(display.bounds)
    regionWindow.on('closed', () => {
      // окно могли закрыть мимо кнопки — не оставляем висящее ожидание
      if (regionResolve) {
        const r = regionResolve
        regionResolve = null
        regionWindow = null
        r(null)
      }
    })
  })
}

/**
 * Снимок активного экрана, обрезка по выделению, распознавание и перевод.
 * Выделение приходит в координатах окна (CSS-пиксели), снимок — в физических:
 * приводим одно к другому через масштаб дисплея.
 */
async function translateScreenRegion(): Promise<void> {
  const display = activeDisplay()
  const rect = await pickRegion(display)
  if (!rect) return
  overlaySend({ phase: 'translate', source: '', result: '', target: settings.get().translateTargetLang, loading: true })
  // даём системе перерисовать экран после закрытия затемнения, иначе оно
  // попадёт в снимок и текст под ним будет прочитан по затемнённой картинке
  await new Promise((r) => setTimeout(r, 140))
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: display.size.width, height: display.size.height }
    })
    const source =
      sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[0]
    if (!source) throw new Error('Не удалось получить снимок экрана')
    const shot = source.thumbnail
    // снимок приходит в физических пикселях, выделение — в логических:
    // при масштабе Windows больше 100% это разные величины
    const crop = shot.crop(scaleRect(rect, shot.getSize().width / display.size.width))
    const ocr = await runOcr(crop.toPNG())
    if (!ocr.ok) {
      overlaySend({ phase: 'error', message: ocr.message ?? 'Текст не распознан' })
      return
    }
    log(`область экрана: распознано символов ${ocr.text.length}`)
    translateSession = { source: ocr.text, result: '' }
    await runTranslate(settings.get().translateTargetLang)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось обработать область экрана'
    log(`область экрана: ОШИБКА — ${message}`)
    overlaySend({ phase: 'error', message })
  }
}

// озвучивание текста (Stage 2): выделение по Ctrl+C ×2, кнопка «Слушать» в панели
// перевода, кнопка «Проверить голос» в настройках. Воспроизведение — в скрытом окне
// recorderWindow (в main-процессе звук играть нечем), управляется через tts:play/tts:control.
const ttsEndWaiters = new Map<string, () => void>()
ipcMain.on(IPC.ttsEnded, (_e, payload: { id: string }) => {
  const waiter = ttsEndWaiters.get(payload.id)
  if (waiter) {
    ttsEndWaiters.delete(payload.id)
    waiter()
  }
})

function playInRecorder(mp3: Buffer): Promise<void> {
  const id = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const data = mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength)
  return new Promise((resolve) => {
    ttsEndWaiters.set(id, resolve)
    // устройство шлём с каждым фрагментом: колонки могли выбрать прямо во время чтения
    recorderWindow?.webContents.send(IPC.ttsPlay, {
      id,
      mp3: data,
      deviceId: settings.get().playbackDeviceId
    })
  })
}

function controlPlayback(action: 'pause' | 'resume' | 'stop'): void {
  recorderWindow?.webContents.send(IPC.ttsControl, { action })
}

interface SpeakSession {
  voice: string // человекочитаемое имя голоса — для панели оверлея
  voiceId: string // id голоса: переключается прямо из панели чтения
  lang: 'ru' | 'en' // язык прочитанного текста — какие голоса предлагать
  rate: number // темп, с которым читается текущий фрагмент — чтобы заметить смену на ходу
  paused: boolean
  restart: boolean // сменили голос или темп: текущий фрагмент читаем заново
  startedAt: number // когда начали: панель перевода отличает «слушают из меня» от чтения до неё
}

/** Состояние панели чтения по текущей сессии. */
function speakingState(): Extract<OverlayState, { phase: 'speaking' }> | null {
  if (!speakSession) return null
  return {
    phase: 'speaking',
    voice: speakSession.voice,
    voiceId: speakSession.voiceId,
    lang: speakSession.lang,
    paused: speakSession.paused,
    rate: settings.get().speakRate
  }
}

/**
 * Возврат к «покою». Если в это время идёт чтение, показываем его панель:
 * иначе закрытая панель перевода уносила с собой единственные кнопки «Пауза»
 * и «Остановить», а текст продолжал звучать.
 */
function overlayIdle(): void {
  const speaking = speakingState()
  overlaySend(speaking ?? { phase: 'idle', lang: settings.get().outputLang })
}

/**
 * Чтение закончилось. Если его запустили из открытой панели перевода, панель
 * возвращается: прослушать слово и снова смотреть на его транскрипцию — главный
 * сценарий этой сборки, а прежде панель исчезала вместе с чтением.
 */
function overlayAfterSpeech(): void {
  overlaySend(translateSession?.view ?? { phase: 'idle', lang: settings.get().outputLang })
}
let speakSession: SpeakSession | null = null

/** Синтезирует и воспроизводит текст; ведёт панель оверлея 'speaking'. */
async function speakText(text: string, voiceId?: string): Promise<{ ok: boolean; message?: string }> {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, message: 'Нечего озвучивать' }
  const s = settings.get()
  const voice = voiceId ?? pickVoice(trimmed, s.speakVoiceRu, s.speakVoiceEn)
  const lang: 'ru' | 'en' = voice.startsWith('ru-') ? 'ru' : 'en'
  speakSession = {
    voice: voiceLabel(voice),
    voiceId: voice,
    lang,
    rate: s.speakRate,
    paused: false,
    restart: false,
    startedAt: Date.now()
  }
  overlaySend(speakingState()!)
  const startedAt = Date.now()
  const chunks = planSpeech(trimmed)
  // счётчик прочитанного ведём по фрагментам и подводим итог в finally: учитывать
  // всю длину заранее было нечестно — сбой синтеза и «Стоп» на второй секунде
  // засчитывались как полностью прочитанный текст
  let i = 0
  const synth = (idx: number): Promise<Buffer> => {
    const p = synthesize({
      text: chunks[idx],
      voice: speakSession?.voiceId ?? voice,
      rate: settings.get().speakRate
    })
    p.catch(() => {}) // прерванный синтез не должен всплывать необработанным отказом
    return p
  }
  try {
    log(`озвучка: синтез голосом ${voice}, символов ${trimmed.length}, фрагментов ${chunks.length}`)
    await runSpeechLoop({
      chunks,
      synth,
      play: playInRecorder,
      minBytes: MIN_SPEECH_BYTES,
      active: () => speakSession !== null,
      restarted: () => speakSession?.restart === true,
      clearRestart: () => {
        if (speakSession) speakSession.restart = false
      },
      onFirst: () => log(`озвучка: первый фрагмент за ${Date.now() - startedAt} мс`),
      // считаем по ходу, а не по возврату: при сбое голоса возврата не будет,
      // но прочитанное до него засчитать надо
      onProgress: (done) => {
        i = done
      },
      log
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось получить голос'
    // подробность от сервиса приходит по-английски: ей место в журнале, не на экране
    const detail = err instanceof SpeechError ? ` (${err.detail})` : ''
    log(`озвучка: ОШИБКА синтеза — ${message}${detail}`)
    speakSession = null
    overlaySend({ phase: 'error', message })
    return { ok: false, message }
  } finally {
    // сюда попадаем и при удачном чтении, и при «Стоп», и при сбое синтеза
    const chars = spokenChars(chunks, i)
    if (chars > 0) {
      usage.record('speak', { key: voice, chars })
      log(`озвучка: прочитано фрагментов ${i} из ${chunks.length}, символов ${chars}`)
    }
  }
  if (speakSession) {
    speakSession = null
    overlayAfterSpeech()
  }
  return { ok: true }
}

function speakControl(action: 'pause' | 'resume' | 'stop', why = 'кнопка'): void {
  if (!speakSession) return
  if (action === 'stop') {
    // без этой записи оборванное чтение неотличимо от «дочитал»: разбирая жалобу,
    // невозможно понять, кто именно погасил сессию
    log(`озвучка: остановлена (${why})`)
    controlPlayback('stop')
    speakSession = null
    overlayAfterSpeech()
    return
  }
  speakSession.paused = action === 'pause'
  overlaySend(speakingState()!)
  controlPlayback(action)
}

/** Двойное нажатие speakHotkey: захватить выделение в чужом окне и озвучить его. */
async function handleSpeakTap(): Promise<void> {
  log('озвучка: двойное нажатие поймано')
  // повторное нажатие во время чтения = «стоп», а не вторая озвучка поверх первой
  if (speakSession) {
    speakControl('stop', 'повторное двойное нажатие')
    return
  }
  // глушим собственный Ctrl+C, иначе он снова запустит озвучку; ждём, пока
  // пользователь отпустит клавиши — по зажатому Ctrl копирование срывается
  hotkeys.suppress(2000)
  // соединение с сервисом синтеза поднимаем параллельно захвату текста
  void warmUp(settings.get().speakVoiceRu)
  await hotkeys.waitKeysReleased()
  const text = await captureSelection({ clipboard, sendCopy: makeUiohookCopy() })
  log(`озвучка: захвачено символов ${text.trim().length}`)
  if (!text.trim()) {
    // молчание сбивает с толку: показываем подсказку, что именно пошло не так
    overlaySend({ phase: 'error', message: 'Текст не выделен' })
    return
  }
  await speakText(text)
}

const pipeline = new DictationPipeline({
  recorder: {
    start: () => {
      const s = settings.get()
      return recorder.start({
        deviceId: s.micDeviceId,
        sounds: s.sounds,
        playbackDeviceId: s.playbackDeviceId
      })
    },
    stop: () => recorder.stop(),
    cancel: () => recorder.cancel()
  },
  process: async ({ audio }) => {
    // живая диктовка: одна быстрая повторная попытка при сетевой икоте,
    // чтобы не отправлять запись в очередь из-за разового сбоя
    const styleId = settings.get().defaultStyleId
    const outputLang = settings.get().outputLang
    const first = await recognizeAndStyle(audio, styleId, outputLang)
    if (!first.ok && first.kind === 'transient') {
      await new Promise((r) => setTimeout(r, 1500))
      return recognizeAndStyle(audio, styleId, outputLang)
    }
    return first
  },
  insert: (text) => insertText(text, { clipboard, attempts: pasteAttempts, log }),
  overlay: overlaySend,
  history,
  currentStyleId: () => settings.get().defaultStyleId,
  currentOutputLang: () => settings.get().outputLang,
  notify: (t, b) => notify(t, b),
  discardAudio: (f) => fsp.rm(join(recordingsDir, f), { force: true }),
  maxDurationMs: MAX_RECORDING_MS
})

const queue = new QueueService({
  history,
  process: async (entry) => {
    if (!entry.audioFile) return { ok: false, kind: 'permanent', message: 'Аудиофайл не сохранён' }
    try {
      const audio = await fsp.readFile(join(recordingsDir, entry.audioFile))
      if (audio.length < 200) {
        // обрывок без данных (сбой/выключение во время записи) — сервер его не примет
        return { ok: false, kind: 'permanent', message: 'Аудиозапись повреждена и не может быть распознана' }
      }
      // язык вывода — тот, что действовал в момент диктовки (для старых записей — текущий)
      const result = await recognizeAndStyle(
        audio,
        entry.styleId,
        entry.outputLang ?? settings.get().outputLang
      )
      if (result.ok && !result.styledText.trim()) {
        // тишина: зеркалим ветку empty из pipeline, а не пишем «пустой успех» в историю
        return { ok: false, kind: 'permanent', message: 'Пустая запись' }
      }
      return result
    } catch {
      return { ok: false, kind: 'permanent', message: 'Аудиофайл утерян' }
    }
  },
  isOnline: () => net.isOnline(),
  onProcessed: (entry) => {
    notify('Отложенная запись распознана', (entry.styledText ?? '').slice(0, 80), () => {
      clipboard.writeText(entry.styledText ?? '')
      showMain()
    })
  }
})

const hotkeys = new HotkeyService({
  onStart: () => {
    // без ключа диктовка возможна только в режиме «Только локально»
    if (!settings.getPublic().hasApiKey && settings.get().sttEngine !== 'local') {
      showMain()
      return
    }
    pipeline.holdStart()
  },
  onStop: () => void pipeline.holdEnd(),
  onEsc: () => {
    void pipeline.cancel()
    if (translateSession) translateClose()
    if (speakSession) speakControl('stop', 'Esc')
    // окно плашки не получает фокус, поэтому её меню закрываем отдельным сообщением
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send(IPC.overlayDismiss, null)
      overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    }
  }
})

let trayControls: import('./tray').TrayControls | null = null

function applySettingsSideEffects(): void {
  const s = settings.get()
  hotkeys.applySettings({ hotkey: s.hotkey, recordMode: s.recordMode })
  hotkeys.setDoubleTaps([
    { keys: s.translateHotkey.keys, onTap: () => void handleTranslateTap() },
    { keys: s.speakHotkey.keys, onTap: () => void handleSpeakTap() }
  ])
  // dev-запуск не должен прописывать electron.exe разработчика в автозагрузку Windows
  //
  // Пишем в реестр ТОЛЬКО когда значение действительно меняется. Раньше ключ
  // переписывался при каждом запуске и каждой правке любой настройки — и защита
  // реестра в антивирусах (360 Total Security) показывала модальное окно
  // «обнаружено изменение элемента автозагрузки», которое подвешивало старт.
  if (app.isPackaged && app.getLoginItemSettings().openAtLogin !== s.autostart) {
    app.setLoginItemSettings({ openAtLogin: s.autostart, args: ['--hidden'] })
  }
  refreshAutoTerms()
  trayControls?.refresh()
  // системные кнопки окна перекрашиваются вместе с темой приложения
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitleBarOverlay({ ...titleBarColors(s.theme), height: 36 })
  }
  // выключили плашку — убираем её немедленно, не дожидаясь следующей диктовки
  if (!s.showDock && overlayWindow && !overlayWindow.isDestroyed() && !speakSession && !translateSession) {
    overlayWindow.hide()
  }
  // язык вывода мог смениться откуда угодно — оповещаем окна и обновляем кружок
  for (const w of [mainWindow, overlayWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send(IPC.langChanged, s.outputLang)
  }
  // плашку покоя показываем, только если сейчас ничего не открыто: иначе смена
  // настройки (например, темпа речи из панели чтения) закрывала бы саму панель
  if (speakSession) {
    const preferred = speakSession.lang === 'ru' ? s.speakVoiceRu : s.speakVoiceEn
    const changed = preferred !== speakSession.voiceId || s.speakRate !== speakSession.rate
    speakSession.voiceId = preferred
    speakSession.voice = voiceLabel(preferred)
    speakSession.rate = s.speakRate
    overlaySend(speakingState()!)
    if (changed) {
      // прерываем текущий фрагмент: цикл чтения перечитает его новым голосом
      speakSession.restart = true
      speakSession.paused = false
      controlPlayback('stop')
    }
  } else if (pipeline.state === 'idle' && !translateSession) {
    overlaySend({ phase: 'idle', lang: s.outputLang })
  }
}

async function cleanupOldAudio(): Promise<void> {
  const days = settings.get().keepAudioDays
  const cutoff = Date.now() - days * 86_400_000
  const entries = history.list()
  for (const e of entries) {
    if (e.audioFile && (e.status === 'done' || e.status === 'failed') && Date.parse(e.createdAt) < cutoff) {
      await fsp.rm(join(recordingsDir, e.audioFile), { force: true })
      history.update(e.id, { audioFile: undefined })
    }
  }
  // осиротевшие файлы (запись отменена/пустая до появления discardAudio) старше срока хранения
  try {
    const referenced = new Set(entries.map((e) => e.audioFile).filter(Boolean))
    for (const f of await fsp.readdir(recordingsDir)) {
      if (referenced.has(f)) continue
      const st = await fsp.stat(join(recordingsDir, f))
      if (st.mtimeMs < cutoff) await fsp.rm(join(recordingsDir, f), { force: true })
    }
  } catch {
    /* папки может ещё не быть */
  }
}

app.on('second-instance', showMain)
app.on('before-quit', () => {
  quitting = true
})
app.on('will-quit', () => {
  hotkeys.stop()
  queue.stop()
})
app.on('window-all-closed', () => {
  /* живём в трее */
})

void app.whenReady().then(() => {
  configureServiceFetch((input, init) => net.fetch(input instanceof URL ? input.href : input, init))
  setupPermissions()
  recorderWindow = createRecorderWindow()
  overlayWindow = createOverlayWindow()
  overlayWindow.webContents.on('did-finish-load', () => {
    overlaySend({ phase: 'idle', lang: settings.get().outputLang })
  })
  mainWindow = createMainWindow(!startHidden, settings.get().theme)
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  recorder.wire(ipcMain)
  // записи, зависшие в processing после сбоя/выключения — возвращаем в очередь
  for (const e of history.list()) {
    if (e.status === 'processing') history.update(e.id, { status: 'pending' })
  }
  // обновляем встроенные стили до новых версий (нередактированные пользователем)
  const migratedStyles = migrateStyles(settings.get().styles)
  if (migratedStyles) settings.update({ styles: migratedStyles })
  // одноразовые миграции настроек
  if ((settings.get().settingsRev ?? 1) < 5) {
    const rev = settings.get().settingsRev ?? 1
    const patch: Partial<import('../shared/types').SettingsPublic> = { settingsRev: 5 }
    // rev2: авто-режим Whisper путал язык на смешанной речи и переводил в английский
    if (rev < 2 && settings.get().language === 'auto') {
      patch.language = 'ru'
    }
    // rev3: автозамена могла выбрать агентную модель (compound) — она отвечает на диктовку
    if (/compound|agent/i.test(settings.get().llmModel)) {
      patch.llmModel = DEFAULT_SETTINGS.llmModel // автоподбор найдёт живую замену сам
    }
    // rev4: пользователь просил дословный режим — новый стиль «Пунктуация» по умолчанию
    if (rev < 4 && settings.get().defaultStyleId === 'clean') {
      patch.defaultStyleId = 'verbatim'
    }
    // rev5: у темпа речи было ДВЕ шкалы — панель (−25/0/25/50/75) и настройки
    // (−20/0/20/40). Значение одной в другой не существовало, и список в
    // настройках, не найдя его, показывал первый вариант: 1,25× выглядело как
    // «Замедленный», а любое касание списка молча меняло темп. Подтягиваем
    // сохранённое значение к ближайшему шагу единой шкалы.
    const текущийТемп = settings.get().speakRate
    if (snapRate(текущийТемп) !== текущийТемп) {
      patch.speakRate = snapRate(текущийТемп)
      log(`настройки: темп речи ${текущийТемп} приведён к шкале -> ${patch.speakRate}`)
    }
    settings.update(patch)
  }
  registerIpc({
    settings,
    history,
    queue,
    hotkeys,
    deleteAudio: (f) => fsp.rm(join(recordingsDir, f), { force: true }),
    onSettingsApplied: applySettingsSideEffects,
    dataDir,
    engineDir: app.isPackaged
      ? join(process.resourcesPath, 'whisper-engine')
      : join(app.getAppPath(), 'resources', 'whisper-engine'),
    appVersion: app.getVersion(),
    broadcastLocalProgress: (p) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.localProgress, p)
    },
    getTopTerms: () => autoTerms,
    translateRetarget,
    translateReplace,
    translateClose,
    translateRun,
    phonetics: (text, lang) => phonetics.forText(text, lang),
    ocrImage: runOcr,
    regionPicked,
    translations,
    usage,
    speakText,
    speakControl,
    openMain: (tab?: string) => {
      if (tab && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.openTab, tab)
      }
      showMain()
    },
    dictateToggle: () => {
      // кнопка микрофона в плашке: работает как переключатель независимо от режима клавиши
      if (pipeline.state === 'recording') return void pipeline.holdEnd()
      if (pipeline.state !== 'idle') return
      if (!settings.getPublic().hasApiKey && settings.get().sttEngine !== 'local') {
        showMain()
        return
      }
      pipeline.holdStart()
    },
    ocrRegion: () => translateScreenRegion(),
    speakSelection: () => handleSpeakTap(),
    translateSelection: () => handleTranslateTap()
  })
  history.onChange(() => {
    // запись в историю может прийти во время выхода, когда окно уже уничтожено
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.historyChanged, null)
    }
  })
  history.onChange(() => refreshAutoTerms())
  translations.onChange(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.translationsChanged, null)
    }
  })

  trayControls = setupTray({
    iconPath: app.isPackaged
      ? join(process.resourcesPath, 'icons', 'tray.png')
      : join(app.getAppPath(), 'resources', 'icons', 'tray.png'),
    onOpen: showMain,
    onTogglePause: (paused) => hotkeys.setPaused(paused),
    onQuit: () => app.quit(),
    getOutputLang: () => settings.get().outputLang,
    onOutputLang: (lang: OutputLang) => {
      settings.update({ outputLang: lang })
      applySettingsSideEffects()
    }
  })

  // интерактивные элементы оверлея (кружок, меню) временно отключают проброс кликов
  ipcMain.on(IPC.overlayMouse, (_e, p: { interactive: boolean }) => {
    overlayWindow?.setIgnoreMouseEvents(!p.interactive, { forward: true })
  })

  refreshAutoTerms()
  applySettingsSideEffects()
  hotkeys.start()
  queue.start()

  // плашка следует за пользователем между мониторами: раз в 600 мс сверяем,
  // на каком экране курсор, и переносим её туда (открытые панели не трогаем)
  setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return
    if (overlayPhase !== 'idle') return
    const id = activeDisplayId()
    if (id === overlayDisplayId) return
    overlayDisplayId = id
    positionOverlay(overlayWindow)
  }, 600)

  // индикатор офлайна: проверяем достижимость сервера раз в 15 секунд
  void probeServer()
  setInterval(() => void probeServer(), 15_000)
  void queue.kick()
  void cleanupOldAudio()
  setInterval(() => void cleanupOldAudio(), 6 * 3_600_000)
})
