import { describe, it, expect } from 'vitest'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { OUTPUT_FORMAT } from 'msedge-tts'
import { EdgeSpeechClient, speechProxyAgent } from '../src/main/services/speech-transport'
import { backupVoice } from '../src/shared/voices'

async function withServer(run: (client: EdgeSpeechClient, onRequest: (handle: (socket: WebSocket, id: string) => void) => void) => Promise<void>): Promise<void> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address() as { port: number }
  const client = new EdgeSpeechClient(undefined, async () => `ws://127.0.0.1:${address.port}`)
  const onRequest = (handle: (socket: WebSocket, id: string) => void): void => {
    server.on('connection', (socket) => socket.on('message', (message) => {
      const text = message.toString()
      if (!text.includes('Path:ssml\r\n')) return
      const id = /X-RequestId:([^\r]+)/.exec(text)![1]
      handle(socket, id)
    }))
  }
  try { await run(client, onRequest) } finally {
    client.close()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function audioFrame(id: string, audio: string): Buffer {
  const headers = Buffer.from(`X-RequestId:${id}\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n`)
  const length = Buffer.alloc(2)
  length.writeUInt16BE(headers.length)
  return Buffer.concat([length, headers, Buffer.from(audio)])
}

describe('соединение сервиса голоса', () => {
  it('запасной голос сохраняет язык текста', () => {
    expect(backupVoice('ru-RU-DmitryNeural')).toBe('ru-RU-SvetlanaNeural')
    expect(backupVoice('en-US-GuyNeural')).toBe('en-US-AriaNeural')
    expect(backupVoice('неизвестный')).toBeUndefined()
  })
  it('последовательные запросы получают свои байты, ответы старого запроса игнорируются', async () => {
    await withServer(async (client, onRequest) => {
      let count = 0
      onRequest((socket, id) => {
        socket.send(audioFrame('старый-id', 'чужой звук'))
        socket.send(audioFrame(id, `звук-${++count}`))
        socket.send(`X-RequestId:${id}\r\nPath:turn.end\r\n\r\n`)
      })
      await client.setMetadata('ru-RU-SvetlanaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      expect(client.isReady()).toBe(true)
      for (let n = 1; n <= 2; n++) {
        const { audioStream } = client.toStream('текст')
        const chunks: Buffer[] = []
        for await (const chunk of audioStream) chunks.push(chunk)
        expect(Buffer.concat(chunks).toString()).toBe(`звук-${n}`)
      }
    })
  })

  it('обрыв до turn.end отклоняет поток и не выдаёт обрезанный звук', async () => {
    await withServer(async (client, onRequest) => {
      onRequest((socket, id) => { socket.send(audioFrame(id, 'начало')); socket.close() })
      await client.setMetadata('ru-RU-SvetlanaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      const { audioStream } = client.toStream('текст')
      await expect((async () => { for await (const _chunk of audioStream) {} })()).rejects.toThrow('до завершения')
      expect(client.isReady()).toBe(false)
    })
  })

  it('прокси Windows преобразуется без незаметного обхода VPN', () => {
    expect(speechProxyAgent('DIRECT')).toBeUndefined()
    expect(speechProxyAgent('PROXY 127.0.0.1:8888; DIRECT')).toBeDefined()
    expect(speechProxyAgent('HTTPS proxy.example:8443')).toBeDefined()
    expect(speechProxyAgent('SOCKS5 127.0.0.1:1080')).toBeDefined()
    expect(() => speechProxyAgent('UNKNOWN 127.0.0.1:1234; DIRECT')).toThrow('Неизвестный')
  })
})
