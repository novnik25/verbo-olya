import { describe, it, expect } from 'vitest'
import { translateText, translateFailMessage, TRANSLATE_PART_CHARS } from '../src/main/services/translate'
import { EDITOR_GUARD, wrapForeignText } from '../src/shared/lang'

describe('translateText', () => {
  it('успех: посылает системный промпт с языком и текстом, возвращает перевод', async () => {
    let body: { model?: string; messages?: Array<{ role: string; content: string }> } | undefined
    const fetchFn = (async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(init.body as string)
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Hello world.' } }] }) }
    }) as unknown as typeof fetch

    const r = await translateText({
      apiKey: 'k',
      model: 'm',
      text: 'Привет мир.',
      targetLang: 'en',
      fetchFn
    })

    expect(r).toEqual({ ok: true, text: 'Hello world.' })
    expect(body!.model).toBe('m')
    expect(body!.messages?.[0].role).toBe('system')
    expect(body!.messages?.[0].content).toContain('английский')
    expect(body!.messages?.[0].content).toContain(EDITOR_GUARD)
    // чужой текст уходит в метках, а не голым
    expect(body!.messages?.[1]).toEqual({ role: 'user', content: wrapForeignText('Привет мир.') })
  })

  it('неизвестный код языка -> подставляется как есть', async () => {
    let content = ''
    const fetchFn = (async (_url: unknown, init: RequestInit) => {
      content = (JSON.parse(init.body as string).messages[0] as { content: string }).content
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }
    }) as unknown as typeof fetch

    await translateText({ apiKey: 'k', model: 'm', text: 't', targetLang: 'xx', fetchFn })
    expect(content).toContain('xx')
  })

  it('ошибка сети -> transient', async () => {
    const downFetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const r = await translateText({ apiKey: 'k', model: 'm', text: 't', targetLang: 'ru', fetchFn: downFetch })
    expect(r).toMatchObject({ ok: false, kind: 'transient' })
  })
})

/** Ответ сервиса с нужным кодом; тело читается как текст — так же, как в бою. */
function отказ(status: number) {
  return { ok: false, status, text: async () => 'error body' }
}
function успех(content: string) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }
}
const безПаузы = async (): Promise<void> => {}

describe('translateText: повторы и разбивка', () => {
  it('временный отказ не показывается человеку: вторая попытка проходит', async () => {
    let вызовов = 0
    const fetchFn = (async () => {
      вызовов++
      return вызовов === 1 ? отказ(503) : успех('Hello.')
    }) as unknown as typeof fetch

    const r = await translateText({
      apiKey: 'k', model: 'm', text: 'Привет.', targetLang: 'en', fetchFn, waitFn: безПаузы
    })

    expect(r).toEqual({ ok: true, text: 'Hello.' })
    expect(вызовов).toBe(2)
  })

  it('временные отказы подряд — сдаёмся после трёх попыток', async () => {
    let вызовов = 0
    const fetchFn = (async () => {
      вызовов++
      return отказ(429)
    }) as unknown as typeof fetch

    const r = await translateText({
      apiKey: 'k', model: 'm', text: 'Привет.', targetLang: 'en', fetchFn, waitFn: безПаузы
    })

    expect(r).toMatchObject({ ok: false, status: 429 })
    expect(вызовов).toBe(3)
  })

  it('отказ не временный (ключ) — повторять нечего, одна попытка', async () => {
    let вызовов = 0
    const fetchFn = (async () => {
      вызовов++
      return отказ(401)
    }) as unknown as typeof fetch

    const r = await translateText({
      apiKey: 'k', model: 'm', text: 'Привет.', targetLang: 'en', fetchFn, waitFn: безПаузы
    })

    expect(r).toMatchObject({ ok: false, kind: 'auth' })
    expect(вызовов).toBe(1)
  })

  it('длинный текст уходит частями, а не одним запросом', async () => {
    const абзац = Array(200).fill('Предложение про одно и то же.').join(' ') // ~6000 знаков
    const текст = абзац + '\n\n' + абзац
    const отправленные: string[] = []
    const fetchFn = (async (_url: unknown, init: RequestInit) => {
      отправленные.push(JSON.parse(init.body as string).messages[1].content)
      return успех('PART')
    }) as unknown as typeof fetch

    await translateText({
      apiKey: 'k', model: 'm', text: текст, targetLang: 'en', fetchFn, waitFn: безПаузы
    })

    expect(отправленные.length).toBeGreaterThan(1)
    // каждая часть влезает в лимит запроса (плюс сами метки вокруг текста)
    for (const part of отправленные) expect(part.length).toBeLessThan(TRANSLATE_PART_CHARS + 100)
  })

  it('абзацы и пустые строки переживают разбивку на части', async () => {
    const абзац = Array(200).fill('Предложение про одно и то же.').join(' ')
    const текст = [абзац, '', абзац, '', '- первый пункт', '- второй пункт'].join('\n')
    // модель-эхо: возвращает ровно то, что получила, вместе с метками
    const fetchFn = (async (_url: unknown, init: RequestInit) => {
      const пришло = JSON.parse(init.body as string).messages[1].content as string
      return успех(пришло)
    }) as unknown as typeof fetch

    const r = await translateText({
      apiKey: 'k', model: 'm', text: текст, targetLang: 'en', fetchFn, waitFn: безПаузы
    })

    // текст вернулся ДОСЛОВНО: ни один перевод строки не потерялся на швах частей
    expect(r).toEqual({ ok: true, text: текст })
  })

  it('провал одной части — провал всего перевода, полуперевод не показываем', async () => {
    let вызовов = 0
    const fetchFn = (async () => {
      вызовов++
      return вызовов === 1 ? успех('PART') : отказ(400)
    }) as unknown as typeof fetch

    const текст = 'Предложение. '.repeat(400) // заведомо больше одной части
    const r = await translateText({
      apiKey: 'k', model: 'm', text: текст, targetLang: 'en', fetchFn, waitFn: безПаузы
    })

    expect(r.ok).toBe(false)
  })
})

describe('translateFailMessage', () => {
  it('кончился лимит запросов — говорим про лимит, а не про сеть', () => {
    expect(translateFailMessage({ ok: false, kind: 'transient', message: 'HTTP 429', status: 429 }))
      .toContain('Слишком много запросов')
  })

  it('нет ответа сервиса (нет кода) — говорим про соединение', () => {
    expect(translateFailMessage({ ok: false, kind: 'transient', message: 'Нет соединения с интернетом' }))
      .toContain('соединение')
  })

  it('запрос не влез — говорим про длину текста', () => {
    expect(translateFailMessage({ ok: false, kind: 'permanent', message: 'HTTP 413', status: 413 }))
      .toContain('длинный')
  })

  it('ключ не принят — отправляем в настройки', () => {
    expect(translateFailMessage({ ok: false, kind: 'auth', message: 'HTTP 401', status: 401 }))
      .toContain('настройках')
  })

  it('сервис сломался — честное «временно недоступен»', () => {
    expect(translateFailMessage({ ok: false, kind: 'transient', message: 'HTTP 500', status: 500 }))
      .toContain('временно недоступен')
  })
})
