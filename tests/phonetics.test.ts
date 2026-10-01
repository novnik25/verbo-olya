import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  PhoneticsMemory,
  buildPhonetics,
  detectLang,
  foreignLang,
  normalizePron,
  parsePhoneticsReply,
  segmentText,
  wordKey
} from '../src/main/core/phonetics'
import { ipaToCyrillic, phoneticsKind, phoneticsLine, splitStress } from '../src/shared/phonetics'
import {
  PhoneticsService,
  phoneticsFailMessage,
  phoneticsPrompt,
  pickPhoneticsModel,
  reasoningParams,
  maxTokensFor,
  requestPronunciations
} from '../src/main/services/phonetics'
import { wrapForeignText } from '../src/shared/lang'

describe('segmentText', () => {
  it('слова и промежутки идут по порядку и вместе дают исходный текст', () => {
    const text = "I don't know, really!\nWell-known."
    const parts = segmentText(text, 'en')
    expect(parts.map((p) => p.text).join('')).toBe(text)
    expect(parts.filter((p) => p.word).map((p) => p.text)).toEqual([
      'I',
      "don't",
      'know',
      'really',
      'Well',
      'known'
    ])
  })

  it('числа — не слова: произносить их по значкам незачем', () => {
    const parts = segmentText('Room 101 is free', 'en')
    expect(parts.filter((p) => p.word).map((p) => p.text)).toEqual(['Room', 'is', 'free'])
  })

  it('соседние промежутки склеиваются в один', () => {
    const parts = segmentText('Hi, 42 friends', 'en')
    expect(parts).toEqual([
      { text: 'Hi', word: true },
      { text: ', 42 ', word: false },
      { text: 'friends', word: true }
    ])
  })

  it('китайский без пробелов всё равно делится на слова', () => {
    const words = segmentText('我喜欢学习中文', 'zh').filter((p) => p.word)
    expect(words.length).toBeGreaterThan(1)
    expect(words.map((p) => p.text).join('')).toBe('我喜欢学习中文')
  })
})

describe('wordKey', () => {
  it('без регистра и с прямым апострофом', () => {
    expect(wordKey('Don’t')).toBe("don't")
    expect(wordKey('LONDON')).toBe('london')
  })
})

describe('detectLang / foreignLang', () => {
  it('кириллица — русский, иероглифы и азбуки — по письменности', () => {
    expect(detectLang('Привет, как дела?')).toBe('ru')
    expect(detectLang('我喜欢学习中文')).toBe('zh')
    expect(detectLang('こんにちは、元気ですか')).toBe('ja')
    expect(detectLang('안녕하세요')).toBe('ko')
    expect(detectLang('123 !!!')).toBeNull()
  })

  it('латиница: по особым буквам и служебным словам, иначе английский', () => {
    expect(detectLang('apple')).toBe('en')
    expect(detectLang('I love the sea')).toBe('en')
    expect(detectLang('Ich möchte heute ins Kino gehen')).toBe('de')
    expect(detectLang("Je voudrais un café, s'il vous plaît")).toBe('fr')
    expect(detectLang('¿Dónde está el baño?')).toBe('es')
  })

  it('русский текст не транскрибируется даже с подсказкой языка', () => {
    expect(foreignLang('Привет, мир', 'en')).toBeNull()
    expect(foreignLang('Привет, мир')).toBeNull()
    expect(foreignLang('   ')).toBeNull()
  })

  it('подсказка языка сильнее догадки; auto — значит определить самим', () => {
    expect(foreignLang('Gift', 'de')).toBe('de')
    expect(foreignLang('Gift', 'auto')).toBe('en')
    expect(foreignLang('Hello', 'ru')).toBeNull()
  })
})

