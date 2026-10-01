import { describe, it, expect } from 'vitest'
import {
  checkKey,
  pickBestLlmModel,
  pickVisionModel,
  recognizeWithVision,
  stripThinking,
  transcribe,
  applyStyle
} from '../src/main/services/groq'
import { wrapForeignText } from '../src/shared/lang'

const okFetch = (body: unknown) =>
  (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch
const errFetch = (status: number) =>
  (async () => ({ ok: false, status, json: async () => ({}), text: async () => 'err' })) as unknown as typeof fetch
const downFetch = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch

const audio = Buffer.from('fake')

describe('transcribe', () => {
  it('успех возвращает текст', async () => {
    const r = await transcribe({ apiKey: 'k', audio, model: 'm', fetchFn: okFetch({ text: 'привет' }) })
    expect(r).toEqual({ ok: true, text: 'привет' })
  })
  it('передаёт language и prompt в form-data', async () => {
    let form: FormData | undefined
    const spy = (async (_u: unknown, init: RequestInit) => {
      form = init.body as FormData
      return { ok: true, status: 200, json: async () => ({ text: 'x' }) }
    }) as unknown as typeof fetch
    await transcribe({ apiKey: 'k', audio, model: 'm', language: 'ru', prompt: 'Ozon', fetchFn: spy })
    expect(form!.get('language')).toBe('ru')
    expect(form!.get('prompt')).toBe('Ozon')
    expect(form!.get('model')).toBe('m')
  })
  it('нет сети -> transient', async () => {
    const r = await transcribe({ apiKey: 'k', audio, model: 'm', fetchFn: downFetch })
    expect(r).toMatchObject({ ok: false, kind: 'transient' })
  })
  it('401 -> auth, 429 -> transient, 500 -> transient, 400 -> permanent', async () => {
    expect(await transcribe({ apiKey: 'k', audio, model: 'm', fetchFn: errFetch(401) })).toMatchObject({ kind: 'auth' })
    expect(await transcribe({ apiKey: 'k', audio, model: 'm', fetchFn: errFetch(429) })).toMatchObject({ kind: 'transient' })
    expect(await transcribe({ apiKey: 'k', audio, model: 'm', fetchFn: errFetch(500) })).toMatchObject({ kind: 'transient' })
    expect(await transcribe({ apiKey: 'k', audio, model: 'm', fetchFn: errFetch(400) })).toMatchObject({ kind: 'permanent' })
  })
})

describe('applyStyle', () => {
  it('чужой текст уходит модели в метках — забыть об этом нельзя ни на одном вызове', async () => {
    let тело: Record<string, any> | undefined
    const шпион = (async (_u: unknown, init: RequestInit) => {
      тело = JSON.parse(init.body as string)
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ок' } }] }) }
    }) as unknown as typeof fetch
    await applyStyle({ apiKey: 'k', model: 'm', systemPrompt: 'p', text: 'чужой текст', fetchFn: шпион })
    const сообщение = тело!.messages[1]
    expect(сообщение.role).toBe('user')
    expect(сообщение.content).toBe(wrapForeignText('чужой текст'))
  })

  it('успех возвращает контент', async () => {
    const r = await applyStyle({
      apiKey: 'k', model: 'm', systemPrompt: 'p', text: 'т',
      fetchFn: okFetch({ choices: [{ message: { content: 'готово' } }] })
    })
    expect(r).toEqual({ ok: true, text: 'готово' })
  })
  it('ошибка сети -> transient', async () => {
    const r = await applyStyle({ apiKey: 'k', model: 'm', systemPrompt: 'p', text: 'т', fetchFn: downFetch })
    expect(r).toMatchObject({ ok: false, kind: 'transient' })
  })
})

describe('checkKey', () => {
  it('200 со списком моделей -> ok', async () => {
    expect(await checkKey('k', okFetch({ data: [] }))).toBe('ok')
  })

  it('200, но ответ не от сервиса (прокси, страница входа) -> сервис недоступен', async () => {
    // иначе негодный ключ сохранился бы как проверенный: прокси отвечает 200 html'ем
    expect(await checkKey('k', okFetch({ hello: 'страница входа в Wi-Fi' }))).toBe('unreachable')
  })

  it('401 -> ключ не годится', async () => {
    expect(await checkKey('k', errFetch(401))).toBe('invalid')
  })

  it('403 про страну -> запрет по стране, а не «плохой ключ»', async () => {
    // Groq не обслуживает часть стран: ключ при этом исправен, и совет человеку
    // совсем другой — включить VPN, а не идти за новым ключом
    const страна = (async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => '{"error":{"message":"Country, region, or territory not supported"}}'
    })) as unknown as typeof fetch
    expect(await checkKey('k', страна)).toBe('blocked')
  })

  it('403 без упоминания страны -> всё-таки про ключ', async () => {
    expect(await checkKey('k', errFetch(403))).toBe('invalid')
  })

  it('503 -> сервис недоступен, а не «плохой ключ»', async () => {
    expect(await checkKey('k', errFetch(503))).toBe('unreachable')
  })

  it('сеть упала -> сервис недоступен, ключ ни при чём', async () => {
    // раньше это сводилось к одному false и выглядело как отказ по ключу
    expect(await checkKey('k', downFetch)).toBe('unreachable')
  })

  it('ключ с кириллицей — испорченное значение, в сеть не ходим', async () => {
    // при копировании из чата легко подхватить кириллическую «с» вместо латинской;
    // такой ключ вообще нельзя положить в заголовок, и запрос падал TypeError,
    // а это выглядело как «сервис недоступен» — человек искал бы беду не там
    let ходили = false
    const шпион = (async () => {
      ходили = true
      return { ok: true, status: 200, json: async () => ({ data: [] }) }
    }) as unknown as typeof fetch
    expect(await checkKey('gsk_ключ_с_кириллицей', шпион)).toBe('malformed')
    expect(ходили).toBe(false) // впустую в сеть не ходим
  })

  it('ключ с пробелом внутри — испорченное значение', async () => {
    expect(await checkKey('gsk_ abc', okFetch({ data: [] }))).toBe('malformed')
  })

  it('пустой ключ — испорченное значение', async () => {
    expect(await checkKey('', okFetch({ data: [] }))).toBe('malformed')
  })

  it('обрамление от копирования снимается, ключ доходит до сервиса чистым', async () => {
    let ушло = ''
    const шпион = (async (_u: unknown, init: RequestInit) => {
      ушло = (init.headers as Record<string, string>).Authorization
      return { ok: true, status: 200, json: async () => ({ data: [] }) }
    }) as unknown as typeof fetch
    expect(await checkKey('  "Bearer gsk_ABC123"  ', шпион)).toBe('ok')
    expect(ушло).toBe('Bearer gsk_ABC123')
  })
})

