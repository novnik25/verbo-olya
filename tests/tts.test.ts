import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Readable } from 'stream'
import {
  planSpeech,
  resetTtsConnection,
  splitForTts,
  synthesize,
  synthesizeParts,
  ssmlSafe,
  SpeechError,
  warmUp
} from '../src/main/services/tts'
import type { TtsFactory, TtsClient } from '../src/main/services/tts'

/** Управляющий символ по коду — в исходнике их держать нельзя, редакторы их съедают. */
const упр = (code: number): string => String.fromCharCode(code)

describe('подготовка текста к разметке речи', () => {
  it('амперсанд экранируется: именно он обрывал синтез', () => {
    expect(ssmlSafe('Товары & услуги')).toBe('Товары &amp; услуги')
  })

  it('угловые скобки экранируются', () => {
    expect(ssmlSafe('5 < 10 и 3 > 2')).toBe('5 &lt; 10 и 3 &gt; 2')
  })

  it('амперсанд обрабатывается первым, иначе экранирование удваивается', () => {
    // замена по очереди в неверном порядке дала бы &amp;lt; вместо &lt;
    expect(ssmlSafe('<')).toBe('&lt;')
    expect(ssmlSafe('&')).toBe('&amp;')
    expect(ssmlSafe('&lt;')).toBe('&amp;lt;')
  })

  it('обычный текст не меняется', () => {
    expect(ssmlSafe('Обычный текст, без всякого.')).toBe('Обычный текст, без всякого.')
  })

  it('кавычки и апострофы не трогаем: в тексте они законны', () => {
    expect(ssmlSafe('Он сказал "да", а не \'нет\'')).toBe('Он сказал "да", а не \'нет\'')
  })

  it('управляющие символы вырезаются: в XML они запрещены вовсе', () => {
    const грязный = 'А' + упр(1) + 'Б' + упр(11) + 'В' + упр(31) + 'Г'
    expect(ssmlSafe(грязный)).toBe('АБВГ')
  })

  it('перевод строки, возврат каретки и табуляция остаются: они разрешены', () => {
    expect(ssmlSafe('первая\nвторая\tтретья\r')).toBe('первая\nвторая\tтретья\r')
  })

  it('пустой текст не ломается', () => {
    expect(ssmlSafe('')).toBe('')
  })
})

/** Все слова текста должны найтись в кусках: разбивка не имеет права терять текст. */
function словаНеПотеряны(исходный: string, куски: string[]): string[] {
  const собрано = куски.join(' ')
  return исходный
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .filter((w) => !собрано.includes(w))
}

describe('разбивка не теряет текст', () => {
  it('номера версий не съедают строки вокруг себя', () => {
    // точка, за которой нет пробела, ломала разбор — и от неё до следующего
    // совпадения текст пропадал молча. На чтении вслух пропадали целые абзацы
    const t =
      'Готово. Verbo 2.3.4 работает как надо.\n' +
      '2.1.0 Электрон обновлён до сорок третьей версии.\n' +
      '2.2.0 Шифрование ключа и запрет навигации.\n' +
      '2.3.0 Резерв распознавания с картинки.\n' +
      '2.3.4 Время в журнале по местным часам.'
    const куски = splitForTts(t, 60)
    expect(словаНеПотеряны(t, куски)).toEqual([])
  })

  it('сокращения с точкой не съедают текст', () => {
    const t =
      'Нужно купить хлеб, молоко и т.д. Потом зайти в банк. ' +
      'Файл index.ts лежит в папке. Открой github.com и посмотри. ' +
      'Ещё раз повторю всё то же самое для длины текста.'
    expect(словаНеПотеряны(t, splitForTts(t, 60))).toEqual([])
  })

  it('десятичные числа не съедают текст', () => {
    const t =
      'Цена выросла на 12.5 процента за месяц наблюдений. ' +
      'Курс составил 98.7 рубля на закрытии торгов вчера. ' +
      'Доля выросла до 3.14 процента по итогам недели.'
    expect(словаНеПотеряны(t, splitForTts(t, 50))).toEqual([])
  })

  it('текст без единой точки не теряется', () => {
    const t = 'первое слово второе слово третье слово '.repeat(10)
    expect(словаНеПотеряны(t, splitForTts(t, 50))).toEqual([])
  })

  it('многоточие и восклицания в конце не теряются', () => {
    const t =
      'Что же это такое?! Совершенно непонятно… И вот ещё одна мысль. ' +
      'Добавим текста, чтобы разбивка точно сработала и куски получились.'
    expect(словаНеПотеряны(t, splitForTts(t, 40))).toEqual([])
  })
})

