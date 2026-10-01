import { JsonFileStore } from './json-store'
import type { TranslationEntry } from '../../shared/types'

/** Максимум хранимых переводов — старые обрезаются при добавлении. */
const MAX_ENTRIES = 500

type AddInput = Omit<TranslationEntry, 'id' | 'createdAt'>

/** История переводов (панель Ctrl+V×2 и вкладка «Переводчик»), по образцу HistoryService. */
export class TranslationStore {
  private store: JsonFileStore<{ entries: TranslationEntry[] }>
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

  private all(): TranslationEntry[] {
    return this.store.read().entries
  }

  private save(entries: TranslationEntry[]): void {
    this.store.write({ entries })
    this.emit()
  }

  add(input: AddInput): TranslationEntry {
    const entry: TranslationEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...input
    }
    // записи добавляются по порядку — обрезаем хвост (самые старые) при переполнении
    const entries = [...this.all(), entry]
    const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries
    this.save(trimmed)
    return entry
  }

  list(search?: string, limit?: number): TranslationEntry[] {
    let entries = [...this.all()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (search?.trim()) {
      const q = search.trim().toLowerCase()
      entries = entries.filter((e) => (e.source + ' ' + e.result).toLowerCase().includes(q))
    }
    if (limit !== undefined) entries = entries.slice(0, limit)
    return entries
  }

  delete(id: string): TranslationEntry | null {
    const entries = this.all()
    const found = entries.find((e) => e.id === id) ?? null
    if (found) this.save(entries.filter((e) => e.id !== id))
    return found
  }

  clear(): void {
    this.save([])
  }
}
