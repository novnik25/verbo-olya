import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'

const LISTENABLE = [
  IPC.historyChanged,
  IPC.overlayState,
  IPC.recStart,
  IPC.recStop,
  IPC.recConvert,
  IPC.localProgress,
  IPC.langChanged,
  IPC.netChanged,
  IPC.ttsPlay,
  IPC.ttsControl,
  IPC.translationsChanged,
  IPC.openTab,
  IPC.overlayDismiss
] as string[]

const api = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch: unknown) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  setApiKey: (key: string) => ipcRenderer.invoke(IPC.settingsSetApiKey, key),
  verifyApiKey: (key?: string) => ipcRenderer.invoke(IPC.settingsVerifyKey, key),
  captureHotkey: () => ipcRenderer.invoke(IPC.hotkeyCapture),
  listHistory: (search?: string) => ipcRenderer.invoke(IPC.historyList, search),
  deleteHistory: (id: string) => ipcRenderer.invoke(IPC.historyDelete, id),
  retryHistory: (id: string) => ipcRenderer.invoke(IPC.historyRetry, id),
  getStats: () => ipcRenderer.invoke(IPC.statsGet),
  copyText: (text: string) => ipcRenderer.invoke(IPC.copyText, text),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  openOcrSettings: () => ipcRenderer.invoke(IPC.openOcrSettings),
  exportKey: (passphrase: string) => ipcRenderer.invoke(IPC.keyExport, passphrase),
  importKey: (passphrase: string) => ipcRenderer.invoke(IPC.keyImport, passphrase),
  appVersion: () => ipcRenderer.invoke(IPC.appVersion),
  localStatus: () => ipcRenderer.invoke(IPC.localStatus),
  localDownload: () => ipcRenderer.invoke(IPC.localDownload),
  localGpu: () => ipcRenderer.invoke(IPC.localGpu),
  localRemove: () => ipcRenderer.invoke(IPC.localRemove),
  on: (channel: string, cb: (data: unknown) => void) => {
    if (!LISTENABLE.includes(channel)) throw new Error('канал запрещён: ' + channel)
    const handler = (_e: unknown, data: unknown) => cb(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  recChunk: (buf: ArrayBuffer) => ipcRenderer.send(IPC.recChunk, buf),
  recLevel: (level: number) => ipcRenderer.send(IPC.recLevel, level),
  recStopped: (info: { durationMs: number }) => ipcRenderer.send(IPC.recStopped, info),
  recConverted: (p: { id: string; wav: ArrayBuffer | null }) =>
    ipcRenderer.send(IPC.recConverted, p),
  overlayMouse: (p: { interactive: boolean }) => ipcRenderer.send(IPC.overlayMouse, p),
  translateRetarget: (lang: string) => ipcRenderer.invoke(IPC.translateRetarget, lang),
  translateReplace: () => ipcRenderer.invoke(IPC.translateReplace),
  translateClose: () => ipcRenderer.invoke(IPC.translateClose),
  ocrImage: (data: ArrayBuffer) => ipcRenderer.invoke(IPC.ocrImage, data),
  ocrRegion: () => ipcRenderer.invoke(IPC.ocrRegion),
  regionPicked: (rect: { x: number; y: number; width: number; height: number } | null) =>
    ipcRenderer.invoke(IPC.regionPicked, rect),
  translateRun: (text: string, targetLang: string) =>
    ipcRenderer.invoke(IPC.translateRun, { text, targetLang }),
  listTranslations: (search?: string) => ipcRenderer.invoke(IPC.translationsList, search),
  deleteTranslation: (id: string) => ipcRenderer.invoke(IPC.translationsDelete, id),
  clearTranslations: () => ipcRenderer.invoke(IPC.translationsClear),
  speakText: (text: string, voice?: string) => ipcRenderer.invoke(IPC.speakText, { text, voice }),
  speakControl: (action: 'pause' | 'resume' | 'stop') =>
    ipcRenderer.invoke(IPC.speakControl, { action }),
  ttsEnded: (p: { id: string }) => ipcRenderer.send(IPC.ttsEnded, p),
  openMain: (tab?: string) => ipcRenderer.invoke(IPC.openMain, tab),
  dictateToggle: () => ipcRenderer.invoke(IPC.dictateToggle),
  speakSelection: () => ipcRenderer.invoke(IPC.speakSelection),
  translateSelection: () => ipcRenderer.invoke(IPC.translateSelection)
}

contextBridge.exposeInMainWorld('voxflow', api)
export type VoxflowApi = typeof api