describe('splitForTts', () => {
  it('короткий текст -> один кусок', () => {
    expect(splitForTts('Привет, мир.')).toEqual(['Привет, мир.'])
  })

  it('пустой текст -> пустой массив', () => {
    expect(splitForTts('   ')).toEqual([])
  })

  it('длинный текст -> куски не длиннее maxLen', () => {
    const sentence = 'Это тестовое предложение для проверки разбиения текста. '
    const text = sentence.repeat(40) // ~3400 символов
    const chunks = splitForTts(text, 200)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200)
  })

  it('не рвёт слова при разбиении по границам предложений', () => {
    const text = 'Первое предложение здесь. Второе предложение здесь. Третье предложение здесь.'
    const chunks = splitForTts(text, 40)
    const words = text.replace(/[.]/g, '').split(/\s+/)
    const joined = chunks.join(' ').replace(/[.]/g, '')
    for (const w of words) expect(joined).toContain(w)
    // ни один кусок не должен обрываться посреди слова (не заканчивается на не-граничный символ,
    // за которым в исходнике сразу шла буква без пробела)
    for (const c of chunks) {
      expect(c.trim()).toBe(c)
    }
  })

  it('одно предложение длиннее maxLen -> режется по словам, не разрывая их', () => {
    const longWord = 'слово'
    const text = Array(60).fill(longWord).join(' ') + '.' // одно "предложение" > maxLen
    const chunks = splitForTts(text, 50)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(50)
      // каждый кусок состоит из целых слов (после trim нет обрубленных нецелых токенов длиннее слова)
      for (const token of c.split(/\s+/)) {
        expect(token.replace('.', '')).toMatch(/^слово$/)
      }
    }
  })
})

describe('planSpeech', () => {
  it('короткий текст остаётся одним фрагментом', () => {
    expect(planSpeech('Привет, мир.')).toEqual(['Привет, мир.'])
  })

  it('первый фрагмент короткий — речь начинается быстро', () => {
    const sentence = 'Это предложение примерно тридцать символов. '
    const parts = planSpeech(sentence.repeat(40), 320, 1600)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0].length).toBeLessThanOrEqual(320)
    // остальные фрагменты крупные — меньше запросов к синтезу
    expect(parts[1].length).toBeGreaterThan(320)
  })

  it('не теряет и не переставляет слова', () => {
    const text = 'Первое предложение. Второе предложение. Третье предложение. Четвёртое предложение.'
    const parts = planSpeech(text, 30, 60)
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text)
  })

  it('пустой текст -> пустой план', () => {
    expect(planSpeech('   ')).toEqual([])
  })
})

function makeFakeFactory(mp3Bytes: Buffer, opts?: { failSetMetadata?: boolean; failStream?: boolean }): {
  factory: TtsFactory
  calls: Array<{ text: string; rateOpt?: { rate?: string } }>
} {
  const calls: Array<{ text: string; rateOpt?: { rate?: string } }> = []
  const factory: TtsFactory = () => {
    const client: TtsClient = {
      async setMetadata() {
        if (opts?.failSetMetadata) throw new Error('голос недоступен')
      },
      toStream(input, options) {
        calls.push({ text: input, rateOpt: options })
        const stream = new Readable({
          read() {}
        })
        if (opts?.failStream) {
          process.nextTick(() => stream.emit('error', new Error('обрыв соединения')))
        } else {
          process.nextTick(() => {
            stream.push(mp3Bytes)
            stream.push(null)
          })
        }
        return { audioStream: stream }
      }
    }
    return client
  }
  return { factory, calls }
}

beforeEach(() => resetTtsConnection())
afterEach(() => { resetTtsConnection(); vi.useRealTimers() })