describe('pickBestLlmModel', () => {
  it('выбирает по приоритету: gpt-oss-120b выше llama-8b', () => {
    expect(
      pickBestLlmModel(['llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'whisper-large-v3'])
    ).toBe('openai/gpt-oss-120b')
  })
  it('llama-3.3-70b выше llama-3.1-8b', () => {
    expect(pickBestLlmModel(['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'])).toBe(
      'llama-3.3-70b-versatile'
    )
  })
  it('отфильтровывает whisper/tts/guard/embed', () => {
    expect(pickBestLlmModel(['whisper-large-v3-turbo', 'playai-tts', 'llama-guard-4'])).toBeNull()
  })
  it('незнакомая текстовая модель — берётся как запасной вариант', () => {
    expect(pickBestLlmModel(['some-new-model-9000', 'whisper-large-v3'])).toBe(
      'some-new-model-9000'
    )
  })
})

describe('pickBestLlmModel: агентные модели исключены', () => {
  it('compound не выбирается даже как запасной вариант', () => {
    expect(pickBestLlmModel(['groq/compound', 'compound-beta', 'whisper-large-v3'])).toBeNull()
  })
  it('обычная модель побеждает compound', () => {
    expect(pickBestLlmModel(['groq/compound', 'llama-3.1-8b-instant'])).toBe('llama-3.1-8b-instant')
  })
})

describe('подбор модели, умеющей читать картинки', () => {
  it('берёт многомодальную модель, а не текстовую', () => {
    const доступно = ['llama-3.3-70b-versatile', 'qwen/qwen3.6-27b', 'whisper-large-v3']
    expect(pickVisionModel(доступно)).toBe('qwen/qwen3.6-27b')
  })
  it('если предпочтительной нет, берёт следующую по списку', () => {
    expect(pickVisionModel(['meta-llama/llama-4-maverick-17b-128e-instruct'])).toBe(
      'meta-llama/llama-4-maverick-17b-128e-instruct'
    )
  })
  it('когда картинки читать нечем, возвращает null, а не текстовую модель', () => {
    // подсунуть сюда текстовую модель значило бы получить выдуманный ответ вместо отказа
    expect(pickVisionModel(['llama-3.3-70b-versatile', 'whisper-large-v3'])).toBeNull()
  })
  it('пустой список ничего не даёт', () => {
    expect(pickVisionModel([])).toBeNull()
  })
})

describe('распознавание картинки в облаке', () => {
  const картинка = Buffer.from([0x89, 0x50, 0x4e, 0x47])

  it('успех возвращает распознанный текст', async () => {
    const r = await recognizeWithVision({
      apiKey: 'k',
      model: 'm',
      image: картинка,
      fetchFn: okFetch({ choices: [{ message: { content: '  Привет из картинки  ' } }] })
    })
    expect(r).toEqual({ ok: true, text: 'Привет из картинки' })
  })

  it('картинка уходит как data-ссылка внутри сообщения', async () => {
    let тело: Record<string, any> | undefined
    const шпион = (async (_u: unknown, init: RequestInit) => {
      тело = JSON.parse(init.body as string)
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }
    }) as unknown as typeof fetch
    await recognizeWithVision({ apiKey: 'k', model: 'm', image: картинка, fetchFn: шпион })
    const части = тело!.messages[0].content
    const изображение = части.find((c: { type: string }) => c.type === 'image_url')
    expect(изображение.image_url.url.startsWith('data:image/png;base64,')).toBe(true)
    expect(изображение.image_url.url).toContain(картинка.toString('base64'))
    expect(тело!.model).toBe('m')
  })

  it('пустой ответ модели — отказ, а не пустой текст', async () => {
    const r = await recognizeWithVision({
      apiKey: 'k',
      model: 'm',
      image: картинка,
      fetchFn: okFetch({ choices: [{ message: { content: '   ' } }] })
    })
    expect(r).toMatchObject({ ok: false })
  })

  it('401 — это ключ, 500 — временная беда', async () => {
    expect(
      await recognizeWithVision({ apiKey: 'k', model: 'm', image: картинка, fetchFn: errFetch(401) })
    ).toMatchObject({ kind: 'auth' })
    expect(
      await recognizeWithVision({ apiKey: 'k', model: 'm', image: картинка, fetchFn: errFetch(500) })
    ).toMatchObject({ kind: 'transient' })
  })

  it('нет сети — временная беда', async () => {
    expect(
      await recognizeWithVision({ apiKey: 'k', model: 'm', image: картинка, fetchFn: downFetch })
    ).toMatchObject({ ok: false, kind: 'transient' })
  })
})

describe('рассуждения модели не должны попадать в текст', () => {
  const картинка = Buffer.from([0x89, 0x50, 0x4e, 0x47])

  it('срезает блок размышлений и оставляет только ответ', () => {
    const ответ = '<think>\nПользователь просит текст.\nПроверяю.\n</think>\n\nOzon prodazhi za avgust'
    expect(stripThinking(ответ)).toBe('Ozon prodazhi za avgust')
  })

  it('обычный ответ не трогает', () => {
    expect(stripThinking('Просто текст с картинки')).toBe('Просто текст с картинки')
  })

  it('берёт то, что после ПОСЛЕДНЕГО закрывающего тега', () => {
    expect(stripThinking('<think>раз</think>мусор<think>два</think>итог')).toBe('итог')
  })

  it('незакрытый блок размышлений оставляет пустоту, а не размышления', () => {
    expect(stripThinking('<think>я всё ещё думаю и не закончил')).toBe('')
  })

  it('распознавание в облаке отдаёт текст без размышлений', async () => {
    const r = await recognizeWithVision({
      apiKey: 'k',
      model: 'm',
      image: картинка,
      fetchFn: okFetch({
        choices: [{ message: { content: '<think>рассуждаю</think>\n\nВыручка 1450000' } }]
      })
    })
    expect(r).toEqual({ ok: true, text: 'Выручка 1450000' })
  })

  it('если кроме размышлений ничего не пришло — это отказ', async () => {
    const r = await recognizeWithVision({
      apiKey: 'k',
      model: 'm',
      image: картинка,
      fetchFn: okFetch({ choices: [{ message: { content: '<think>только мысли</think>' } }] })
    })
    expect(r).toMatchObject({ ok: false })
  })

  it('в запросе просим не показывать размышления', async () => {
    let тело: Record<string, any> | undefined
    const шпион = (async (_u: unknown, init: RequestInit) => {
      тело = JSON.parse(init.body as string)
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }
    }) as unknown as typeof fetch
    await recognizeWithVision({ apiKey: 'k', model: 'm', image: картинка, fetchFn: шпион })
    expect(тело!.reasoning_format).toBe('hidden')
  })
})
