/** Обрезает текст до max символов, добавляя многоточие; короткий текст не меняется. */
export function truncate(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return t.slice(0, max).trimEnd() + '…'
}