describe('normalizePron', () => {
  it('без скобок, косых черт и пробелов', () => {
    expect(normalizePron('/ˈw ɔː t ə/', 'en')).toBe('ˈwɔːtə')
    expect(normalizePron('[həˈləʊ]', 'en')).toBe('həˈləʊ')
  })

  it('английский — как в британских словарях: r вместо ɹ, e вместо ɛ', () => {
    expect(normalizePron('ɹɛd', 'en')).toBe('red')
    expect(normalizePron('wɛə', 'en')).toBe('weə')
  })

  it('точки между слогами убираются, но в чужих языках ɛ остаётся', () => {
    expect(normalizePron('vu.dʁɛ', 'fr')).toBe('vudʁɛ')
  })

  it('пиньинь не трогаем, кроме пробелов', () => {
    expect(normalizePron('nǐ hǎo', 'zh')).toBe('nǐhǎo')
  })
})

describe('parsePhoneticsReply', () => {
  it('обычный JSON-объект', () => {
    expect(parsePhoneticsReply('{"Water": "ˈwɔːtə", "hello": "həˈləʊ"}')).toEqual({
      water: 'ˈwɔːtə',
      hello: 'həˈləʊ'
    })
  })

  it('обёртка ```json и рассуждения перед ответом не мешают', () => {
    const raw = '<think>надо подумать {а это не ответ}</think>\n```json\n{"cat": "kæt"}\n```'
    expect(parsePhoneticsReply(raw)).toEqual({ cat: 'kæt' })
  })

  it('вложенный объект words и массивы пар тоже понимаются', () => {
    expect(parsePhoneticsReply('{"words": {"dog": "dɒɡ"}}')).toEqual({ dog: 'dɒɡ' })
    expect(parsePhoneticsReply('[["sun", "sʌn"], {"word": "sea", "ipa": "siː"}]')).toEqual({
      sun: 'sʌn',
      sea: 'siː'
    })
  })

  it('ответ оборвался на пределе длины — готовые пары всё равно берутся', () => {
    expect(parsePhoneticsReply('{"water": "ˈwɔːtə", "hello": "həˈl')).toEqual({ water: 'ˈwɔːtə' })
  })

  it('мусор и пустые значения — null', () => {
    expect(parsePhoneticsReply('Извините, не могу')).toBeNull()
    expect(parsePhoneticsReply('{"a": ""}')).toBeNull()
    expect(parsePhoneticsReply('{"a": 5}')).toBeNull()
    expect(parsePhoneticsReply('{oops')).toBeNull()
  })
})

describe('buildPhonetics', () => {
  it('у слов есть произношение, у промежутков — нет; неизвестное слово — пустая строка', () => {
    const p = buildPhonetics('Hi, Olya!', 'en', (k) => ({ hi: 'haɪ' })[k])
    expect(p.kind).toBe('ipa')
    expect(p.segments).toEqual([
      { text: 'Hi', pron: 'haɪ' },
      { text: ', ' },
      { text: 'Olya', pron: '' },
      { text: '!' }
    ])
  })

  it('китайский — латиницей, а не значками', () => {
    expect(phoneticsKind('zh')).toBe('roman')
    expect(phoneticsKind('en')).toBe('ipa')
  })
})

describe('PhoneticsMemory', () => {
  let memory: PhoneticsMemory
  let file: string
  beforeEach(() => {
    file = join(mkdtempSync(join(tmpdir(), 'vo-ph-')), 'phonetics.json')
    memory = new PhoneticsMemory(file)
  })

  it('помнит слова по языку и переживает перезапуск', () => {
    memory.remember('en', { water: 'ˈwɔːtə' })
    memory.remember('de', { gift: 'ɡɪft' })
    const again = new PhoneticsMemory(file)
    expect(again.recall('en', ['water', 'gift'])).toEqual({ water: 'ˈwɔːtə' })
    expect(again.recall('de', ['gift'])).toEqual({ gift: 'ɡɪft' })
  })

  it('слова с двумя прочтениями не запоминает: их читают по контексту', () => {
    memory.remember('en', { read: 'red', book: 'bʊk' })
    expect(memory.recall('en', ['read', 'book'])).toEqual({ book: 'bʊk' })
    expect(JSON.parse(readFileSync(file, 'utf-8')).words).toEqual({ 'en:book': 'bʊk' })
  })
})

