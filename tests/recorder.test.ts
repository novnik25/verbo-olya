import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RecorderController } from '../src/main/services/recorder'

type Handler = (e: unknown, ...args: unknown[]) => void
function fakeIpc() {
  const handlers = new Map<string, Handler>()
  return {
    on: (ch: string, h: Handler) => handlers.set(ch, h),
    emit: (ch: string, ...args: unknown[]) => handlers.get(ch)?.({}, ...args)
  }
}

describe('RecorderController: пустой файл', () => {
  it('stop() кидает понятную ошибку, если не пришло ни одного чанка', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vf-rec-'))
    const ipc = fakeIpc()
    const rec = new RecorderController({
      getWindow: () => ({ webContents: { send: () => {} } }) as never,
      recordingsDir: dir,
      onLevel: () => {}
    })
    rec.wire(ipc as never)
    await rec.start({ deviceId: 'default', sounds: false })
    ipc.emit('rec:stopped', { durationMs: 500 })
    await expect(rec.stop()).rejects.toThrow('Запись не успела начаться')
  })
})

describe('RecorderController: ранний recStopped (нет микрофона)', () => {
  it('stop() кидает «Нет доступа к микрофону», если -1 пришёл до запроса stop', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vf-rec-'))
    const sent: string[] = []
    const ipc = fakeIpc()
    const rec = new RecorderController({
      getWindow: () => ({ webContents: { send: (ch: string) => sent.push(ch) } }) as never,
      recordingsDir: dir,
      onLevel: () => {}
    })
    rec.wire(ipc as never)
    await rec.start({ deviceId: 'default', sounds: false })
    ipc.emit('rec:stopped', { durationMs: -1 })
    await expect(rec.stop()).rejects.toThrow('Нет доступа к микрофону')
  })
})
