import { MAX_RECORDING_MS, MIN_RECORDING_MS } from '../../shared/types'
import { looksHallucinated } from '../../shared/lang'
import type { OverlayState } from '../../shared/types'
import type { HistoryService } from './history'
import type { ProcessResult } from './queue'

export type PipelineState = 'idle' | 'recording' | 'processing'

export interface PipelineDeps {
  recorder: {
    start(): Promise<void>
    stop(): Promise<{ audioFile: string; durationMs: number; audio: Buffer }>
    cancel(): Promise<void>
  }
  process: (input: { audio: Buffer; entryId: string }) => Promise<ProcessResult>
  insert: (text: string) => Promise<'inserted' | 'clipboard-only'>
  overlay: (s: OverlayState) => void
  history: HistoryService
  currentStyleId: () => string
  currentOutputLang: () => import('../../shared/lang').OutputLang
  notify: (title: string, body: string) => void
  discardAudio: (audioFile: string) => Promise<void>
  maxDurationMs?: number
}

export class DictationPipeline {
  private _state: PipelineState = 'idle'
  private maxTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private deps: PipelineDeps) {}

  get state(): PipelineState {
    return this._state
  }

  holdStart(): void {
    if (this._state !== 'idle') return
    this._state = 'recording'
    this.deps.overlay({ phase: 'recording', level: 0 })
    void this.deps.recorder.start().catch(() => {
      this.clearMaxTimer()
      this._state = 'idle'
      this.deps.overlay({ phase: 'error', message: 'Запись не начата' })
      this.deps.notify('Не удалось начать запись', 'Проверьте подключение микрофона и разрешение на доступ к нему')
    })
    this.maxTimer = setTimeout(() => void this.holdEnd(), this.deps.maxDurationMs ?? MAX_RECORDING_MS)
  }

  private clearMaxTimer(): void {
    if (this.maxTimer) clearTimeout(this.maxTimer)
    this.maxTimer = null
  }

  async cancel(): Promise<void> {
    if (this._state !== 'recording') return
    this.clearMaxTimer()
    this._state = 'idle'
    await this.deps.recorder.cancel()
    this.deps.overlay({ phase: 'hidden' })
  }

  async holdEnd(): Promise<void> {
    if (this._state !== 'recording') return
    this.clearMaxTimer()
    this._state = 'processing'
    try {
      let stopped: { audioFile: string; durationMs: number; audio: Buffer }
      try {
        stopped = await this.deps.recorder.stop()
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : 'Не удалось выполнить запись'
        this.deps.overlay({ phase: 'error', message })
        this.deps.notify('Запись не выполнена', message)
        return
      }
      const { audioFile, durationMs, audio } = stopped
      if (durationMs < MIN_RECORDING_MS) {
        await this.deps.discardAudio(audioFile)
        this.deps.overlay({ phase: 'hidden' })
        return
      }
      const entry = this.deps.history.add({
        durationMs,
        status: 'processing',
        styleId: this.deps.currentStyleId(),
        outputLang: this.deps.currentOutputLang(),
        audioFile,
        attempts: 0
      })
      this.deps.overlay({ phase: 'transcribing' })
      const result = await this.deps.process({ audio, entryId: entry.id })
      if (result.ok) {
        // на пустой записи модель выдаёт дежурные фразы («Thank you», «Спасибо
        // за просмотр») — это не речь пользователя
        if (looksHallucinated(result.styledText, durationMs)) {
          this.deps.history.delete(entry.id)
          await this.deps.discardAudio(audioFile)
          this.deps.overlay({ phase: 'empty' })
          return
        }
        if (!result.styledText.trim()) {
          this.deps.history.delete(entry.id)
          await this.deps.discardAudio(audioFile)
          this.deps.overlay({ phase: 'empty' })
          return
        }
        this.deps.history.update(entry.id, {
          status: 'done',
          rawText: result.rawText,
          styledText: result.styledText
        })
        this.deps.overlay({ phase: 'done' })
        const how = await this.deps.insert(result.styledText)
        if (how === 'clipboard-only') {
          // вставить было некуда (курсор не в поле ввода) — карточка с текстом, как у Wispr
          this.deps.overlay({ phase: 'copied', text: result.styledText })
        }
      } else if (result.kind === 'permanent') {
        this.deps.history.update(entry.id, { status: 'failed', error: result.message })
        this.deps.overlay({ phase: 'error', message: 'Запись не распознана' })
      } else if (result.kind === 'auth') {
        this.deps.history.update(entry.id, { status: 'pending', error: result.message })
        this.deps.overlay({ phase: 'error', message: 'Ключ доступа отклонён' })
        this.deps.notify('Ключ доступа отклонён', 'Проверьте ключ в разделе «Настройки» → «Доступ и данные»')
      } else {
        this.deps.history.update(entry.id, { status: 'pending', error: result.message })
        this.deps.overlay({ phase: 'queued' })
        this.deps.notify('Запись отложена', 'Распознавание выполнится после восстановления подключения')
      }
    } finally {
      this._state = 'idle'
    }
  }
}
