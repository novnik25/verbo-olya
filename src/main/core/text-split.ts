/**
 * Резка текста на части по границам предложений — чистая логика без Electron и сети.
 *
 * Нужна двоим: синтезу речи (длинный запрос рвётся по таймауту) и переводу
 * (длинный запрос не проходит по лимиту сервиса). Жила в services/tts.ts, переехала сюда,
 * чтобы переводчик не тянул за собой всю обвязку синтеза речи.
 */
const КОНЦЫ = '.!?…'

/**
 * Режет текст на предложения, НИЧЕГО не теряя. Чистая функция.
 *
 * Прежняя версия собирала предложения из совпадений регулярного выражения — и
 * всё, что ни с чем не совпало, пропадало МОЛЧА. Ломала разбор точка, за которой
 * нет пробела: «Verbo 2.3.4», «и т.д.», «index.ts», «github.com». От такой точки
 * и до следующего совпадения текст исчезал: на проверке из 124 знаков уцелело 20.
 * При чтении вслух так пропадали целые абзацы — например, вся таблица со списком
 * версий, а читалась только последняя строка.
 *
 * Здесь текст делится встык: каждый знак попадает ровно в один кусок.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (!КОНЦЫ.includes(text[i])) continue
    // знаки подряд («?!», «…», «...») — это одно окончание
    let end = i
    while (end + 1 < text.length && КОНЦЫ.includes(text[end + 1])) end++
    const next = text[end + 1]
    // предложение кончилось, только если дальше пробел или конец текста;
    // иначе перед нами номер версии, сокращение или адрес
    if (next === undefined || /\s/.test(next)) {
      out.push(text.slice(start, end + 1))
      start = end + 1
    }
    i = end
  }
  if (start < text.length) out.push(text.slice(start))
  return out
}

/**
 * Режет длинный текст по границам предложений для последовательного синтеза
 * (msedge-tts не любит очень длинные запросы). Чистая функция.
 * Не рвёт слова: если одно предложение длиннее maxLen, режет по пробелам.
 */
export function splitForTts(text: string, maxLen = 1000): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= maxLen) return [trimmed]

  const sentences = splitSentences(trimmed)

  const chunks: string[] = []
  let current = ''
  for (const raw of sentences) {
    let piece = raw.trim()
    if (!piece) continue
    // само предложение длиннее лимита — режем по словам, не разрывая их
    while (piece.length > maxLen) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      let cut = piece.slice(0, maxLen)
      const lastSpace = cut.lastIndexOf(' ')
      if (lastSpace > 0) cut = cut.slice(0, lastSpace)
      chunks.push(cut.trim())
      piece = piece.slice(cut.length).trim()
    }
    if (!piece) continue
    if (!current) {
      current = piece
    } else if ((current + ' ' + piece).length <= maxLen) {
      current = current + ' ' + piece
    } else {
      chunks.push(current)
      current = piece
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/**
 * Режет длинный текст на части для перевода. Части — ТОЧНЫЕ куски исходного
 * текста: parts.join('') возвращает его дословно, вместе с переводами строк.
 *
 * Отличие от splitForTts принципиальное: синтезу речи разметка не нужна, и он
 * склеивает предложения через пробел. Перевод же обязан сохранить абзацы и
 * списки — поэтому режем сначала по строкам и только внутри слишком длинной
 * строки спускаемся до предложений и слов.
 */
export function splitForTranslate(text: string, maxLen = 4000): string[] {
  if (!text) return []
  if (text.length <= maxLen) return [text]

  // куски рвём по переводам строк: граница абзаца — самый безопасный шов
  const lines = text.split(/(?<=\n)/)
  const parts: string[] = []
  let current = ''
  const flush = (): void => {
    if (current) parts.push(current)
    current = ''
  }
  const put = (piece: string): void => {
    if (current.length + piece.length <= maxLen) current += piece
    else {
      flush()
      current = piece
    }
  }

  for (const line of lines) {
    if (line.length <= maxLen) {
      put(line)
      continue
    }
    // строка длиннее лимита — спускаемся до предложений, они тоже точные куски
    for (const sentence of splitSentences(line)) {
      if (sentence.length <= maxLen) {
        put(sentence)
        continue
      }
      // и одно предложение бывает длиннее лимита: режем по пробелам, не рвя слова
      let rest = sentence
      while (rest.length > maxLen) {
        const head = rest.slice(0, maxLen)
        const space = head.lastIndexOf(' ')
        const cut = space > 0 ? space + 1 : maxLen
        put(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      if (rest) put(rest)
    }
  }
  flush()
  return parts
}
