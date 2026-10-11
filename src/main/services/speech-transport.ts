import WebSocket from 'ws'
import { Readable } from 'stream'
import { randomUUID } from 'crypto'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import type { Agent } from 'http'
import type { TtsClient } from './tts'

let resolveProxy: (url: string) => Promise<string> = async () => 'DIRECT'

/** Голос должен пользоваться тем же VPN, что перевод и проверка кода. */
export function configureSpeechProxy(resolver: typeof resolveProxy): void {
  resolveProxy = resolver
}

export function speechProxyAgent(route: string): Agent | undefined {
  const first = route.split(';')[0].trim()
  if (first === 'DIRECT' || !first) return undefined
  const [kind, address] = first.split(/\s+/)
  if (!address) throw new Error('Неверный адрес прокси для голоса')
  if (kind === 'PROXY' || kind === 'HTTPS') {
    return new HttpsProxyAgent(`${kind === 'HTTPS' ? 'https' : 'http'}://${address}`)
  }
  if (kind === 'SOCKS' || kind === 'SOCKS5' || kind === 'SOCKS4') {
    return new SocksProxyAgent(`${kind === 'SOCKS4' ? 'socks4a' : 'socks5h'}://${address}`)
  }
  throw new Error(`Неизвестный способ подключения голоса: ${kind}`)
}

/**
 * У библиотеки отправка в закрытый сокет запускала скрытые переподключения,
 * оставляя старый поток без ответа. Здесь каждое соединение обслуживает один
 * запрос, а обрыв или ошибка отправки сразу завершают именно его поток.
 * Подпись адреса берём у библиотеки: она следует изменениям сервиса.
 */
export class EdgeSpeechClient implements TtsClient {
  private socket: WebSocket | null = null
  private stream: Readable | null = null
  private requestId = ''
  private voice = ''
  private closed = false

  // Версия библиотеки закреплена: её внутренняя подпись проверяется живым
  // прогоном перед обновлением, иначе сервис отвергнет весь транспорт.
  constructor(private agent?: Agent, private getUrl = () =>
    (MsEdgeTTS as unknown as { getSynthUrl(): Promise<string> }).getSynthUrl()) {}

  isReady(): boolean { return this.socket?.readyState === WebSocket.OPEN }

  async setMetadata(voice: string, format: OUTPUT_FORMAT): Promise<void> {
    this.voice = voice
    const url = await this.getUrl()
    if (this.closed) throw new Error('Подключение голоса отменено')
    const ws = new WebSocket(url, {
      agent: this.agent,
      handshakeTimeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold'
      }
    })
    this.socket = ws
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        const body = JSON.stringify({ context: { synthesis: { audio: {
          metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
          outputFormat: format
        } } } })
        ws.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${body}`,
          (err) => err ? reject(err) : resolve())
      })
      ws.on('error', (err) => { reject(err); this.fail(err) })
      ws.on('close', () => {
        const err = new Error('Соединение голоса закрыто до завершения ответа')
        reject(err)
        this.fail(err)
      })
      ws.on('message', (data, binary) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        const headerLength = binary && buf.length >= 2 ? buf.readUInt16BE(0) : 0
        const headers = binary ? buf.subarray(2, 2 + headerLength).toString() : buf.toString()
        if (!headers.includes(`X-RequestId:${this.requestId}\r\n`) || !this.stream) return
        if (/Path:audio\r\n/.test(headers) && binary) {
          this.stream.push(buf.subarray(2 + headerLength))
        } else if (/Path:turn.end(?:\r\n|$)/.test(headers)) {
          const stream = this.stream
          this.stream = null
          stream.push(null)
        }
      })
    })
  }

  toStream(text: string, opts?: { rate?: string }): { audioStream: Readable } {
    if (!this.isReady() || this.stream) throw new Error('Соединение голоса не готово')
    const stream = new Readable({ read() {} })
    this.stream = stream
    this.requestId = randomUUID().replace(/-/g, '')
    const locale = this.voice.split('-').slice(0, 2).join('-')
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${this.voice}"><prosody pitch="+0Hz" rate="${opts?.rate ?? '+0%'}" volume="+0%">${text}</prosody></voice></speak>`
    this.socket!.send(`X-RequestId:${this.requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`,
      (err) => { if (err) this.fail(err) })
    return { audioStream: stream }
  }

  private fail(err: Error): void {
    const stream = this.stream
    this.stream = null
    stream?.destroy(err)
  }

  close(): void {
    this.closed = true
    this.fail(new Error('Подключение голоса отменено'))
    this.socket?.terminate()
    this.agent?.destroy()
  }
}

export async function createSpeechClient(): Promise<TtsClient> {
  const route = await resolveProxy('https://speech.platform.bing.com/')
  return new EdgeSpeechClient(speechProxyAgent(route))
}
