import { app, clipboard, dialog, ipcMain, shell } from 'electron'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { APP_NAME } from '../shared/app'
import { IPC } from '../shared/types'
import type { SettingsPublic, KeyExportResult, KeyImportResult } from '../shared/types'
import { MIN_PASSPHRASE, packKeyFile, unpackKeyFile } from './core/key-file'
import type { SettingsService } from './core/settings'
import type { HistoryService } from './core/history'
import type { TranslationStore } from './core/translations'
import type { UsageStore } from './core/usage'
import type { QueueService } from './core/queue'
import type { HotkeyService } from './services/hotkeys'
import { checkKey } from './services/groq'
import { cleanApiKey } from './core/api-key'
import { log } from './core/logger'
import { localStatus, localPaths, downloadLocal, downloadGpu } from './services/whisper-local'

export function registerIpc(deps: {
  settings: SettingsService
  history: HistoryService
  queue: QueueService
  hotkeys: HotkeyService
  deleteAudio: (fileName: string) => Promise<void>
  onSettingsApplied: () => void
  dataDir: string
  engineDir: string
  appVersion: string
  broadcastLocalProgress: (p: { pct: number; phase: 'engine' | 'model' }) => void
  getTopTerms: () => string[]
  translateRetarget: (lang: string) => void
  translateReplace: () => Promise<void>
  translateClose: () => void
  translateRun: (text: string, targetLang: string) => Promise<{ ok: boolean; result?: string; message?: string }>
  ocrImage: (data: Buffer) => Promise<{
    ok: boolean
    text: string
    message?: string
    engineMissing?: boolean
  }>
  ocrRegion: () => Promise<void>
  regionPicked: (rect: Electron.Rectangle | null) => void
  translations: TranslationStore
  usage: UsageStore
  speakText: (text: string, voice?: string) => Promise<{ ok: boolean; message?: string }>
  speakControl: (action: 'pause' | 'resume' | 'stop') => void
  openMain: (tab?: string) => void
  dictateToggle: () => void
  speakSelection: () => Promise<void>
  translateSelection: () => Promise<void>
}): void {
  ipcMain.handle(IPC.settingsGet, () => deps.settings.getPublic())
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: Partial<SettingsPublic>) => {
    const pub = deps.settings.update(patch)
    deps.onSettingsApplied()
    return pub
  })
  ipcMain.handle(IPC.settingsSetApiKey, (_e, key: string) => {
    // чистим тем же разбором, что и при проверке: иначе сохранится ключ с
    // невидимым знаком — проверку он прошёл бы, а каждый запрос падал бы
    deps.settings.setApiKey(cleanApiKey(key))
  })
  ipcMain.handle(IPC.settingsVerifyKey, async (_e, key?: string) => {
    const итог = await checkKey(cleanApiKey(key ?? '') || deps.settings.getApiKey() || '', undefined, log)
    log(`ключ: проверка — ${итог}`)
    return итог
  })
  ipcMain.handle(IPC.hotkeyCapture, () => deps.hotkeys.capture())
  ipcMain.handle(IPC.historyList, (_e, search?: string) => deps.history.list(search))
  ipcMain.handle(IPC.historyDelete, async (_e, id: string) => {
    const entry = deps.history.delete(id)
    if (entry?.audioFile) await deps.deleteAudio(entry.audioFile)
  })
  ipcMain.handle(IPC.historyRetry, (_e, id: string) => deps.queue.retryNow(id))
  ipcMain.handle(IPC.statsGet, () => ({
    ...deps.history.stats(),
    topTerms: deps.getTopTerms(),
    usage: deps.usage.stats()
  }))
  ipcMain.handle(IPC.copyText, (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
  })
  // раздел «Язык и регион» параметров Windows: оттуда ставится языковой пакет
  // распознавания, без которого встроенный движок не работает
  ipcMain.handle(IPC.openOcrSettings, () => {
    void shell.openExternal('ms-settings:regionlanguage')
  })

  // панель мгновенного перевода выделенного текста (Ctrl+V ×2)
  ipcMain.handle(IPC.translateRetarget, (_e, lang: string) => deps.translateRetarget(lang))
  ipcMain.handle(IPC.translateReplace, () => deps.translateReplace())
  ipcMain.handle(IPC.translateClose, () => deps.translateClose())

  // вкладка «Переводчик» и её история
  // распознавание текста на изображении (встроенный движок Windows)
  ipcMain.handle(IPC.ocrImage, (_e, data: ArrayBuffer) => deps.ocrImage(Buffer.from(data)))
  // раньше этот обработчик регистрировался прямо в index.ts, мимо registerIpc:
  // единственный канал не на своём месте — искать его было негде
  ipcMain.handle(IPC.regionPicked, (_e, rect: Electron.Rectangle | null) => deps.regionPicked(rect))

  ipcMain.handle(IPC.translateRun, (_e, payload: { text: string; targetLang: string }) =>
    deps.translateRun(payload.text, payload.targetLang)
  )
  ipcMain.handle(IPC.translationsList, (_e, search?: string) => deps.translations.list(search, 50))
  ipcMain.handle(IPC.translationsDelete, (_e, id: string) => deps.translations.delete(id))
  ipcMain.handle(IPC.translationsClear, () => deps.translations.clear())

  // озвучивание текста (Ctrl+C ×2 / кнопка «Слушать» / «Проверить голос»)
  ipcMain.handle(IPC.speakText, (_e, payload: { text: string; voice?: string }) =>
    deps.speakText(payload.text, payload.voice)
  )
  ipcMain.handle(IPC.speakControl, (_e, payload: { action: 'pause' | 'resume' | 'stop' }) =>
    deps.speakControl(payload.action)
  )

  // быстрые действия из плавающей панели: те же операции, что и по горячим клавишам
  ipcMain.handle(IPC.openMain, (_e, tab?: string) => deps.openMain(tab))
  ipcMain.handle(IPC.dictateToggle, () => deps.dictateToggle())
  ipcMain.handle(IPC.ocrRegion, () => deps.ocrRegion())
  ipcMain.handle(IPC.speakSelection, () => deps.speakSelection())
  ipcMain.handle(IPC.translateSelection, () => deps.translateSelection())

  ipcMain.handle(IPC.appVersion, () => deps.appVersion)
  ipcMain.handle(IPC.localStatus, () => localStatus(deps.dataDir))
  ipcMain.handle(IPC.localDownload, async (): Promise<{ ok: boolean; message?: string }> => {
    try {
      await downloadLocal(
        deps.dataDir,
        (pct, phase) => deps.broadcastLocalProgress({ pct, phase }),
        undefined,
        deps.engineDir
      )
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle(IPC.localGpu, async (): Promise<{ ok: boolean; message?: string }> => {
    try {
      await downloadGpu(deps.dataDir, (pct, phase) => deps.broadcastLocalProgress({ pct, phase }))
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle(IPC.localRemove, async () => {
    const { dir } = localPaths(deps.dataDir)
    await fsp.rm(dir, { recursive: true, force: true })
  })

  // перенос ключа между компьютерами файлом .vfk. Файл обычно кладут в «Документы»,
  // а те синхронизируются с облаком — поэтому содержимое закрыто парольной фразой
  ipcMain.handle(IPC.keyExport, async (_e, passphrase: string): Promise<KeyExportResult> => {
    const key = deps.settings.getApiKey()
    if (!key) return 'no-key'
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) {
      return 'weak-passphrase'
    }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: `Сохранить файл ключа ${APP_NAME}`,
      defaultPath: join(app.getPath('documents'), 'verbo-key.vfk'),
      filters: [{ name: `Ключ ${APP_NAME}`, extensions: ['vfk'] }]
    })
    if (canceled || !filePath) return 'cancelled'
    await fsp.writeFile(filePath, packKeyFile(key, passphrase), 'utf-8')
    return 'ok'
  })
  ipcMain.handle(IPC.keyImport, async (_e, passphrase: string): Promise<KeyImportResult> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: `Открыть файл ключа ${APP_NAME}`,
      filters: [{ name: `Ключ ${APP_NAME}`, extensions: ['vfk', 'txt'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return 'cancelled'
    let raw: string
    try {
      raw = await fsp.readFile(filePaths[0], 'utf-8')
    } catch {
      return 'damaged'
    }
    const opened = unpackKeyFile(raw, typeof passphrase === 'string' ? passphrase : '')
    if (!opened.ok) return opened.reason
    // ключ распакован — но принимает ли его сервис. Недоступность сервиса и
    // негодный ключ РАЗНЫЕ вещи: раньше оба сводились к «не принят»
    const проверка = await checkKey(opened.key, undefined, log)
    log(`ключ из файла: проверка — ${проверка}`)
    if (проверка === 'unreachable' || проверка === 'blocked') return 'unreachable'
    if (проверка !== 'ok') return 'rejected'
    deps.settings.setApiKey(opened.key)
    return 'ok'
  })
}
