/**
 * Транскрипция иностранного текста — общие типы и чистые функции, нужные и
 * главному процессу, и окнам.
 *
 * Слово «транскрипция» в коде занято распознаванием речи (transcribe в groq.ts),
 * поэтому здесь всё называется «произношением» — phonetics / pron.
 */

/** Кусок текста: слово с произношением либо промежуток (пробелы, знаки, переводы строк). */
export interface PhonSegment {
  text: string
  /**
   * Есть только у слов. Пустая строка — слово, произношение которого не нашлось:
   * его всё равно рисуем столбиком, иначе строка разъедется по высоте.
   */
  pron?: string
}

export interface Phonetics {
  /** Код языка из TRANSLATE_LANGS. */
  lang: string
  /** 'ipa' — международные значки; 'roman' — принятая латиница (пиньинь, ромадзи). */
  kind: 'ipa' | 'roman'
  segments: PhonSegment[]
}

/**
 * Ответ главного процесса окну: null — транскрибировать нечего (текст русский).
 * note — транскрипция неполная: часть слов взята из памяти, остальное не загрузилось.
 */
export type PhoneticsReply =
  | { ok: true; phonetics: Phonetics | null; note?: string }
  | { ok: false; message: string }

/** Как показывать произношение под словом. */
export type PhoneticsStyle = 'ipa' | 'ru' | 'both'

export const PHONETICS_STYLES: Array<{ id: PhoneticsStyle; label: string; example: string }> = [
  { id: 'ipa', label: 'Значками', example: '[ˈwɔːtə]' },
  { id: 'ru', label: 'Русскими буквами', example: 'уо́тэ' },
  { id: 'both', label: 'Обоими способами', example: '[ˈwɔːtə] уо́тэ' }
]

/**
 * Языки, для которых в учебниках вместо значков МФА пишут латиницей: китайский
 * учат по пиньиню, японский — по ромадзи. Русскими буквами их не переписываем —
 * правила перевода значков для них не годятся.
 */
export const ROMANIZED: Record<string, string> = {
  zh: 'пиньинь со знаками тонов (nǐ hǎo)',
  ja: 'ромадзи по системе Хепбёрна (konnichiwa)',
  ko: 'латиница по новой романизации (annyeonghaseyo)'
}

export function phoneticsKind(lang: string): Phonetics['kind'] {
  return lang in ROMANIZED ? 'roman' : 'ipa'
}

/** Строка для копирования: [ˈwɔːtə ɪz ˈkəʊld] — так транскрипцию пишут в тетради. */
export function phoneticsLine(p: Phonetics, style: PhoneticsStyle): string {
  const prons = p.segments.map((s) => s.pron).filter((x): x is string => Boolean(x))
  if (p.kind === 'roman') return prons.join(' ')
  const ipa = `[${prons.join(' ')}]`
  const ru = prons.map((x) => ipaToCyrillic(x, p.lang)).join(' ')
  if (style === 'ipa') return ipa
  if (style === 'ru') return ru
  return `${ipa} ${ru}`
}

// ── значки МФА → русские буквы ───────────────────────────────────────────────

/** Знак ударения над гласной. Окна рисуют ударную гласную сами — см. splitStress. */
export const ACUTE = '́'
const RU_VOWELS = 'аеёиоуыэюя'
const RU_CONSONANTS = 'бвгджзйклмнпрстфхцчшщь'

type Unit = { ipa: string; ru: string; vowel: boolean }

/**
 * Звуки по убыванию длины записи: дифтонг «eɪ» обязан узнаваться раньше
 * одиночного «e», иначе day превращается в «дэи».
 *
 * Соответствия — те, к которым привыкли по школьным словарям: θ как «с», ð как
 * «з», w как «у». Точной передачи звука русские буквы всё равно не дают;
 * задача — подсказать чтение тому, кто значков пока не знает.
 */
