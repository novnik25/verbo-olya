import { GROQ_BASE } from '../../shared/types'
import { stripMarkers, stripMarkersKeepLines, wrapForeignText } from '../../shared/lang'
import { inspectApiKey } from '../core/api-key'

export type ApiFail = {
  ok: false
  kind: 'transient' | 'auth' | 'permanent'
  message: string
  /** Код ответа сервиса; его нет, только если до сервиса не дошли (нет сети). */
  status?: number
}
export type TextResult = { ok: true; text: string } | ApiFail

function classify(status: number): ApiFail['kind'] {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429 || status >= 500) return 'transient'
  return 'permanent'
}

export async function failFrom(res: { status: number; text?: () => Promise<string> }): Promise<ApiFail> {
  let detail = ''
  try {
    detail = res.text ? (await res.text()).slice(0, 200) : ''
  } catch {
    /* тело недоступно — не важно */
  }
  // сырые ответы сервера про битое аудио переводим на человеческий
  if (res.status === 400 && /file is empty|could not process file|valid media file/i.test(detail)) {
    return {
      ok: false,
      kind: 'permanent',
      message: 'Аудиозапись повреждена и не может быть распознана',
      status: res.status
    }
  }
  return {
    ok: false,
    kind: classify(res.status),
    message: `HTTP ${res.status} ${detail}`.trim(),
    status: res.status
  }
}

export const NET_FAIL: ApiFail = { ok: false, kind: 'transient', message: 'Нет соединения с интернетом' }