describe('ipaToCyrillic', () => {
  const cases: Array<[string, string]> = [
    ['ˈwɔːtə', 'уо́тэ'],
    ['həˈləʊ', 'хэло́у'],
    ['ˈæpl', 'эпл'], // одна гласная — без ударения
    ['ˈbjuːtɪfl', 'бью́тифл'],
    ['juː', 'ю'],
    ['jes', 'йес'],
    ['θæŋk', 'сэнк'],
    ['ðə', 'зэ'],
    ['ˈlʌndən', 'ла́ндэн'],
    ['kəmˈpjuːtə', 'кэмпью́тэ'],
    ['ˈɡəʊɪŋ', 'го́уинг'],
    ['naɪt', 'найт'],
    ['bed', 'бед'],
    ['ˈædʒ(ə)nt', 'эджнт'], // звук в скобках не пишется, гласная остаётся одна
    ['kæts', 'кэтс'],
    // ударение — над гласной, а не над «й» перед ней
    ['ˈjestədeɪ', 'йе́стэдэй'],
    ['ˈweðə', 'уэ́зэ'],
    ['wʊd', 'вуд'], // «уу» не прочесть
    ['ˈwʊmən', 'ву́мэн']
  ]
  for (const [ipa, ru] of cases) {
    it(`${ipa} → ${ru}`, () => expect(ipaToCyrillic(ipa)).toBe(ru))
  }

  it('splitStress находит ударную гласную для выделения в окне', () => {
    expect(splitStress('йе́стэдэй')).toEqual({ before: 'й', stressed: 'е', after: 'стэдэй' })
    expect(splitStress('кэт')).toBeNull()
  })

  it('в немецком ts — это «ц»', () => {
    expect(ipaToCyrillic('tsaɪt', 'de')).toBe('цайт')
  })

  it('французские носовые гласные', () => {
    expect(ipaToCyrillic('kʁwasɑ̃', 'fr')).toBe('круасан')
  })

  it('незнакомые значки пропускаются, а не попадают в подсказку', () => {
    expect(ipaToCyrillic('kæt☃')).toBe('кэт')
  })
})

describe('phoneticsLine', () => {
  const p = buildPhonetics('Cold water', 'en', (k) => ({ cold: 'kəʊld', water: 'ˈwɔːtə' })[k])
  it('значками — в квадратных скобках, как в тетради', () => {
    expect(phoneticsLine(p, 'ipa')).toBe('[kəʊld ˈwɔːtə]')
  })
  it('русскими буквами и обоими способами', () => {
    expect(phoneticsLine(p, 'ru')).toBe('коулд уо́тэ')
    expect(phoneticsLine(p, 'both')).toBe('[kəʊld ˈwɔːtə] коулд уо́тэ')
  })
})

describe('выбор модели', () => {
  it('сначала быстрая qwen, затем gpt-oss; речь и фильтры не годятся', () => {
    expect(
      pickPhoneticsModel(['whisper-large-v3', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'])
    ).toBe('qwen/qwen3.8-27b')
    expect(pickPhoneticsModel(['openai/gpt-oss-20b', 'openai/gpt-oss-120b'])).toBe('openai/gpt-oss-120b')
    expect(pickPhoneticsModel(['whisper-large-v3', 'canopylabs/orpheus-v1-english'])).toBeNull()
  })

  it('думающим моделям — короткие размышления', () => {
    expect(reasoningParams('qwen/qwen3.8-27b')).toEqual({ reasoning_format: 'hidden' })
    expect(reasoningParams('openai/gpt-oss-120b')).toEqual({ reasoning_effort: 'low' })
    expect(reasoningParams('llama-3.1-8b-instant')).toEqual({})
  })
})

/** Ответ сервиса в том виде, в каком его читает код. */
function reply(content: string) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }
}
function denied(status: number) {
  return { ok: false, status, text: async () => 'error body' }
}
const noPause = async (): Promise<void> => {}

