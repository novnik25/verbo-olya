import { JsonFileStore } from './json-store'
import { cyrShare } from '../../shared/lang'
import { phoneticsKind } from '../../shared/phonetics'
import type { Phonetics } from '../../shared/phonetics'

/**
 * Чистая логика транскрипции: какой язык у текста, где в нём слова, как разобрать
 * ответ модели и что из уже узнанного можно не спрашивать снова. Без Electron
 * и без сети — всё проверяется тестами.
 */

export interface TextPiece {
  text: string
  word: boolean
}

/**
 * Делит текст на слова и промежутки между ними. Границы слов берёт Intl.Segmenter:
 * он знает, что don't — одно слово, и умеет делить китайский и японский, где
 * пробелов между словами нет вовсе. Числа и знаки — не слова: произносить их
 * по значкам незачем. Соседние промежутки склеиваются. Чистая функция.
 */
export function segmentText(text: string, lang: string): TextPiece[] {
  const out: TextPiece[] = []
  const segmenter = new Intl.Segmenter(lang, { granularity: 'word' })
  for (const s of segmenter.segment(text)) {
    const word = Boolean(s.isWordLike) && /\p{L}/u.test(s.segment)
    const last = out[out.length - 1]
    if (!word && last && !last.word) last.text += s.segment
    else out.push({ text: s.segment, word })
  }
  return out
}

