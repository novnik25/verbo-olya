import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DictationPipeline } from '../src/main/core/pipeline'
import { HistoryService } from '../src/main/core/history'
import type { OverlayState } from '../src/shared/types'
import type { ProcessResult } from '../src/main/core/queue'

let h: HistoryService
let overlays: OverlayState[]
let inserted: string[]
let notices: string[]
let procResult: ProcessResult
let insertResult: 'inserted' | 'clipboard-only'
let recDuration: number
let cancelled: boolean
let micFail: boolean
let startFail: boolean
let discarded: string[]
let p: DictationPipeline

beforeEach(() => {
  h = new HistoryService(join(mkdtempSync(join(tmpdir(), 'vf-')), 'h.json'))
  overlays = []
  inserted = []
  notices = []
  procResult = { ok: true, rawText: 'сырой', styledText: 'готовый' }
  insertResult = 'inserted'
  recDuration = 5000
  cancelled = false
  micFail = false
  startFail = false
  discarded = []
  p = new DictationPipeline({
    recorder: {
      start: async () => {
        if (startFail) throw new Error('mkdir')
      },
      stop: async () => {
        if (micFail) throw new Error('Нет доступа к микрофону')
        return { audioFile: 'a.webm', durationMs: recDuration, audio: Buffer.from('x') }
      },
      cancel: async () => { cancelled = true }
    },
    process: async () => procResult,
    insert: async () => insertResult,
    overlay: (s) => overlays.push(s),
    history: h,
    currentStyleId: () => 'raw',
    currentOutputLang: () => 'none',
    notify: (t) => notices.push(t),
    discardAudio: async (f) => { discarded.push(f) }
  })
})

describe('DictationPipeline', () => {
  it('happy path: запись -> распознано -> вставлено -> done в истории', async () => {
    p.holdStart()
    expect(p.state).toBe('recording')
    await p.holdEnd()
    expect(p.state).toBe('idle')
    expect(inserted).toEqual([]) // insert мокнут, но проверим историю и оверлеи
    const e = h.list()[0]
    expect(e.status).toBe('done')
    expect(e.styledText).toBe('готовый')
    expect(overlays.map((o) => o.phase)).toEqual(['recording', 'transcribing', 'done'])
  })
  it('короткая запись отменяется', async () => {
    recDuration = 100
    p.holdStart()
    await p.holdEnd()
    expect(cancelled).toBe(false) // stop уже вызван; файл удаляет recorder.stop-вызывающий
    expect(h.list()).toHaveLength(0)
    expect(overlays.at(-1)?.phase).toBe('hidden')
    expect(discarded).toEqual(['a.webm'])
  })
  it('transient -> запись pending, overlay queued, уведомление', async () => {
    procResult = { ok: false, kind: 'transient', message: 'сеть' }
    p.holdStart()
    await p.holdEnd()
    const e = h.list()[0]
    expect(e.status).toBe('pending')
    expect(e.audioFile).toBe('a.webm')
    expect(overlays.at(-1)?.phase).toBe('queued')
    expect(notices).toHaveLength(1)
  })
  it('permanent -> failed, overlay error', async () => {
    procResult = { ok: false, kind: 'permanent', message: 'bad' }
    p.holdStart()
    await p.holdEnd()
    expect(h.list()[0].status).toBe('failed')
    expect(overlays.at(-1)).toMatchObject({ phase: 'error' })
  })
  it('auth -> запись pending, уведомление про ключ', async () => {
    procResult = { ok: false, kind: 'auth', message: '401' }
    p.holdStart()
    await p.holdEnd()
    expect(h.list()[0].status).toBe('pending')
    expect(overlays.at(-1)).toMatchObject({ phase: 'error' })
    expect(notices[0]).toBe('Ключ доступа отклонён')
  })
  it('нет микрофона -> уведомление, истории нет, состояние idle', async () => {
    micFail = true
    p.holdStart()
    await p.holdEnd()
    expect(h.list()).toHaveLength(0)
    expect(notices[0]).toBe('Запись не выполнена')
    expect(p.state).toBe('idle')
  })
  it('пустой текст -> запись удалена, overlay empty', async () => {
    procResult = { ok: true, rawText: '', styledText: '' }
    p.holdStart()
    await p.holdEnd()
    expect(h.list()).toHaveLength(0)
    expect(overlays.at(-1)?.phase).toBe('empty')
    expect(discarded).toEqual(['a.webm'])
  })
  it('clipboard-only -> карточка с распознанным текстом', async () => {
    insertResult = 'clipboard-only'
    p.holdStart()
    await p.holdEnd()
    expect(overlays.at(-1)).toMatchObject({ phase: 'copied', text: 'готовый' })
  })
  it('cancel во время записи: файл отменён, истории нет', async () => {
    p.holdStart()
    await p.cancel()
    expect(cancelled).toBe(true)
    expect(h.list()).toHaveLength(0)
    expect(p.state).toBe('idle')
  })
  it('holdStart игнорируется, пока идёт processing или recording', async () => {
    p.holdStart()
    p.holdStart() // второй раз — игнор
    expect(overlays.filter((o) => o.phase === 'recording')).toHaveLength(1)
  })
  it('сбой старта записи: состояние idle, overlay error, уведомление', async () => {
    startFail = true
    p.holdStart()
    await new Promise((r) => setTimeout(r, 0))
    expect(p.state).toBe('idle')
    expect(overlays.at(-1)).toMatchObject({ phase: 'error' })
    expect(notices[0]).toBe('Не удалось начать запись')
  })
})