describe('requestPronunciations', () => {
  it('текст уходит в метках, слова — списком; лишние ключи ответа отбрасываются', async () => {
    let body:
      | { model: string; max_tokens: number; reasoning_format?: string; messages: Array<{ role: string; content: string }> }
      | undefined
    const fetchFn = (async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(init.body as string)
      return reply('{"water": "/ˈwɔːtə/", "extra": "ˈekstrə"}')
    }) as unknown as typeof fetch
    const r = await requestPronunciations({
      apiKey: 'k',
      model: 'qwen/qwen3.8-27b',
      lang: 'en',
      text: 'Water!',
      words: ['water'],
      fetchFn
    })
    expect(r).toEqual({ ok: true, found: { water: 'ˈwɔːtə' } })
    expect(body!.reasoning_format).toBe('hidden')
    // без предела ответа сервис отказывал заранее: «Request too large… Limit 1000»
    expect(body!.max_tokens).toBe(maxTokensFor(1))
    expect(body!.messages[0].content).toContain('["water"]')
    expect(body!.messages[0].content).toContain('британский')
    expect(body!.messages[0].content).toContain('обязательно ставь ˈ')
    expect(body!.messages[1]).toEqual({ role: 'user', content: wrapForeignText('Water!') })
  })

  it('неразборчивый ответ — постоянный отказ, сеть — временный', async () => {
    const junk = (async () => reply('не знаю')) as unknown as typeof fetch
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const base = { apiKey: 'k', model: 'm', lang: 'en', text: 't', words: ['t'] }
    expect(await requestPronunciations({ ...base, fetchFn: junk })).toMatchObject({ ok: false, kind: 'permanent' })
    expect(await requestPronunciations({ ...base, fetchFn: down })).toMatchObject({ ok: false, kind: 'transient' })
  })

  it('предел ответа растёт со списком, но не выходит за минутный лимит модели', () => {
    expect(maxTokensFor(1)).toBeLessThan(maxTokensFor(40))
    expect(maxTokensFor(40)).toBeLessThan(1000)
    expect(maxTokensFor(500)).toBeLessThan(1000)
  })

  it('китайскому — пиньинь, а не значки', () => {
    expect(phoneticsPrompt('zh', ['你好'])).toContain('пиньинь')
  })
})