const UNITS: Unit[] = [
  // носовые гласные (французский): знак тильды идёт отдельным символом
  { ipa: 'ɑ̃', ru: 'ан', vowel: true },
  { ipa: 'ɔ̃', ru: 'он', vowel: true },
  { ipa: 'ɛ̃', ru: 'эн', vowel: true },
  { ipa: 'œ̃', ru: 'эн', vowel: true },
  { ipa: 'ã', ru: 'ан', vowel: true },
  { ipa: 'õ', ru: 'он', vowel: true },
  { ipa: 'ẽ', ru: 'эн', vowel: true },
  // дифтонги
  { ipa: 'eɪ', ru: 'эй', vowel: true },
  { ipa: 'ɛɪ', ru: 'эй', vowel: true },
  { ipa: 'aɪ', ru: 'ай', vowel: true },
  { ipa: 'ɔɪ', ru: 'ой', vowel: true },
  { ipa: 'ɔʏ', ru: 'ой', vowel: true },
  { ipa: 'aʊ', ru: 'ау', vowel: true },
  { ipa: 'əʊ', ru: 'оу', vowel: true },
  { ipa: 'oʊ', ru: 'оу', vowel: true },
  { ipa: 'ɪə', ru: 'иэ', vowel: true },
  { ipa: 'eə', ru: 'эа', vowel: true },
  { ipa: 'ɛə', ru: 'эа', vowel: true },
  { ipa: 'ʊə', ru: 'уэ', vowel: true },
  // долгие гласные
  { ipa: 'iː', ru: 'и', vowel: true },
  { ipa: 'uː', ru: 'у', vowel: true },
  { ipa: 'ɑː', ru: 'а', vowel: true },
  { ipa: 'ɔː', ru: 'о', vowel: true },
  { ipa: 'ɜː', ru: 'ё', vowel: true },
  { ipa: 'aː', ru: 'а', vowel: true },
  { ipa: 'oː', ru: 'о', vowel: true },
  { ipa: 'eː', ru: 'е', vowel: true },
  { ipa: 'ɛː', ru: 'е', vowel: true },
  { ipa: 'yː', ru: 'ю', vowel: true },
  { ipa: 'øː', ru: 'ё', vowel: true },
  // сочетания согласных
  { ipa: 'tʃ', ru: 'ч', vowel: false },
  { ipa: 'dʒ', ru: 'дж', vowel: false },
  { ipa: 'ts', ru: 'ц', vowel: false },
  // гласные
  { ipa: 'i', ru: 'и', vowel: true },
  { ipa: 'ɪ', ru: 'и', vowel: true },
  { ipa: 'e', ru: 'е', vowel: true },
  { ipa: 'ɛ', ru: 'е', vowel: true },
  { ipa: 'æ', ru: 'э', vowel: true },
  { ipa: 'a', ru: 'а', vowel: true },
  { ipa: 'ɑ', ru: 'а', vowel: true },
  { ipa: 'ɐ', ru: 'а', vowel: true },
  { ipa: 'ʌ', ru: 'а', vowel: true },
  { ipa: 'ɒ', ru: 'о', vowel: true },
  { ipa: 'ɔ', ru: 'о', vowel: true },
  { ipa: 'o', ru: 'о', vowel: true },
  { ipa: 'ə', ru: 'э', vowel: true },
  { ipa: 'ɘ', ru: 'э', vowel: true },
  { ipa: 'ɜ', ru: 'ё', vowel: true },
  { ipa: 'ɵ', ru: 'ё', vowel: true },
  { ipa: 'ø', ru: 'ё', vowel: true },
  { ipa: 'œ', ru: 'ё', vowel: true },
  { ipa: 'u', ru: 'у', vowel: true },
  { ipa: 'ʊ', ru: 'у', vowel: true },
  { ipa: 'y', ru: 'ю', vowel: true },
  { ipa: 'ʏ', ru: 'ю', vowel: true },
  { ipa: 'ɨ', ru: 'ы', vowel: true },
  { ipa: 'ɯ', ru: 'ы', vowel: true },
  // согласные
  { ipa: 'p', ru: 'п', vowel: false },
  { ipa: 'b', ru: 'б', vowel: false },
  { ipa: 't', ru: 'т', vowel: false },
  { ipa: 'd', ru: 'д', vowel: false },
  { ipa: 'k', ru: 'к', vowel: false },
  { ipa: 'g', ru: 'г', vowel: false },
  { ipa: 'ɡ', ru: 'г', vowel: false },
  { ipa: 'c', ru: 'кь', vowel: false },
  { ipa: 'ɟ', ru: 'гь', vowel: false },
  { ipa: 'f', ru: 'ф', vowel: false },
  { ipa: 'v', ru: 'в', vowel: false },
  { ipa: 'β', ru: 'в', vowel: false },
  { ipa: 'θ', ru: 'с', vowel: false },
  { ipa: 'ð', ru: 'з', vowel: false },
  { ipa: 's', ru: 'с', vowel: false },
  { ipa: 'z', ru: 'з', vowel: false },
  { ipa: 'ʃ', ru: 'ш', vowel: false },
  { ipa: 'ʂ', ru: 'ш', vowel: false },
  { ipa: 'ɕ', ru: 'щ', vowel: false },
  { ipa: 'ʒ', ru: 'ж', vowel: false },
  { ipa: 'ʐ', ru: 'ж', vowel: false },
  { ipa: 'h', ru: 'х', vowel: false },
  { ipa: 'x', ru: 'х', vowel: false },
  { ipa: 'χ', ru: 'х', vowel: false },
  { ipa: 'ç', ru: 'хь', vowel: false },
  { ipa: 'ɣ', ru: 'г', vowel: false },
  { ipa: 'm', ru: 'м', vowel: false },
  { ipa: 'n', ru: 'н', vowel: false },
  { ipa: 'ɲ', ru: 'нь', vowel: false },
  { ipa: 'ŋ', ru: 'нг', vowel: false },
  { ipa: 'l', ru: 'л', vowel: false },
  { ipa: 'ɫ', ru: 'л', vowel: false },
  { ipa: 'ʎ', ru: 'ль', vowel: false },
  { ipa: 'r', ru: 'р', vowel: false },
  { ipa: 'ɹ', ru: 'р', vowel: false },
  { ipa: 'ɾ', ru: 'р', vowel: false },
  { ipa: 'ʁ', ru: 'р', vowel: false },
  { ipa: 'ʀ', ru: 'р', vowel: false },
  { ipa: 'w', ru: 'у', vowel: false },
  { ipa: 'ʍ', ru: 'у', vowel: false },
  { ipa: 'ɥ', ru: 'у', vowel: false },
  { ipa: 'j', ru: 'й', vowel: false },
  { ipa: 'ʲ', ru: 'ь', vowel: false }
]