/** Ключ слова для запоминания и для ответа модели: без регистра, с прямым апострофом. */
export function wordKey(word: string): string {
  return word.normalize('NFC').toLowerCase().replace(/[’ʼ`]/g, "'")
}

/** Подсказки для латиницы: буквы, которых нет в английском, и самые частые служебные слова. */
const LATIN_HINTS: Array<{ lang: string; letters: RegExp; words: string[] }> = [
  {
    lang: 'de',
    letters: /[äöüß]/i,
    words: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'ein', 'eine', 'mit', 'auf', 'für', 'wir', 'sind', 'den', 'von', 'auch', 'es']
  },
  {
    lang: 'fr',
    letters: /[çèêëîïôûœ]/i,
    words: ['le', 'la', 'les', 'et', 'est', 'une', 'des', 'je', 'vous', 'pas', 'qui', 'dans', 'pour', 'avec', 'ce', 'il', 'elle', 'nous', 'du', 'au']
  },
  {
    lang: 'es',
    letters: /[ñ¿¡]/i,
    words: ['el', 'los', 'las', 'y', 'es', 'una', 'que', 'en', 'por', 'para', 'con', 'yo', 'muy', 'pero', 'como', 'está', 'del']
  },
  {
    lang: 'it',
    letters: /[ìò]/i,
    words: ['il', 'lo', 'gli', 'e', 'è', 'che', 'di', 'non', 'per', 'sono', 'mi', 'ti', 'ci', 'della', 'questo', 'molto']
  },
  {
    lang: 'pt',
    letters: /[ãõ]/i,
    words: ['o', 'os', 'as', 'é', 'um', 'uma', 'que', 'não', 'com', 'eu', 'você', 'muito', 'mas', 'isso', 'do', 'da']
  },
  {
    lang: 'pl',
    letters: /[ąćęłńśźż]/i,
    words: ['i', 'w', 'nie', 'to', 'jest', 'się', 'na', 'że', 'z', 'do', 'jak', 'ale', 'co', 'tak', 'czy', 'jestem']
  },
  {
    lang: 'tr',
    letters: /[ğışİ]/,
    words: ['ve', 'bir', 'bu', 'da', 'ne', 'için', 'çok', 'ben', 'sen', 'var', 'yok', 'mi', 'ile', 'gibi']
  },
  {
    lang: 'en',
    letters: /(?!)/,
    words: ['the', 'and', 'is', 'are', 'you', 'i', 'a', 'an', 'to', 'of', 'in', 'it', 'that', 'this', 'with', 'for', 'on', 'was', 'have', 'not', 'what', 'my', 'your', 'we', 'they']
  }
]

/**
 * Язык латинского текста по буквам и служебным словам. Без явных признаков —
 * английский: его учат чаще всего, а одиночное слово иначе не распознать.
 */
function detectLatin(text: string): string {
  const words = (text.toLowerCase().match(/\p{L}+/gu) ?? []) as string[]
  let best = 'en'
  let bestScore = 0
  for (const hint of LATIN_HINTS) {
    let score = hint.letters.test(text) ? 3 : 0
    for (const w of words) if (hint.words.includes(w)) score++
    if (score > bestScore) {
      best = hint.lang
      bestScore = score
    }
  }
  return best
}

/**
 * Язык текста: 'ru', код иностранного языка или null, если букв нет совсем.
 * Китайский, японский и корейский узнаются по письменности. Чистая функция.
 */
export function detectLang(text: string): string | null {
  const letters = text.match(/\p{L}/gu)
  if (!letters) return null
  const share = (re: RegExp): number => letters.filter((ch) => re.test(ch)).length / letters.length
  if (share(/\p{Script=Cyrillic}/u) > 0.5) return 'ru'
  const kana = share(/[\p{Script=Hiragana}\p{Script=Katakana}]/u)
  const han = share(/\p{Script=Han}/u)
  if (kana > 0 && kana + han > 0.3) return 'ja'
  if (share(/\p{Script=Hangul}/u) > 0.3) return 'ko'
  if (han > 0.3) return 'zh'
  return detectLatin(text)
}

/**
 * Язык, на котором текст нужно транскрибировать, или null — когда не нужно.
 * Русский не транскрибируем: это родной язык. Подсказку (язык из списка) берём
 * на веру, только если текст и правда не русский: перевод «на английский»
 * текста, который и так английский, или ошибочно выбранный язык оригинала
 * не должны давать значки под кириллицей.
 */
export function foreignLang(text: string, hint?: string): string | null {
  if (!text.trim() || cyrShare(text) > 0.5) return null
  const lang = hint && hint !== 'auto' ? hint : detectLang(text)
  if (!lang || lang === 'ru') return null
  return lang
}

/**
 * Приводит произношение из ответа модели к виду из словарей. Скобки и косые
 * черты рисует окно; точки между слогами (так пишут французские словари) только
 * мешают читать. В английском — r вместо ɹ и e вместо ɛ: так пишут Oxford и
 * Cambridge, и так учат в школе — модель же нет-нет да и вернёт американскую
 * запись. Чистая функция.
 */
export function normalizePron(raw: string, lang: string): string {
  let s = raw
    .normalize('NFC')
    .replace(/[[\]/\\]/g, '')
    .replace(/\s+/g, '')
  if (phoneticsKind(lang) === 'ipa') s = s.replace(/\./g, '')
  if (lang === 'en') s = s.replace(/ɹ/g, 'r').replace(/ɛ/g, 'e')
  return s
}

/**
 * Достаёт из ответа модели пары «слово → произношение». Модель просят вернуть
 * чистый JSON, но на деле бывает всякое: обёртка ```json, рассуждения перед
 * ответом, вложенный объект {"words": {...}} или массив пар. Всё, что не похоже
 * на пару строк, отбрасываем. null — разобрать не удалось. Чистая функция.
 */
export function parsePhoneticsReply(raw: string): Record<string, string> | null {
  const close = raw.lastIndexOf('</think>')
  const body = close === -1 ? raw : raw.slice(close + '</think>'.length)
  const start = body.search(/[{[]/)
  if (start === -1) return null
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  let data: unknown = null
  if (end > start) {
    try {
      data = JSON.parse(body.slice(start, end + 1))
    } catch {
      data = null
    }
  }
  // ответ оборвался на пределе длины и JSON не закрыт — готовые пары всё равно берём:
  // тридцать слов из сорока лучше, чем ни одного
  if (data === null) data = salvagePairs(body.slice(start))
  if (data === null) return null
  if (data && typeof data === 'object' && !Array.isArray(data) && 'words' in data) {
    data = (data as { words: unknown }).words
  }
  const out: Record<string, string> = {}
  const put = (word: unknown, pron: unknown): void => {
    if (typeof word === 'string' && typeof pron === 'string' && word.trim() && pron.trim()) {
      out[wordKey(word.trim())] = pron.trim()
    }
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      if (Array.isArray(item)) put(item[0], item[1])
      else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>
        put(o.word, o.pron ?? o.ipa ?? o.transcription)
      }
    }
  } else if (data && typeof data === 'object') {
    for (const [w, p] of Object.entries(data)) put(w, p)
  } else {
    return null
  }
  return Object.keys(out).length ? out : null
}

/** Пары «"слово": "произношение"» из незакрытого JSON. */
function salvagePairs(text: string): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const m of text.matchAll(/"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) out[m[1]] = m[2]
  return Object.keys(out).length ? out : null
}

/** Собирает транскрипцию текста из найденных произношений. Чистая функция. */
export function buildPhonetics(
  text: string,
  lang: string,
  pron: (key: string) => string | undefined
): Phonetics {
  return {
    lang,
    kind: phoneticsKind(lang),
    segments: segmentText(text, lang).map((p) =>
      p.word ? { text: p.text, pron: pron(wordKey(p.text)) ?? '' } : { text: p.text }
    )
  }
}

/**
 * Английские слова, которые читаются по-разному в зависимости от смысла:
 * read — [riːd] и [red], live — [lɪv] и [laɪv]. Их не запоминаем: модель
 * транскрибирует по контексту, а запомненный вариант из прошлого текста
 * подсунул бы чужое прочтение.
 */
const HETERONYMS_EN = new Set([
  'read', 'live', 'lives', 'lead', 'wind', 'tear', 'tears', 'close', 'use', 'used', 'uses',
  'record', 'present', 'object', 'wound', 'bow', 'row', 'minute', 'desert', 'does', 'bass',
  'content', 'invalid', 'polish', 'refuse', 'project', 'produce', 'permit', 'conduct',
  'contract', 'increase', 'decrease', 'export', 'import', 'progress', 'subject', 'separate',
  'estimate', 'moderate', 'graduate', 'house', 'excuse', 'abuse', 'associate', 'advocate',
  'dove', 'sow', 'putting', 'resume', 'entrance', 'august', 'lower'
])

/** Сколько слов помнить. Восемь тысяч — это словарь школьника с запасом, а файл — сотни килобайт. */
const MAX_REMEMBERED = 8000

/**
 * Запомненные произношения слов. Одно и то же слово попадается снова и снова —
 * спрашивать его у сервиса каждый раз значит тратить лимит запросов, которого
 * у бесплатного доступа немного, и заставлять ждать там, где ответ уже известен.
 */
export class PhoneticsMemory {
  private store: JsonFileStore<{ words: Record<string, string> }>

  constructor(filePath: string) {
    this.store = new JsonFileStore(filePath, { words: {} })
  }

  /** Можно ли брать слово из памяти и класть в неё. */
  static remembers(lang: string, key: string): boolean {
    return !(lang === 'en' && HETERONYMS_EN.has(key))
  }

  /** Что из этих слов уже известно. Файл читается один раз на весь список, а не на каждое слово. */
  recall(lang: string, keys: string[]): Record<string, string> {
    const words = this.store.read().words
    const out: Record<string, string> = {}
    for (const key of keys) {
      const pron = PhoneticsMemory.remembers(lang, key) ? words[`${lang}:${key}`] : undefined
      if (pron) out[key] = pron
    }
    return out
  }

  remember(lang: string, found: Record<string, string>): void {
    const words = this.store.read().words
    let changed = false
    for (const [key, pron] of Object.entries(found)) {
      if (!PhoneticsMemory.remembers(lang, key)) continue
      const k = `${lang}:${key}`
      if (words[k] === pron) continue
      // удаляем и кладём заново: свежие слова уходят в конец, а лишнее срезается с начала
      delete words[k]
      words[k] = pron
      changed = true
    }
    if (!changed) return
    const keys = Object.keys(words)
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete words[k]
    this.store.write({ words })
  }
}
