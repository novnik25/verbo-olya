import { OUTPUT_FORMAT } from 'msedge-tts'
import type { Readable } from 'stream'
import { createSpeechClient } from './speech-transport'

export { RU_VOICES, EN_VOICES, VOICES, pickVoice, voiceLabel } from '../../shared/voices'
// резка по предложениям живёт в core/: она нужна и переводу, а тому нечего делать в синтезе речи
import { splitForTts } from '../core/text-split'
export { splitForTts } from '../core/text-split'
export type { VoiceInfo } from '../../shared/voices'

const SYNTH_TIMEOUT_MS = 12_000
const POOL_IDLE_MS = 15_000
/** Верхняя граница текста за раз: дальше синтез затягивается и рвётся по таймауту. */
export const MAX_SPEAK_CHARS = 6000
/**
 * Ниже этого размера MP3-буфер считаем пустым ответом сервиса: формат
 * AUDIO_24KHZ_48KBITRATE_MONO_MP3 даёт ~6 КБ/с, то есть 400 байт — это 67 мс,
 * короче любого реального фрагмента речи.
 */
export const MIN_SPEECH_BYTES = 400

/** Минимальный интерфейс msedge-tts, нужный синтезу — позволяет подменять фабрику в тестах. */
export interface TtsClient {
  setMetadata(voiceName: string, outputFormat: OUTPUT_FORMAT): Promise<void>
  toStream(input: string, options?: { rate?: string }): { audioStream: Readable }
  close?(): void
  isReady?(): boolean
}
export type TtsFactory = () => TtsClient | Promise<TtsClient>

const defaultFactory: TtsFactory = createSpeechClient

/**
 * Пул соединений с сервисом синтеза. Каждое соединение обслуживает ТОЛЬКО ОДИН
 * поток за раз: msedge-tts хранит состояние запроса внутри клиента, и второй
 * поток (предзагрузка следующего фрагмента) ронял его — «Cannot read properties
 * of undefined (reading 'audio')». Поэтому клиент выдаётся во временное
 * пользование и возвращается в пул после синтеза: рукопожатие не повторяется,
 * а одновременные потоки идут по разным соединениям.
 */
interface Pooled {
  voice: string
  client: TtsClient
  factory: TtsFactory
  releasedAt: number
  generation: number
}
let pool: Pooled[] = []
let generation = 0

function release(p: Pooled): void {
  if (pool.length < 2 && p.generation === generation) {
    p.releasedAt = Date.now()
    pool.push(p)
  } else p.client.close?.()
}

/** Сбрасывает пул соединений (тесты, смена сети). */
export function resetTtsConnection(): void {
  generation++
  for (const p of pool) p.client.close?.()
  pool = []
}

/** Заранее поднимает соединение, чтобы первый фрагмент не ждал рукопожатия. */
export async function warmUp(voice: string, ttsFactory?: TtsFactory): Promise<void> {
  try {
    await runAttempt(voice, ttsFactory ?? defaultFactory, true, async () => undefined)
  } catch {
    // Неудачный прогрев не должен закрывать исправный голос другой сессии.
  }
}

/**
 * Готовит план чтения: первый фрагмент намеренно короткий, чтобы речь началась
 * почти сразу. Размер остальных — компромисс: крупнее значит меньше запросов и
 * ровнее интонация, мельче — быстрее подхватывается смена голоса или темпа на
 * ходу (её применяет уже следующий фрагмент). Чистая функция.
 */
export function planSpeech(raw: string, firstLen = 180, restLen = 480): string[] {
  const chunks = splitForTts(raw.slice(0, MAX_SPEAK_CHARS), restLen)
  if (chunks.length === 0) return []
  const head = splitForTts(chunks[0], firstLen)
  if (head.length <= 1) return chunks
  // остаток первого крупного куска снова собираем крупно
  const tail = head.slice(1).join(' ')
  return [head[0], ...splitForTts(tail, restLen), ...chunks.slice(1)]
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
    stream.on('close', () => {
      if (!stream.readableEnded) reject(new Error('Поток голоса оборван'))
    })
  })
}

function runAttempt<T>(voice: string, factory: TtsFactory, reuse: boolean,
  work: (client: TtsClient) => Promise<T>, signal?: AbortSignal, timeoutMs = SYNTH_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    let client: TtsClient | undefined
    let finished = false
    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    const fail = (err: unknown): void => {
      if (finished) return
      finished = true
      cleanup()
      client?.close?.()
      reject(err)
    }
    const abort = (): void => fail(new Error('Чтение остановлено'))
    const timer = setTimeout(() => fail(new Error('Превышено время ожидания голоса')), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    const attemptGeneration = generation
    void (async () => {
      // Старые сокеты нельзя проверять запросом: их внутреннее переподключение
      // оставляло поток висеть. Отбрасываем их до отправки текста.
      pool = pool.filter((p) => {
        if (Date.now() - p.releasedAt <= POOL_IDLE_MS && (p.client.isReady?.() ?? true)) return true
        p.client.close?.()
        return false
      })
      const idx = reuse ? pool.findIndex((p) => p.voice === voice && p.factory === factory) : -1
      const pooled = idx >= 0 ? pool.splice(idx, 1)[0] : undefined
      client = pooled?.client ?? await factory()
      if (finished) { client.close?.(); return }
      if (!pooled) await client.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      if (finished) { client.close?.(); return }
      const result = await work(client)
      if (finished) { client.close?.(); return }
      finished = true
      cleanup()
      release({ voice, client, factory, releasedAt: Date.now(), generation: attemptGeneration })
      resolve(result)
    })().catch(fail)
  })
}

