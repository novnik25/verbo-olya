import type { HistoryEntry } from '../../shared/types'
import type { HistoryService } from './history'

// 30 с → 60 с → 5 м → 15 м, далее каждые 30 м (спека, раздел «Оффлайн-очередь»)
const BACKOFF_MS = [30_000, 60_000, 300_000, 900_000]
const REPEAT_MS = 1_800_000

export function backoffDelayMs(attempts: number): number {
  return BACKOFF_MS[attempts] ?? REPEAT_MS
}

export type ProcessResult =
  | { ok: true; rawText: string; styledText: string }
  | { ok: false; kind: 'transient' | 'auth' | 'permanent'; message: string }

export interface QueueDeps {
  history: HistoryService
  process: (entry: HistoryEntry) => Promise<ProcessResult>
  isOnline: () => boolean
  onProcessed: (entry: HistoryEntry) => void
  now?: () => number
  pollMs?: number
}

export class QueueService {
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false

  constructor(private deps: QueueDeps) {}

  start(): void {
    this.timer = setInterval(() => void this.kick(), this.deps.pollMs ?? 15_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async retryNow(id: string): Promise<void> {
    this.deps.history.update(id, { status: 'pending', nextRetryAt: undefined })
    await this.kick()
  }

  async kick(): Promise<void> {
    if (this.busy || !this.deps.isOnline()) return
    this.busy = true
    try {
      const now = this.deps.now?.() ?? Date.now()
      const due = this.deps.history
        .pending()
        .filter((e) => !e.nextRetryAt || Date.parse(e.nextRetryAt) <= now)
      for (const entry of due) {
        this.deps.history.update(entry.id, { status: 'processing' })
        let result: ProcessResult
        try {
          result = await this.deps.process(entry)
        } catch (err) {
          // process не должен кидать, но запись не имеет права зависнуть в processing
          result = { ok: false, kind: 'transient', message: String(err) }
        }
        if (result.ok) {
          const updated = this.deps.history.update(entry.id, {
            status: 'done',
            rawText: result.rawText,
            styledText: result.styledText,
            error: undefined,
            nextRetryAt: undefined
          })
          if (updated) this.deps.onProcessed(updated)
        } else if (result.kind === 'permanent') {
          this.deps.history.update(entry.id, { status: 'failed', error: result.message })
        } else {
          this.deps.history.update(entry.id, {
            status: 'pending',
            attempts: entry.attempts + 1,
            nextRetryAt: new Date(now + backoffDelayMs(entry.attempts)).toISOString(),
            error: result.message
          })
        }
      }
    } catch (err) {
      // разовая ошибка чтения/записи истории: попробуем в следующий поллинг
      console.error('queue.kick:', err)
    } finally {
      this.busy = false
    }
  }
}