/** Значки, которые в русской записи не нужны: долгота без гласной, слоги, придыхание. */
const SILENT = new Set(['ː', 'ˑ', 'ˌ', '.', '‿', '̩', '̯', '͡', '͜', 'ʰ', 'ʔ', '-', ' '])

/** Йотированные: «j» перед гласной сливается с ней в одну букву — you → «ю», а не «йу». */
const IOTATED: Record<string, string> = { у: 'ю', а: 'я', э: 'е', е: 'е', о: 'ё', ё: 'ё', и: 'и' }

/**
 * Переписывает произношение из значков МФА русскими буквами: ˈwɔːtə → «уо́тэ».
 * Ударение ставится знаком над гласной; в односложных словах его нет — как и в
 * словарях. Чистая функция.
 *
 * lang нужен для «ts»: в английском cats — это «кэтс», а в немецком Zeit — «цайт».
 */
export function ipaToCyrillic(ipa: string, lang = 'en'): string {
  // необязательные звуки в скобках, (ə) в ˈæp(ə)l, по-русски не пишем
  const src = ipa.normalize('NFC').replace(/\([^)]*\)/g, '').replace(/[[\]/]/g, '')
  const units: Unit[] = []
  const stressAt = new Set<number>() // номера звуков, перед которыми стоял знак ударения
  for (let i = 0; i < src.length; ) {
    const ch = src[i]
    if (ch === 'ˈ' || ch === "'") {
      stressAt.add(units.length)
      i++
      continue
    }
    if (SILENT.has(ch)) {
      i++
      continue
    }
    const found = UNITS.find(
      (u) => src.startsWith(u.ipa, i) && !(u.ipa === 'ts' && lang === 'en')
    )
    if (!found) {
      i++ // незнакомый значок пропускаем: лучше неполная подсказка, чем мусор в ней
      continue
    }
    units.push(found)
    i += found.ipa.length
  }

  let out = ''
  let pendingStress = false
  let vowels = 0
  const prevIsConsonant = (): boolean => out.length > 0 && RU_CONSONANTS.includes(out[out.length - 1])
  const putVowel = (ru: string): void => {
    vowels++
    // знак — над первой ГЛАСНОЙ: у «йе» первая буква «й», и ударение вставало над ней
    const at = [...ru].findIndex((ch) => RU_VOWELS.includes(ch))
    if (pendingStress && at !== -1 && ru[at] !== 'ё') {
      out += ru.slice(0, at + 1) + ACUTE + ru.slice(at + 1)
    } else {
      out += ru
    }
    pendingStress = false
  }

  for (let k = 0; k < units.length; k++) {
    if (stressAt.has(k)) pendingStress = true
    const u = units[k]
    if (u.ipa === 'j') {
      const next = units[k + 1]
      if (next?.vowel && IOTATED[next.ru[0]] !== undefined) {
        if (stressAt.has(k + 1)) pendingStress = true
        // после согласной — разделительный «ь»: beautiful → «бью́тифэл»
        const sign = prevIsConsonant() ? 'ь' : ''
        const iot = IOTATED[next.ru[0]]
        // «е» и «и» в начале слова читались бы без «й» — оставляем его явно: yes → «йес»
        const head = !sign && (iot === 'е' || iot === 'и') ? 'й' + iot : iot
        out += sign
        putVowel(head + next.ru.slice(1))
        k++
        continue
      }
      out += 'й'
      continue
    }
    if (u.vowel) {
      // «e» после согласной — «е» (bed → «бед»), в начале и после гласной — «э»
      const ru = u.ru === 'е' && !prevIsConsonant() ? 'э' : u.ru
      putVowel(ru)
      continue
    }
    if (u.ipa === 'w' && units[k + 1]?.vowel && units[k + 1].ru.startsWith('у')) {
      // «уу» не прочесть: would по-русски пишут «вуд», woman — «вумэн»
      out += 'в'
      continue
    }
    if (u.ipa === 'ŋ') {
      // перед k и g носовое «нг» звучит просто как «н»: thank → «сэнк»
      const next = units[k + 1]
      out += next && (next.ipa === 'k' || next.ipa === 'g' || next.ipa === 'ɡ') ? 'н' : 'нг'
      continue
    }
    out += u.ru
  }

  // в слове с одной гласной ударение не показывают
  if (vowels <= 1) out = out.split(ACUTE).join('')
  return out
}

/**
 * Делит запись русскими буквами на «до ударной гласной», ударную гласную и
 * «после». Окна выделяют ударную гласную цветом и жирностью, а не знаком над
 * ней: шрифты Windows рисуют комбинируемый знак ударения со сдвигом, и он
 * казался стоящим над соседней согласной. Чистая функция.
 */
export function splitStress(ru: string): { before: string; stressed: string; after: string } | null {
  const i = ru.indexOf(ACUTE)
  if (i < 1) return null
  return { before: ru.slice(0, i - 1), stressed: ru[i - 1], after: ru.slice(i + 1) }
}
