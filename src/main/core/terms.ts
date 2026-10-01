// Частые английские служебные слова — не термины, даже если встречаются часто.
const STOPWORDS = new Set([
  'the', 'and', 'you', 'for', 'this', 'that', 'with', 'have', 'from', 'your',
  'are', 'was', 'were', 'will', 'would', 'could', 'should', 'about', 'into',
  'than', 'then', 'them', 'their', 'what', 'when', 'where', 'which', 'who', 'why', 'how'
])

const TOKEN_RE = /[A-Za-zА-ЯЁ][\w.\-А-Яа-яЁё]{1,}/g

/** Символ перед токеном (пропуская пробелы/табы) — начало строки или конец предыдущего предложения? */
function isSentenceStart(text: string, index: number): boolean {
  let i = index - 1
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) i--
  if (i < 0) return true // самое начало текста
  const ch = text[i]
  return ch === '\n' || ch === '.' || ch === '!' || ch === '?'
}

/** Термин-кандидат: (а) латиница ≥3 не из стоп-списка, (б) цифра+буква, (в) Заглавная-Кириллица не в начале предложения. */
function isCandidate(token: string, text: string, index: number): boolean {
  const hasDigit = /\d/.test(token)
  const hasLetter = /\p{L}/u.test(token)
  if (hasDigit && hasLetter) return true
  if (/[A-Za-z]/.test(token) && token.length >= 3 && !STOPWORDS.has(token.toLowerCase())) return true
  if (/^[А-ЯЁ]/.test(token) && !isSentenceStart(text, index)) return true
  return false
}

/**
 * Извлекает «особые» термины пользователя: латинские названия, слова с цифрами,
 * русские Имена С Большой буквы не в начале предложения. Частота ≥ 2.
 */
export function extractTerms(texts: string[], limit = 15): string[] {
  const counts = new Map<string, number>() // ключ — токен в нижнем регистре
  const firstForm = new Map<string, string>() // ключ -> написание первого вхождения

  for (const text of texts) {
    for (const m of text.matchAll(TOKEN_RE)) {
      const token = m[0]
      if (!isCandidate(token, text, m.index ?? 0)) continue
      const key = token.toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (!firstForm.has(key)) firstForm.set(key, token)
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => firstForm.get(key)!)
}
