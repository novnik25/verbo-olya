import type {
  SettingsPublic,
  HistoryEntry,
  StatsPayload,
  HotkeyCombo,
  TranslationEntry,
  KeyExportResult,
  KeyImportResult
} from '../../shared/types'
import type { PhoneticsReply } from '../../shared/phonetics'

export interface VoxApi {
  getSettings(): Promise<SettingsPublic>
  updateSettings(patch: Partial<SettingsPublic>): Promise<SettingsPublic>
  setApiKey(key: string): Promise<void>
  verifyApiKey(key?: string): Promise<'ok' | 'invalid' | 'malformed' | 'blocked' | 'unreachable'>
  captureHotkey(): Promise<HotkeyCombo | null>
  listHistory(search?: string): Promise<HistoryEntry[]>
  deleteHistory(id: string): Promise<void>
  retryHistory(id: string): Promise<void>
  getStats(): Promise<StatsPayload>
  copyText(text: string): Promise<void>
  openExternal(url: string): Promise<void>
  openOcrSettings(): Promise<void>
  exportKey(passphrase: string): Promise<KeyExportResult>
  importKey(passphrase: string): Promise<KeyImportResult>
  appVersion(): Promise<string>
  localStatus(): Promise<{ installed: boolean; upgradable: boolean; gpuReady: boolean; gpuAvailable: boolean }>
  localDownload(): Promise<{ ok: boolean; message?: string }>
  localGpu(): Promise<{ ok: boolean; message?: string }>
  localRemove(): Promise<void>
  speakText(text: string, voice?: string): Promise<{ ok: boolean; message?: string }>
  speakControl(action: 'pause' | 'resume' | 'stop'): Promise<void>
  ocrRegion(): Promise<void>
  ocrImage(data: ArrayBuffer): Promise<{
    ok: boolean
    text: string
    message?: string
    engineMissing?: boolean
  }>
  translateRun(text: string, targetLang: string): Promise<{ ok: boolean; result?: string; message?: string }>
  phonetics(text: string, lang?: string): Promise<PhoneticsReply>
  listTranslations(search?: string): Promise<TranslationEntry[]>
  deleteTranslation(id: string): Promise<void>
  clearTranslations(): Promise<void>
  on(channel: string, cb: (data: unknown) => void): () => void
}

export const vox = (window as unknown as { voxflow: VoxApi }).voxflow
