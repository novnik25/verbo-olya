import { JsonFileStore } from './json-store'
import type { DayActivity, HistoryEntry, Stats } from '../../shared/types'

export function countWords(text: string): number {
  // слово = токен, содержащий хотя бы одну букву или цифру (одинокое «—» не слово)
  return text.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/** Слова текста: чистые последовательности букв/цифр без пунктуации, в нижнем регистре. */
function extractWords(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * Сколько слов styled отсутствует в мультимножестве слов raw (без учёта регистра).
 * Совпадающие слова «гасят» друг друга по одному, поэтому перестановка/пунктуация
 * не считаются изменением, а вставленное новое слово — считается.
 */
export function countChangedWords(raw: string, styled: string): number {
  const rawCounts = new Map<string, number>()
  for (const w of extractWords(raw)) rawCounts.set(w, (rawCounts.get(w) ?? 0) + 1)
  let changed = 0
  for (const w of extractWords(styled)) {
    const left = rawCounts.get(w) ?? 0
    if (left > 0) rawCounts.set(w, left - 1)
    else changed++
  }
  return changed
}

/** Локальная календарная дата в виде YYYY-MM-DD. */
function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Номер дня относительно эпохи, устойчивый к переходам на летнее/зимнее время. */
function dayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** Самая длинная серия подряд идущих календарных дней в наборе дат. */
function longestStreakFromDays(days: Set<string>): number {
  const indices = [...days].map(dayIndex).sort((a, b) => a - b)
  let longest = 0
  let current = 0
  let prev: number | null = null
  for (const idx of indices) {
    current = prev !== null && idx === prev + 1 ? current + 1 : 1
    if (current > longest) longest = current
    prev = idx
  }
  return longest
}

/** Ровно `count` дней подряд, заканчивая `now`, старые → новые; дни без диктовок — 0 слов. */
function buildByDay(done: HistoryEntry[], now: Date, count: number): DayActivity[] {
  const wordsByDay = new Map<string, number>()
  for (const e of done) {
    const key = localDateKey(new Date(e.createdAt))
    wordsByDay.set(key, (wordsByDay.get(key) ?? 0) + e.wordCount)
  }
  const result: DayActivity[] = []
  for (let i = count - 1; i >= 0; i--) {
    const key = localDateKey(new Date(now.getTime() - i * 86_400_000))
    result.push({ date: key, words: wordsByDay.get(key) ?? 0 })
  }
  return result
}

/** Количество диктовок по стилю, по убыванию. */
function buildStyleBreakdown(done: HistoryEntry[]): Array<{ styleId: string; count: number }> {
  const counts = new Map<string, number>()
  for (const e of done) counts.set(e.styleId, (counts.get(e.styleId) ?? 0) + 1)
  return [...counts.entries()]
    .map(([styleId, count]) => ({ styleId, count }))
    .sort((a, b) => b.count - a.count)
}

function buildLangBreakdown(done: HistoryEntry[]): Array<{ lang: string; count: number }> {
  const counts = new Map<string, number>()
  // старые записи без поля считаем «как говорю»
  for (const e of done) {
    const lang = e.outputLang ?? 'none'
    counts.set(lang, (counts.get(lang) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => b.count - a.count)
}

type AddInput = Omit<HistoryEntry, 'id' | 'createdAt' | 'wordCount'> & {
  id?: string
  createdAt?: string
}

export class HistoryService {
  private store: JsonFileStore<{ entries: HistoryEntry[] }>
  private listeners: Array<() => void> = []

  constructor(filePath: string) {
    this.store = new JsonFileStore(filePath, { entries: [] })
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb)
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }

  private all(): HistoryEntry[] {
    return this.store.read().entries
  }

  private save(entries: HistoryEntry[]): void {
    this.store.write({ entries })
    this.emit()
  }

  add(input: AddInput): HistoryEntry {
    const entry: HistoryEntry = {
      id: input.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: input.createdAt ?? new Date().toISOString(),
      wordCount: countWords(input.styledText ?? input.rawText ?? ''),
      ...input
    } as HistoryEntry
    this.save([...this.all(), entry])
    return entry
  }

  update(id: string, patch: Partial<HistoryEntry>): HistoryEntry | null {
    const entries = this.all()
    const i = entries.findIndex((e) => e.id === id)
    if (i === -1) return null
    const updated = { ...entries[i], ...patch }
    if (patch.styledText !== undefined || patch.rawText !== undefined) {
      updated.wordCount = countWords(updated.styledText ?? updated.rawText ?? '')
    }
    entries[i] = updated
    this.save(entries)
    return updated
  }

  delete(id: string): HistoryEntry | null {
    const entries = this.all()
    const found = entries.find((e) => e.id === id) ?? null
    if (found) this.save(entries.filter((e) => e.id !== id))
    return found
  }

  list(search?: string): HistoryEntry[] {
    let entries = [...this.all()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (search?.trim()) {
      const q = search.trim().toLowerCase()
      entries = entries.filter((e) =>
        ((e.styledText ?? '') + ' ' + (e.rawText ?? '')).toLowerCase().includes(q)
      )
    }
    return entries
  }

  pending(): HistoryEntry[] {
    return this.all().filter((e) => e.status === 'pending')
  }

  stats(now: Date = new Date()): Stats {
    const done = this.all().filter((e) => e.status === 'done')
    const totalWords = done.reduce((s, e) => s + e.wordCount, 0)
    const totalDurationMs = done.reduce((s, e) => s + e.durationMs, 0)
    const totalMin = totalDurationMs / 60_000
    const days = new Set(done.map((e) => localDateKey(new Date(e.createdAt))))

    let streakDays = 0
    // серия: подряд идущие дни с диктовками, заканчивающиеся сегодня или вчера
    let cursor = new Date(now)
    if (!days.has(localDateKey(cursor))) cursor = new Date(cursor.getTime() - 86_400_000)
    while (days.has(localDateKey(cursor))) {
      streakDays++
      cursor = new Date(cursor.getTime() - 86_400_000)
    }

    const fixedWords = done.reduce((sum, e) => {
      if (e.rawText !== undefined && e.styledText !== undefined && e.rawText !== e.styledText) {
        return sum + countChangedWords(e.rawText, e.styledText)
      }
      return sum
    }, 0)

    const MS30 = 30 * 86_400_000
    let words30 = 0
    let wordsPrev30 = 0
    for (const e of done) {
      const elapsed = now.getTime() - Date.parse(e.createdAt)
      if (elapsed >= 0 && elapsed < MS30) words30 += e.wordCount
      else if (elapsed >= MS30 && elapsed < 2 * MS30) wordsPrev30 += e.wordCount
    }

    return {
      totalWords,
      wpm: totalMin > 0 ? totalWords / totalMin : 0,
      streakDays,
      longestStreak: longestStreakFromDays(days),
      totalEntries: done.length,
      totalDurationMs,
      fixedWords,
      words30,
      wordsPrev30,
      byDay: buildByDay(done, now, 140),
      styleBreakdown: buildStyleBreakdown(done),
      langBreakdown: buildLangBreakdown(done),
      topTerms: []
    }
  }
}