export async function transcribe(opts: {
  apiKey: string
  audio: Buffer
  model: string
  language?: 'ru' | 'en'
  prompt?: string
  fetchFn?: typeof fetch
}): Promise<TextResult> {
  const f = opts.fetchFn ?? fetch
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(opts.audio)]), 'audio.webm')
  form.append('model', opts.model)
  form.append('response_format', 'json')
  form.append('temperature', '0')
  if (opts.language) form.append('language', opts.language)
  if (opts.prompt) form.append('prompt', opts.prompt)
  try {
    const res = await f(`${GROQ_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form
    })
    if (!res.ok) return failFrom(res)
    const data = (await res.json()) as { text?: string }
    return { ok: true, text: (data.text ?? '').trim() }
  } catch {
    return NET_FAIL
  }
}

export async function applyStyle(opts: {
  apiKey: string
  model: string
  systemPrompt: string
  text: string
  fetchFn?: typeof fetch
  /** Сохранять переводы строк в ответе: нужно переводу, диктовке — нет. */
  keepLines?: boolean
}): Promise<TextResult> {
  const f = opts.fetchFn ?? fetch
  try {
    const res = await f(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          // текст оборачиваем ЗДЕСЬ, а не у вызывающих: так ни один вызов
          // не сможет случайно отправить чужой текст без меток
          { role: 'user', content: wrapForeignText(opts.text) }
        ]
      })
    })
    if (!res.ok) return failFrom(res)
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    // модель нет-нет да и вернёт метки обратно: просить её молчать о них мало
    const strip = opts.keepLines ? stripMarkersKeepLines : stripMarkers
    const text = strip(data.choices?.[0]?.message?.content ?? '')
    if (!text) return { ok: false, kind: 'permanent', message: 'Пустой ответ модели' }
    return { ok: true, text }
  } catch {
    return NET_FAIL
  }
}

/**
 * Результат проверки ключа. Видов больше одного намеренно: «ключ не подошёл»,
 * «в ключе посторонние знаки», «сервис не пускает с этого адреса» и «до сервиса
 * не достучались» требуют от человека РАЗНЫХ действий, а раньше все четыре
 * показывались одной фразой «ключ не принят сервисом».
 */
export type KeyCheck = 'ok' | 'invalid' | 'malformed' | 'blocked' | 'unreachable'

/** Ответы про запрет по стране: у Groq и у прокси формулировки разные. */
const ПО_СТРАНЕ =
  /country|region|territory|jurisdiction|geo|not available in your|unsupported_country/i

export async function checkKey(
  apiKey: string,
  fetchFn?: typeof fetch,
  log?: (line: string) => void
): Promise<KeyCheck> {
  const { key, shape } = inspectApiKey(apiKey)
  if (shape === 'empty') return 'malformed'
  if (shape === 'foreign-chars') {
    // такой ключ нельзя даже положить в заголовок: fetch упал бы TypeError,
    // и это выглядело бы как недоступность сервиса — человек искал бы не там
    log?.('ключ: в значении посторонние знаки — запрос не отправлялся')
    return 'malformed'
  }
  const f = fetchFn ?? fetch
  try {
    const res = await f(`${GROQ_BASE}/models`, { headers: { Authorization: `Bearer ${key}` } })
    if (res.ok) {
      // ответ 200 ещё не значит «сервис»: прокси и страницы входа в публичный
      // Wi-Fi тоже отвечают 200, только html'ем. Такой ответ принимать нельзя —
      // иначе негодный ключ сохранится как проверенный
      try {
        const data = (await res.json()) as { data?: unknown }
        if (!Array.isArray(data?.data)) {
          log?.('ключ: ответ 200, но это не ответ сервиса — вероятно, прокси')
          return 'unreachable'
        }
      } catch {
        log?.('ключ: ответ 200 нечитаем — вероятно, прокси')
        return 'unreachable'
      }
      return 'ok'
    }
    let detail = ''
    try {
      detail = res.text ? (await res.text()).slice(0, 300) : ''
    } catch {
      /* тело недоступно — хватит и кода */
    }
    log?.(`ключ: сервис ответил HTTP ${res.status} ${detail}`.trim())
    // 401 — это про сам ключ. 403 почти всегда про доступ: страна, из которой
    // пришёл запрос, или ограничения аккаунта. Сваливать их в «ключ не принят»
    // значит отправить человека менять исправный ключ
    if (res.status === 401) return 'invalid'
    if (res.status === 403) return ПО_СТРАНЕ.test(detail) ? 'blocked' : 'invalid'
    return 'unreachable'
  } catch (err) {
    // сети нет, DNS не резолвится, соединение отклонено — сервис недостижим
    log?.(`ключ: до сервиса не достучались — ${err instanceof Error ? err.message : 'сбой сети'}`)
    return 'unreachable'
  }
}

/** Приоритет текстовых моделей Groq для стилей: от сильных к запасным. */
const LLM_PRIORITY: RegExp[] = [
  /gpt-oss-120b/i,
  /llama-3\.3-70b/i,
  /llama-3\.1-70b/i,
  /llama-4.*maverick/i,
  /llama-4.*scout/i,
  /kimi-k2/i,
  /qwen.*(235|72)b/i,
  /gpt-oss-20b/i,
  /llama-3\.1-8b/i,
  /llama3-70b/i
]

/**
 * Не подходящие для оформления текста: распознавание речи, озвучка, модерация,
 * эмбеддинги, а также агентные системы (compound и т.п.) — они ОТВЕЧАЮТ на
 * содержимое вместо редактирования.
 */
const NOT_TEXT = /whisper|tts|guard|embed|moderation|allam|compound|agent/i

/** Выбирает лучшую доступную текстовую модель из списка id. Чистая функция. */
export function pickBestLlmModel(modelIds: string[]): string | null {
  const textModels = modelIds.filter((id) => !NOT_TEXT.test(id))
  for (const pattern of LLM_PRIORITY) {
    const found = textModels.find((id) => pattern.test(id))
    if (found) return found
  }
  return textModels[0] ?? null
}

/**
 * Модели, умеющие ЧИТАТЬ КАРТИНКИ, от предпочтительных к запасным. Список моделей
 * у сервиса меняется, поэтому конкретное имя не прибиваем: подбираем из того,
 * что доступно ключу, — так же, как для текстовых моделей.
 */
const VISION_PRIORITY: RegExp[] = [
  /qwen[\d.\-/]*\d+b/i,
  /llama-4.*maverick/i,
  /llama-4.*scout/i,
  /llava/i,
  /vision/i
]

/**
 * Выбирает модель, способную прочитать картинку. Чистая функция.
 * Возвращает null, если такой нет: подсунуть вместо неё текстовую модель значило бы
 * получить выдуманный ответ вместо честного отказа.
 */
export function pickVisionModel(modelIds: string[]): string | null {
  const usable = modelIds.filter((id) => !NOT_TEXT.test(id))
  for (const pattern of VISION_PRIORITY) {
    const found = usable.find((id) => pattern.test(id))
    if (found) return found
  }
  return null
}

/** Запрашивает у сервиса список моделей и выбирает ту, что читает картинки. */
export async function findVisionModel(
  apiKey: string,
  fetchFn?: typeof fetch
): Promise<string | null> {
  const f = fetchFn ?? fetch
  try {
    const res = await f(`${GROQ_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!res.ok) return null
    const data = (await res.json()) as { data?: Array<{ id?: string }> }
    const ids = (data.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
    return pickVisionModel(ids)
  } catch {
    return null
  }
}

/**
 * Убирает размышления «думающих» моделей. Проверка на живой картинке показала,
 * что модель возвращает разбор задачи в <think>…</think> ПЕРЕД ответом — и весь
 * этот текст попадал бы прямо в поле перевода. Просить скрыть рассуждения через
 * параметр запроса мало: поведение зависит от модели, поэтому режем и здесь.
 */
export function stripThinking(raw: string): string {
  const close = raw.lastIndexOf('</think>')
  if (close !== -1) return raw.slice(close + '</think>'.length).trim()
  // блок открыт и не закрыт — значит перед нами одни размышления, ответа нет
  if (/<think\b/i.test(raw)) return ''
  return raw.trim()
}

/**
 * Распознаёт текст на картинке в облаке — запасной путь, когда встроенный
 * движок Windows недоступен. Просим модель вернуть текст ДОСЛОВНО: пересказ
 * или перевод здесь были бы хуже, чем ничего.
 */
export async function recognizeWithVision(opts: {
  apiKey: string
  model: string
  image: Buffer
  mime?: string
  fetchFn?: typeof fetch
}): Promise<TextResult> {
  const f = opts.fetchFn ?? fetch
  const dataUrl = `data:${opts.mime ?? 'image/png'};base64,${opts.image.toString('base64')}`
  try {
    const res = await f(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        // просим сервис не присылать размышления модели; если он этого не умеет,
        // страхует stripThinking ниже
        reasoning_format: 'hidden',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Верни весь текст с этого изображения дословно, сохраняя порядок строк и абзацы. ' +
                  'Ничего не переводи, не пересказывай и не добавляй пояснений. ' +
                  'Если текста на изображении нет, верни пустой ответ.'
              },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ]
      })
    })
    if (!res.ok) return failFrom(res)
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const text = stripThinking(data.choices?.[0]?.message?.content ?? '')
    if (!text) return { ok: false, kind: 'permanent', message: 'На изображении не найдено текста' }
    return { ok: true, text }
  } catch {
    return NET_FAIL
  }
}

/** Запрашивает у Groq список моделей и выбирает лучшую текстовую. */
export async function findWorkingLlmModel(
  apiKey: string,
  fetchFn?: typeof fetch
): Promise<string | null> {
  const f = fetchFn ?? fetch
  try {
    const res = await f(`${GROQ_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!res.ok) return null
    const data = (await res.json()) as { data?: Array<{ id?: string }> }
    const ids = (data.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
    return pickBestLlmModel(ids)
  } catch {
    return null
  }
}