/**
 * Сбой синтеза. Человеку показываем только русскую фразу без подробностей —
 * сервис отвечает по-английски, и раньше его ответ выводился на экран как есть
 * («Stream closed before the synthesis completed…»). Техническая часть нужна,
 * но её место в журнале.
 */
export class SpeechError extends Error {
  constructor(readonly detail: string) {
    super('Не удалось получить голос')
    this.name = 'SpeechError'
  }
}

/**
 * Готовит произвольный текст к вставке в разметку речи (SSML).
 *
 * msedge-tts кладёт наш текст в XML КАК ЕСТЬ и ничего не экранирует. Любой
 * амперсанд или угловая скобка делают разметку невалидной, и сервис молча
 * обрывает поток: «Stream closed before the synthesis completed». А озвучиваем
 * мы чужой текст — скопированный из браузера, таблиц, переписки, — где «&»
 * встречается сплошь и рядом.
 *
 * Порядок замен важен: амперсанд первым, иначе «<» превратится в «&amp;lt;».
 * Управляющие символы вырезаем: в XML 1.0 они запрещены вовсе, а в скопированном
 * тексте попадаются.
 */
export function ssmlSafe(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Синтезирует один кусок текста (см. splitForTts) в MP3-буфер через msedge-tts. */
export async function synthesize(opts: {
  text: string
  voice: string
  rate?: number
  ttsFactory?: TtsFactory
  signal?: AbortSignal
  fallbackVoice?: string
  onFallback?: (voice: string) => void
}): Promise<Buffer> {
  const factory = opts.ttsFactory ?? defaultFactory
  // rate в процентах: msedge-tts принимает относительный процент строкой ("+25%")
  const rate = opts.rate ? `${opts.rate > 0 ? '+' : ''}${opts.rate}%` : undefined
  // в сервис уходит только безопасная для разметки версия текста
  const text = ssmlSafe(opts.text)
  const run = (reuse: boolean, voice = opts.voice, timeoutMs = SYNTH_TIMEOUT_MS): Promise<Buffer> => runAttempt(voice, factory, reuse,
    (client) => streamToBuffer(client.toStream(text, rate ? { rate } : undefined).audioStream), opts.signal, timeoutMs)
  try {
    return await run(true, opts.voice, opts.fallbackVoice ? 8000 : SYNTH_TIMEOUT_MS)
  } catch {
    if (opts.signal?.aborted) throw new Error('Чтение остановлено')
    // соединение могло закрыться по таймауту сервиса — одна попытка с новым
    try {
      return await run(false, opts.voice, opts.fallbackVoice ? 4000 : SYNTH_TIMEOUT_MS)
    } catch (err) {
      if (opts.signal?.aborted) throw new Error('Чтение остановлено')
      if (opts.fallbackVoice && opts.fallbackVoice !== opts.voice) {
        try {
          // Запасной голос укладывается в тот же общий предел 24 секунды.
          const audio = await run(true, opts.fallbackVoice)
          opts.onFallback?.(opts.fallbackVoice)
          return audio
        } catch (fallbackError) {
          throw new SpeechError(fallbackError instanceof Error ? fallbackError.message : String(fallbackError))
        }
      }
      throw new SpeechError(err instanceof Error ? err.message : String(err))
    }
  }
}

/**
 * Синтезирует весь текст, разбивая его на куски (splitForTts) и возвращая их
 * ОТДЕЛЬНЫМИ MP3-буферами. Склеивать их байт-в-байт нельзя: плеер сбивался,
 * перескакивал и начинал читать заново — куски проигрываются подряд плейлистом.
 */
export async function synthesizeParts(opts: {
  text: string
  voice: string
  rate?: number
  maxLen?: number
  ttsFactory?: TtsFactory
}): Promise<Buffer[]> {
  const text = opts.text.slice(0, MAX_SPEAK_CHARS)
  const chunks = splitForTts(text, opts.maxLen ?? 1800)
  const buffers: Buffer[] = []
  for (const chunk of chunks) {
    buffers.push(
      await synthesize({ text: chunk, voice: opts.voice, rate: opts.rate, ttsFactory: opts.ttsFactory })
    )
  }
  return buffers
}
