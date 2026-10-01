import { EDITOR_GUARD, langLabel } from '../../shared/lang'
import { splitForTranslate } from '../core/text-split'
import { applyStyle } from './groq'
import type { ApiFail, TextResult } from './groq'

/**
 * Сколько знаков уходит в сервис за один запрос.
 *
 * Дело не в модели, а в лимите на запрос: у бесплатного доступа Groq считаются
 * токены в минуту, и длинный текст целиком получал отказ 413 — а человек видел
 * лишь «Не удалось перевести» при живом интернете. Четыре тысячи знаков — это
 * примерно полторы тысячи токенов вместе с ответом, с большим запасом.
 */
export const TRANSLATE_PART_CHARS = 4000

/** Сколько ждать перед повторной попыткой после временного отказа. */
const RETRY_PAUSE_MS = [900, 2500]

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Причина отказа человеческим языком. Техническая подробность (код ответа, текст
 * сервиса) остаётся в message и уходит в журнал: на экране от неё вреда больше,
 * чем пользы, но и одно общее «не удалось» врёт — человек ищет обрыв интернета,
 * когда на деле кончился лимит запросов.
 */
export function translateFailMessage(fail: ApiFail): string {
  if (fail.kind === 'auth') {
    return 'Сервис перевода не принял ключ доступа — проверьте его в настройках'
  }
  if (fail.status === 429) {
    return 'Слишком много запросов подряд — подождите минуту и попробуйте снова'
  }
  if (fail.status === 413) {
    return 'Текст слишком длинный для одного запроса — переведите его частями'
  }
  // код ответа есть, только если сервис ответил; без него до него просто не дошли
  if (fail.status === undefined) {
    return 'Не удалось связаться с сервисом перевода — проверьте соединение и попробуйте снова'
  }
  if (fail.kind === 'transient') {
    return 'Сервис перевода временно недоступен — попробуйте ещё раз через минуту'
  }
  return 'Не удалось перевести'
}

/** Мгновенный перевод выделенного текста через Groq chat/completions. */
export async function translateText(opts: {
  apiKey: string
  model: string
  text: string
  targetLang: string
  fetchFn?: typeof fetch
  waitFn?: (ms: number) => Promise<void>
  log?: (line: string) => void
}): Promise<TextResult> {
  // задача впереди, броня следом — порядок проверен замерами (см. EDITOR_GUARD)
  const systemPrompt =
    `Ты — профессиональный переводчик. Переведи текст на ${langLabel(opts.targetLang)}. ` +
    'Сохрани форматирование, абзацы и списки. Отвечай ТОЛЬКО переводом, без пояснений и кавычек.' +
    '\n\n' +
    EDITOR_GUARD
  const wait = opts.waitFn ?? sleep

  /**
   * Одна часть текста с повторами. Временный отказ — это перегрузка сервиса или
   * моргнувшая сеть: раньше он сразу становился ошибкой на экране, хотя вторая
   * попытка через секунду почти всегда проходит.
   */
  const translatePart = async (part: string): Promise<TextResult> => {
    let last: ApiFail | null = null
    for (let attempt = 0; attempt <= RETRY_PAUSE_MS.length; attempt++) {
      if (attempt > 0) await wait(RETRY_PAUSE_MS[attempt - 1])
      const res = await applyStyle({
        apiKey: opts.apiKey,
        model: opts.model,
        systemPrompt,
        text: part,
        fetchFn: opts.fetchFn,
        keepLines: true
      })
      if (res.ok) return res
      last = res
      opts.log?.(`перевод: попытка ${attempt + 1} не удалась — ${res.message}`)
      if (res.kind !== 'transient') return res
    }
    return last as ApiFail
  }

  const parts = splitForTranslate(opts.text, TRANSLATE_PART_CHARS)
  if (parts.length > 1) opts.log?.(`перевод: текст разбит на части, ${parts.length}`)

  const out: string[] = []
  for (const part of parts) {
    // отступы и переводы строк по краям куска сохраняем сами: модель их теряет,
    // и разметка текста разъезжалась бы на каждом шве между частями
    const body = part.trim()
    if (!body) {
      out.push(part)
      continue
    }
    const head = part.slice(0, part.indexOf(body))
    const tail = part.slice(head.length + body.length)
    const res = await translatePart(body)
    if (!res.ok) return res
    out.push(head + res.text + tail)
  }
  return { ok: true, text: out.join('') }
}