describe('PhoneticsService', () => {
  let memory: PhoneticsMemory
  beforeEach(() => {
    memory = new PhoneticsMemory(join(mkdtempSync(join(tmpdir(), 'vo-ph-')), 'phonetics.json'))
  })

  /** Подставной сервис: список моделей и ответы на запросы транскрипции по очереди. */
  function fakeService(answers: Array<ReturnType<typeof reply> | ReturnType<typeof denied>>) {
    const asked: Array<{ model: string; words: string }> = []
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/models')) {
        return { ok: true, status: 200, json: async () => ({ data: [{ id: 'qwen/qwen3.8-27b' }] }) }
      }
      const body = JSON.parse(init!.body as string)
      asked.push({ model: body.model, words: body.messages[0].content.match(/Слова: (.*)/)[1] })
      return answers.shift() ?? denied(500)
    }) as unknown as typeof fetch
    const service = new PhoneticsService({
      memory,
      getApiKey: () => 'k',
      fallbackModel: () => 'openai/gpt-oss-120b',
      fetchFn,
      waitFn: noPause
    })
    return { service, asked }
  }

  it('два одновременных текста спрашивают список моделей один раз', async () => {
    let listed = 0
    const fetchFn = (async (url: string) => {
      if (url.endsWith('/models')) {
        listed++
        return { ok: true, status: 200, json: async () => ({ data: [{ id: 'qwen/qwen3.8-27b' }] }) }
      }
      return reply('{"sea": "siː", "sun": "sʌn"}')
    }) as unknown as typeof fetch
    const service = new PhoneticsService({ memory, getApiKey: () => 'k', fallbackModel: () => 'm', fetchFn })
    await Promise.all([service.forText('sea'), service.forText('sun')])
    expect(listed).toBe(1)
  })

  it('русский текст — без запросов и без транскрипции', async () => {
    const { service, asked } = fakeService([])
    expect(await service.forText('Привет, мир')).toEqual({ ok: true, phonetics: null })
    expect(asked).toHaveLength(0)
  })

  it('спрашивает только незнакомые слова, знакомые берёт из памяти', async () => {
    memory.remember('en', { cold: 'kəʊld' })
    const { service, asked } = fakeService([reply('{"water": "ˈwɔːtə"}')])
    const r = await service.forText('Cold water')
    expect(asked).toEqual([{ model: 'qwen/qwen3.8-27b', words: '["water"]' }])
    expect(r.ok && r.phonetics?.segments).toEqual([
      { text: 'Cold', pron: 'kəʊld' },
      { text: ' ' },
      { text: 'water', pron: 'ˈwɔːtə' }
    ])
    // во второй раз всё уже известно — сервис не нужен
    const again = await service.forText('water, cold')
    expect(asked).toHaveLength(1)
    expect(again.ok && again.phonetics?.segments.map((s) => s.pron ?? null)).toEqual(['ˈwɔːtə', null, 'kəʊld'])
  })

  it('временный отказ переживается повтором', async () => {
    const { service, asked } = fakeService([denied(503), reply('{"sea": "siː"}')])
    const r = await service.forText('sea')
    expect(asked).toHaveLength(2)
    expect(r).toMatchObject({ ok: true })
  })

  it('своя модель упёрлась в минутный лимит — та же часть сразу уходит модели перевода', async () => {
    const { service, asked } = fakeService([denied(429), reply('{"sea": "siː"}')])
    const r = await service.forText('sea')
    expect(asked.map((a) => a.model)).toEqual(['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'])
    expect(r).toMatchObject({ ok: true })
  })

  it('длинный текст спрашивается частями по 40 слов', async () => {
    const text = Array.from({ length: 85 }, (_, i) => 'w' + 'abcdefghijklmnopqrstuvwxyz'[i % 26] + 'x'.repeat(Math.floor(i / 26))).join(' ')
    const answers = [0, 1, 2].map(() => reply('{"zzz": "zzz"}'))
    const { service, asked } = fakeService(answers)
    await service.forText(text, 'en')
    expect(asked.map((a) => JSON.parse(a.words).length)).toEqual([40, 40, 5])
  })

  it('своя модель отказала насовсем — дальше спрашиваем модель перевода', async () => {
    const { service, asked } = fakeService([denied(404), reply('{"sea": "siː"}')])
    const r = await service.forText('sea')
    expect(asked.map((a) => a.model)).toEqual(['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'])
    expect(r).toMatchObject({ ok: true })
  })

  it('ничего не узнали — понятная причина вместо пустоты', async () => {
    const { service } = fakeService(Array.from({ length: 6 }, () => denied(429)))
    expect(await service.forText('sea')).toEqual({
      ok: false,
      message: phoneticsFailMessage({ ok: false, kind: 'transient', message: '', status: 429 })
    })
  })

  it('часть слов известна, остальное не загрузилось — показываем известное и честно говорим', async () => {
    memory.remember('en', { cold: 'kəʊld' })
    const { service } = fakeService([denied(401)])
    const r = await service.forText('cold sea')
    expect(r).toMatchObject({ ok: true, note: 'Сервис не принял ключ доступа — проверьте его в настройках' })
  })

  it('без ключа — просьба открыть настройки', async () => {
    const service = new PhoneticsService({ memory, getApiKey: () => null, fallbackModel: () => 'm' })
    expect(await service.forText('sea')).toEqual({
      ok: false,
      message: 'Не задан ключ доступа — откройте настройки'
    })
  })
})
