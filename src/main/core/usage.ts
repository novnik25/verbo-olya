import { JsonFileStore } from './json-store'
import type { UsageBucket, UsageData, UsageStats, UsageSummary } from '../../shared/types'

/** Сколько дней хранить подённые счётчики. */
const KEEP_DAYS = 180
/** Знаков в минуту при чтении вслух — для оценки длительности озвучивания. */
const CHARS_PER_MINUTE = 900

export function emptyBucket(): UsageBucket {
  return { total: 0, chars: 0, byKey: {}, byDay: {} }
}

export function localDayKey(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Сколько знаков реально прочитано вслух. Считаем ТОЛЬКО дочитанные фрагменты:
 * раньше вся длина текста засчитывалась ещё до синтеза, поэтому сбой голоса или
 * «Стоп» на второй секунде попадали в статистику как полностью прочитанный текст.
 */
export function spokenChars(chunks: string[], completed: number): number {
  const n = Math.min(Math.max(0, completed), chunks.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += chunks[i].length
  return sum
}

/** Обрезает подённые счётчики до KEEP_DAYS последних дат. Чистая функция. */
export function trimDays(byDay: Record<string, number>, keep = KEEP_DAYS): Record<string, number> {
  const keys = Object.keys(byDay).sort()
  if (keys.length <= keep) return byDay
  const out: Record<string, number> = {}
  for (const k of keys.slice(keys.length - keep)) out[k] = byDay[k]
  return out
}

/** Сводка по одному разделу: всего, за 30 дней, активные дни, топ ключей. Чистая функция. */
export function summarize(bucket: UsageBucket, now: Date = new Date()): UsageSummary {
  const cutoff = new Date(now.getTime() - 29 * 86_400_000)
  const cutoffKey = localDayKey(cutoff)
  let last30 = 0
  let activeDays = 0
  for (const [day, count] of Object.entries(bucket.byDay)) {
    if (count > 0) activeDays++
    if (day >= cutoffKey) last30 += count
  }
  const top = Object.entries(bucket.byKey)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 5)
  return {
    total: bucket.total,
    chars: bucket.chars,
    last30,
    activeDays,
    minutes: Math.round(bucket.chars / CHARS_PER_MINUTE),
    top
  }
}

/**
 * Счётчики использования переводчика и озвучивания. Хранит ТОЛЬКО числа —
 * ни исходных текстов, ни результатов, поэтому не зависит от истории переводов
 * и переживает её очистку.
 */
export class UsageStore {
  private store: JsonFileStore<UsageData>

  constructor(filePath: string) {
    this.store = new JsonFileStore(filePath, { translate: emptyBucket(), speak: emptyBucket() })
  }

  data(): UsageData {
    const raw = this.store.read()
    return {
      translate: { ...emptyBucket(), ...raw.translate },
      speak: { ...emptyBucket(), ...raw.speak }
    }
  }

  /** Учитывает одно событие: key — язык перевода или голос озвучивания. */
  record(section: keyof UsageData, input: { key: string; chars: number }, now: Date = new Date()): void {
    const data = this.data()
    const bucket = data[section]
    const day = localDayKey(now)
    bucket.total += 1
    bucket.chars += Math.max(0, input.chars)
    bucket.byKey[input.key] = (bucket.byKey[input.key] ?? 0) + 1
    bucket.byDay[day] = (bucket.byDay[day] ?? 0) + 1
    bucket.byDay = trimDays(bucket.byDay)
    this.store.write(data)
  }

  stats(now: Date = new Date()): UsageStats {
    const data = this.data()
    return { translate: summarize(data.translate, now), speak: summarize(data.speak, now) }
  }
}
