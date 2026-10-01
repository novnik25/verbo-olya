import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HistoryService } from '../src/main/core/history'
import { QueueService, backoffDelayMs, type ProcessResult } from '../src/main/core/queue'
import type { HistoryEntry } from '../src/shared/types'

describe('backoffDelayMs', () => {
  it('30с, 60с, 5м, 15м, потом всегда 30м', () => {
    expect(backoffDelayMs(0)).toBe(30_000)
    expect(backoffDelayMs(1)).toBe(60_000)
    expect(backoffDelayMs(2)).toBe(300_000)
    expect(backoffDelayMs(3)).toBe(900_000)
    expect(backoffDelayMs(4)).toBe(1_800_000)
    expect(backoffDelayMs(99)).toBe(1_800_000)
  })
})

let h: HistoryService
let online: boolean
let results: ProcessResult[]
let processed: HistoryEntry[]
let q: QueueService
const NOW = 1_000_000

beforeEach(() => {
  h = new HistoryService(join(mkdtempSync(join(tmpdir(), 'vf-')), 'h.json'))
  online = true
  results = []
  processed = []
  q = new QueueService({
    history: h,
    process: async () => results.shift()!,
    isOnline: () => online,
    onProcessed: (e) => processed.push(e),
    now: () => NOW
  })
})

const pend = (over: Partial<HistoryEntry> = {}) =>
  h.add({ durationMs: 1000, status: 'pending', styleId: 'raw', attempts: 0, ...over })

describe('QueueService.kick', () => {
  it('успех: pending -> done, текст сохранён, onProcessed вызван', async () => {
    pend()
    results.push({ ok: true, rawText: 'раз', styledText: 'раз' })
    await q.kick()
    const e = h.list()[0]
    expect(e.status).toBe('done')
    expect(e.styledText).toBe('раз')
    expect(processed).toHaveLength(1)
  })
  it('transient: attempts+1, nextRetryAt по backoff, статус pending', async () => {
    pend()
    results.push({ ok: false, kind: 'transient', message: 'сеть' })
    await q.kick()
    const e = h.list()[0]
    expect(e.status).toBe('pending')
    expect(e.attempts).toBe(1)
    expect(e.nextRetryAt).toBe(new Date(NOW + 30_000).toISOString())
  })
  it('permanent: статус failed с ошибкой', async () => {
    pend()
    results.push({ ok: false, kind: 'permanent', message: 'формат' })
    await q.kick()
    expect(h.list()[0].status).toBe('failed')
    expect(h.list()[0].error).toBe('формат')
  })
  it('не трогает записи, у которых nextRetryAt в будущем', async () => {
    pend({ nextRetryAt: new Date(NOW + 60_000).toISOString() })
    await q.kick()
    expect(h.list()[0].status).toBe('pending')
    expect(processed).toHaveLength(0)
  })
  it('оффлайн: ничего не делает', async () => {
    online = false
    pend()
    results.push({ ok: true, rawText: 'x', styledText: 'x' })
    await q.kick()
    expect(h.list()[0].status).toBe('pending')
  })
  it('retryNow сбрасывает ожидание и обрабатывает сразу', async () => {
    const e = pend({ nextRetryAt: new Date(NOW + 999_999).toISOString() })
    results.push({ ok: true, rawText: 'x', styledText: 'x' })
    await q.retryNow(e.id)
    expect(h.list()[0].status).toBe('done')
  })
  it('auth: как transient — назад в pending с backoff', async () => {
    pend()
    results.push({ ok: false, kind: 'auth', message: '401' })
    await q.kick()
    const e = h.list()[0]
    expect(e.status).toBe('pending')
    expect(e.attempts).toBe(1)
    expect(e.nextRetryAt).toBe(new Date(NOW + 30_000).toISOString())
  })
  it('исключение в process не теряет запись: назад в pending', async () => {
    pend()
    const qThrow = new QueueService({
      history: h,
      process: async () => { throw new Error('boom') },
      isOnline: () => true,
      onProcessed: () => {},
      now: () => NOW
    })
    await qThrow.kick()
    const e = h.list()[0]
    expect(e.status).toBe('pending')
    expect(e.attempts).toBe(1)
  })
})