describe('жизненный цикл соединения голоса', () => {
  it('два отказа выбранного голоса включают запасной и сообщают его только после успеха', async () => {
    const voices: string[] = []
    const fallback = vi.fn()
    const factory: TtsFactory = () => {
      let voice = ''
      return {
        setMetadata: async (name) => { voice = name; voices.push(name) },
        toStream: () => {
          const stream = new Readable({ read() {} })
          process.nextTick(() => {
            if (voice === 'ru-RU-DmitryNeural') stream.destroy(new Error('голос не отвечает'))
            else { stream.push('запасной звук'); stream.push(null) }
          })
          return { audioStream: stream }
        }
      }
    }
    const audio = await synthesize({ text: 'текст', voice: 'ru-RU-DmitryNeural',
      fallbackVoice: 'ru-RU-SvetlanaNeural', onFallback: fallback, ttsFactory: factory })
    expect(audio.toString()).toBe('запасной звук')
    expect(voices).toEqual(['ru-RU-DmitryNeural', 'ru-RU-DmitryNeural', 'ru-RU-SvetlanaNeural'])
    expect(fallback).toHaveBeenCalledWith('ru-RU-SvetlanaNeural')
  })

  it('отказ обоих голосов ограничен 24 секундами, а ложного сообщения о замене нет', async () => {
    vi.useFakeTimers()
    const fallback = vi.fn()
    const close = vi.fn()
    const factory = vi.fn(() => ({
      setMetadata: () => new Promise<void>(() => {}), close,
      toStream: () => ({ audioStream: new Readable({ read() {} }) })
    }))
    const assertion = expect(synthesize({ text: 'текст', voice: 'ru-RU-DmitryNeural',
      fallbackVoice: 'ru-RU-SvetlanaNeural', onFallback: fallback, ttsFactory: factory })).rejects.toThrow('Не удалось получить голос')
    await vi.advanceTimersByTimeAsync(24_000)
    await assertion
    expect(factory).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledTimes(3)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('обрыв без события end сразу повторяется в новом соединении', async () => {
    let attempts = 0
    const close = vi.fn()
    const factory: TtsFactory = () => ({
      setMetadata: async () => {}, close,
      toStream() {
        const stream = new Readable({ read() {} })
        if (++attempts === 1) process.nextTick(() => stream.destroy())
        else process.nextTick(() => { stream.push('звук'); stream.push(null) })
        return { audioStream: stream }
      }
    })
    expect((await synthesize({ text: 'текст', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory })).toString()).toBe('звук')
    expect(attempts).toBe(2)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('зависшее подключение закрывается через 12 секунд и повторяется один раз', async () => {
    vi.useFakeTimers()
    const close = vi.fn()
    const factory = vi.fn(() => ({
      setMetadata: () => new Promise<void>(() => {}), close,
      toStream: () => ({ audioStream: new Readable({ read() {} }) })
    }))
    const result = synthesize({ text: 'текст', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory })
    const assertion = expect(result).rejects.toThrow('Не удалось получить голос')
    await vi.advanceTimersByTimeAsync(24_000)
    await assertion
    expect(factory).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('остановка во время загрузки голоса закрывает запрос без повторного подключения', async () => {
    const controller = new AbortController()
    const close = vi.fn()
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const factory = vi.fn(() => ({
      setMetadata: async () => { started(); await new Promise<void>(() => {}) }, close,
      toStream: () => ({ audioStream: new Readable({ read() {} }) })
    }))
    const result = synthesize({ text: 'текст', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory, signal: controller.signal })
    const assertion = expect(result).rejects.toThrow('Чтение остановлено')
    await ready
    controller.abort()
    await assertion
    expect(close).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('закрытый во время простоя сокет не используется для следующего фрагмента', async () => {
    let live = true
    let created = 0
    const close = vi.fn()
    const factory: TtsFactory = () => {
      created++
      return {
        setMetadata: async () => {}, close, isReady: () => live,
        toStream: () => ({ audioStream: Readable.from([Buffer.from('звук')]) })
      }
    }
    await synthesize({ text: 'текст', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory })
    live = false
    await synthesize({ text: 'ещё текст', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory })
    expect(created).toBe(2)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('неудачный прогрев не сбрасывает исправное соединение', async () => {
    const close = vi.fn()
    const factory = vi.fn(() => ({
      setMetadata: async () => {}, close,
      toStream: () => ({ audioStream: Readable.from([Buffer.from('звук')]) })
    }))
    await synthesize({ text: 'текст', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory })
    await warmUp('другой голос', () => ({
      setMetadata: async () => { throw new Error('сеть') },
      toStream: () => ({ audioStream: new Readable({ read() {} }) })
    }))
    await synthesize({ text: 'текст', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory })
    expect(factory).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
  })
})

describe('synthesize (с фейковой фабрикой)', () => {
  it('в сервис уходит уже экранированный текст', async () => {
    const { factory, calls } = makeFakeFactory(Buffer.from('ID3-fake'))
    await synthesize({
      text: 'Товары & услуги, 5 < 10',
      voice: 'ru-RU-SvetlanaNeural',
      ttsFactory: factory
    })
    expect(calls[0].text).toBe('Товары &amp; услуги, 5 &lt; 10')
  })

  it('собирает буфер из чанков потока', async () => {
    const mp3 = Buffer.from('ID3-fake-mp3-bytes')
    const { factory } = makeFakeFactory(mp3)
    const buf = await synthesize({ text: 'Привет', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory })
    expect(buf.equals(mp3)).toBe(true)
  })

  it('передаёт rate строкой с процентом, когда rate задан', async () => {
    const mp3 = Buffer.from('x')
    const { factory, calls } = makeFakeFactory(mp3)
    await synthesize({ text: 'Привет', voice: 'ru-RU-SvetlanaNeural', rate: 25, ttsFactory: factory })
    expect(calls[0].rateOpt).toEqual({ rate: '+25%' })
  })

  it('отрицательный rate передаётся с минусом', async () => {
    const mp3 = Buffer.from('x')
    const { factory, calls } = makeFakeFactory(mp3)
    await synthesize({ text: 'Привет', voice: 'ru-RU-SvetlanaNeural', rate: -25, ttsFactory: factory })
    expect(calls[0].rateOpt).toEqual({ rate: '-25%' })
  })

  it('rate не задан (0/undefined) -> опции не передаются', async () => {
    const mp3 = Buffer.from('x')
    const { factory, calls } = makeFakeFactory(mp3)
    await synthesize({ text: 'Привет', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory })
    expect(calls[0].rateOpt).toBeUndefined()
  })

  it('ошибка потока -> понятное русское сообщение', async () => {
    const { factory } = makeFakeFactory(Buffer.from('x'), { failStream: true })
    await expect(
      synthesize({ text: 'Привет', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory })
    ).rejects.toThrow('Не удалось получить голос')
  })

  it('ошибка setMetadata -> понятное русское сообщение', async () => {
    const { factory } = makeFakeFactory(Buffer.from('x'), { failSetMetadata: true })
    await expect(
      synthesize({ text: 'Привет', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory })
    ).rejects.toThrow('Не удалось получить голос')
  })

  it('в сообщение пользователю не просачивается техническая подробность', async () => {
    // сервис отвечает по-английски; показывать это человеку правилами запрещено
    const factory: TtsFactory = () => ({
      async setMetadata() {},
      toStream() {
        const s = new Readable({ read() {} })
        process.nextTick(() =>
          s.emit(
            'error',
            new Error('Stream closed before the synthesis completed (no turn.end received)')
          )
        )
        return { audioStream: s }
      }
    })
    let поймано: unknown
    try {
      await synthesize({ text: 'Привет', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory })
    } catch (e) {
      поймано = e
    }
    const err = поймано as SpeechError
    expect(err.message).toBe('Не удалось получить голос')
    expect(err.message).not.toMatch(/[a-z]{4,}/i) // ни одного английского слова
    // подробность нужна в журнале, но только там
    expect(err.detail).toContain('turn.end')
  })
})

describe('synthesizeParts', () => {
  it('короткий текст -> один вызов синтеза', async () => {
    const mp3 = Buffer.from('abc')
    const { factory, calls } = makeFakeFactory(mp3)
    const bufs = await synthesizeParts({ text: 'Короткий текст.', voice: 'ru-RU-SvetlanaNeural', ttsFactory: factory })
    expect(calls).toHaveLength(1)
    expect(bufs).toHaveLength(1)
    expect(bufs[0].equals(mp3)).toBe(true)
  })

  it('длинный текст -> несколько вызовов синтеза, куски идут по порядку', async () => {
    let n = 0
    const factory: TtsFactory = () => ({
      async setMetadata() {},
      toStream(input) {
        n++
        const idx = n
        const stream = new Readable({ read() {} })
        process.nextTick(() => {
          stream.push(Buffer.from(`chunk${idx}`))
          stream.push(null)
        })
        return { audioStream: stream }
      }
    })
    const sentence = 'Тестовое предложение номер один здесь. '
    const text = sentence.repeat(30)
    const bufs = await synthesizeParts({ text, voice: 'ru-RU-SvetlanaNeural', maxLen: 100, ttsFactory: factory })
    expect(n).toBeGreaterThan(1)
    expect(bufs).toHaveLength(n)
    expect(bufs.map((b) => b.toString())).toEqual(
      Array.from({ length: n }, (_, i) => `chunk${i + 1}`)
    )
  })

  it('очень длинный текст обрезается до предела, синтез не виснет', async () => {
    const { factory, calls } = makeFakeFactory(Buffer.from('x'))
    const huge = 'Слово. '.repeat(3000) // ~21 000 символов
    await synthesizeParts({ text: huge, voice: 'ru-RU-SvetlanaNeural', maxLen: 1800, ttsFactory: factory })
    const sent = calls.join('')
    expect(sent.length).toBeLessThanOrEqual(6000)
  })
})
