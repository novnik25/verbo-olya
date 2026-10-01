import { createWriteStream, promises as fsp } from 'fs'
import { join } from 'path'
import type { BrowserWindow, IpcMain } from 'electron'
import type { WriteStream } from 'fs'
import { IPC } from '../../shared/types'

/** Пишет чанки от скрытого окна в файл recordings/<id>.webm. */
export class RecorderController {
  private stream: WriteStream | null = null
  private currentFile: string | null = null
  private startedAt = 0
  private stopWaiter: ((d: { durationMs: number }) => void) | null = null
  // recStopped может прийти ДО запроса stop (getUserMedia отказал мгновенно) — защёлкиваем
  private stoppedEarly: { durationMs: number } | null = null
  private convertWaiters = new Map<string, (wav: ArrayBuffer | null) => void>()

  constructor(
    private opts: {
      getWindow: () => BrowserWindow
      recordingsDir: string
      onLevel: (level: number) => void
    }
  ) {}

  wire(ipc: IpcMain): void {
    ipc.on(IPC.recChunk, (_e, buf: ArrayBuffer) => {
      this.stream?.write(Buffer.from(buf))
    })
    ipc.on(IPC.recLevel, (_e, level: number) => this.opts.onLevel(level))
    ipc.on(IPC.recStopped, (_e, info: { durationMs: number }) => {
      if (this.stopWaiter) {
        this.stopWaiter(info)
        this.stopWaiter = null
      } else {
        this.stoppedEarly = info
      }
    })
    ipc.on(IPC.recConverted, (_e, payload: { id: string; wav: ArrayBuffer | null }) => {
      const waiter = this.convertWaiters.get(payload.id)
      if (waiter) {
        this.convertWaiters.delete(payload.id)
        waiter(payload.wav)
      }
    })
  }

  async start(payload: {
    deviceId: string
    sounds: boolean
    playbackDeviceId?: string
  }): Promise<void> {
    await fsp.mkdir(this.opts.recordingsDir, { recursive: true })
    this.currentFile = `${Date.now()}.webm`
    this.stoppedEarly = null
    this.stream = createWriteStream(join(this.opts.recordingsDir, this.currentFile))
    this.startedAt = Date.now()
    this.opts.getWindow().webContents.send(IPC.recStart, payload)
  }

  private waitStopped(): Promise<{ durationMs: number }> {
    if (this.stoppedEarly) {
      const info = this.stoppedEarly
      this.stoppedEarly = null
      return Promise.resolve(info)
    }
    return new Promise((resolve) => {
      const fallback = setTimeout(() => {
        this.stopWaiter = null
        resolve({ durationMs: Date.now() - this.startedAt })
      }, 3000)
      this.stopWaiter = (d) => {
        clearTimeout(fallback)
        resolve(d)
      }
      this.opts.getWindow().webContents.send(IPC.recStop)
    })
  }

  private async closeStream(): Promise<void> {
    const s = this.stream
    this.stream = null
    if (s) await new Promise<void>((r) => s.end(() => r()))
  }

  async stop(): Promise<{ audioFile: string; durationMs: number; audio: Buffer }> {
    const { durationMs } = await this.waitStopped()
    await this.closeStream()
    const file = this.currentFile!
    this.currentFile = null
    if (durationMs < 0) {
      // нет доступа к микрофону
      await fsp.rm(join(this.opts.recordingsDir, file), { force: true })
      throw new Error('Нет доступа к микрофону')
    }
    const audio = await fsp.readFile(join(this.opts.recordingsDir, file))
    if (audio.length === 0) {
      // стоп обогнал первый чанк MediaRecorder — пустышку нельзя отправлять на распознавание
      await fsp.rm(join(this.opts.recordingsDir, file), { force: true })
      throw new Error('Запись не успела начаться — удерживайте клавишу чуть дольше')
    }
    return { audioFile: file, durationMs, audio }
  }

  async cancel(): Promise<void> {
    await this.waitStopped()
    await this.closeStream()
    if (this.currentFile) {
      await fsp.rm(join(this.opts.recordingsDir, this.currentFile), { force: true })
      this.currentFile = null
    }
  }

  /** Просит окно-рекордер перекодировать webm-буфер в wav 16кГц моно. null — не удалось/таймаут. */
  async convertToWav(audio: Buffer): Promise<Buffer | null> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.convertWaiters.delete(id)
        resolve(null)
      }, 30_000)
      this.convertWaiters.set(id, (wav) => {
        clearTimeout(timer)
        resolve(wav ? Buffer.from(wav) : null)
      })
      const data = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength)
      this.opts.getWindow().webContents.send(IPC.recConvert, { id, data })
    })
  }
}
