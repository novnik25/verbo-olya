import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import type { Readable } from 'stream'

export { RU_VOICES, EN_VOICES, VOICES, pickVoice, voiceLabel } from '../../shared/voices'
// резка по предложениям живёт в core/: она нужна и переводу, а тому нечего делать в синтезе речи
import { splitForTts } from '../core/text-split'
export { splitForTts } from '../core/text-split'
export type { VoiceInfo } from '../../shared/voices'

const SYNTH_TIMEOUT_MS = 60_000
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
}
export type TtsFactory = () => TtsClient

const defaultFactory: TtsFactory = () => new MsEdgeTTS() as unknown as TtsClient

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
}
let pool: Pooled[] = []

async function acquire(voice: string, factory: TtsFactory): Promise<Pooled> {
  const i = pool.findIndex((p) => p.voice === voice && p.factory === factory)
  if (i !== -1) return pool.splice(i, 1)[0]
  const client = factory()
  await client.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
  return { voice, client, factory }
}

function release(p: Pooled): void {
  // держим не больше двух соединений: глубина предзагрузки — один фрагмент
  if (pool.length < 2) pool.push(p)
}

/** Сбрасывает пул соединений (тесты, смена сети). */
export function resetTtsConnection(): void {
  pool = []
}

/** Заранее поднимает соединение, чтобы первый фрагмент не ждал рукопожатия. */
export async function warmUp(voice: string, ttsFactory?: TtsFactory): Promise<void> {
  try {
    release(await acquire(voice, ttsFactory ?? defaultFactory))
  } catch {
    resetTtsConnection()
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
  })
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Превышено время ожидания ответа')), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
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
}): Promise<Buffer> {
  const factory = opts.ttsFactory ?? defaultFactory
  // rate в процентах: msedge-tts принимает относительный процент строкой ("+25%")
  const rate = opts.rate ? `${opts.rate > 0 ? '+' : ''}${opts.rate}%` : undefined
  // в сервис уходит только безопасная для разметки версия текста
  const text = ssmlSafe(opts.text)
  const run = async (reuse: boolean): Promise<Buffer> => {
    const pooled = reuse
      ? await acquire(opts.voice, factory)
      : await (async () => {
          const fresh = factory()
          await fresh.setMetadata(opts.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
          return { voice: opts.voice, client: fresh, factory }
        })()
    try {
      const { audioStream } = pooled.client.toStream(text, rate ? { rate } : undefined)
      const buf = await streamToBuffer(audioStream)
      release(pooled) // соединение исправно — вернём его следующему фрагменту
      return buf
    } catch (err) {
      throw err // клиент в пул не возвращаем: его состояние могло испортиться
    }
  }
  try {
    return await withTimeout(run(true), SYNTH_TIMEOUT_MS)
  } catch {
    // соединение могло закрыться по таймауту сервиса — одна попытка с новым
    try {
      return await withTimeout(run(false), SYNTH_TIMEOUT_MS)
    } catch (err) {
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
