import { describe, it, expect } from 'vitest'
import { BUILTIN_STYLES, migrateStyles } from '../src/shared/styles-presets'
import type { Style } from '../src/shared/types'

const OLD_CLEAN =
  'Ты — редактор диктовки. Приведи надиктованный текст в порядок: убери слова-паразиты ' +
  '(«э-э», «ну», «как бы», «короче», «типа», «вот»), исправь пунктуацию, регистр и явные ' +
  'оговорки. Сохрани смысл, порядок мыслей и живой стиль речи. Ничего не добавляй от себя ' +
  'и не сокращай содержание. Отвечай ТОЛЬКО исправленным текстом, без пояснений и кавычек. ' +
  'Язык ответа = язык исходного текста.'

const cleanNow = BUILTIN_STYLES.find((b) => b.id === 'clean')!

describe('migrateStyles', () => {
  it('актуальные стили не трогает (null)', () => {
    expect(migrateStyles([...BUILTIN_STYLES])).toBeNull()
  })
  it('старый нередактированный clean обновляется до новой версии', () => {
    const user: Style[] = BUILTIN_STYLES.map((b) =>
      b.id === 'clean' ? { ...b, prompt: OLD_CLEAN } : b
    )
    const migrated = migrateStyles(user)!
    expect(migrated.find((s) => s.id === 'clean')!.prompt).toBe(cleanNow.prompt)
  })
  it('отредактированный пользователем промпт НЕ перезаписывается', () => {
    const user: Style[] = BUILTIN_STYLES.map((b) =>
      b.id === 'clean' ? { ...b, prompt: 'мой особый промпт' } : b
    )
    expect(migrateStyles(user)).toBeNull()
  })
  it('пользовательские стили не трогаются, отсутствующий builtin добавляется', () => {
    const custom: Style = { id: 'custom-1', name: 'Мой', prompt: 'x', builtin: false }
    const withoutPrompt = BUILTIN_STYLES.filter((b) => b.id !== 'prompt')
    const migrated = migrateStyles([...withoutPrompt, custom])!
    expect(migrated.some((s) => s.id === 'prompt')).toBe(true)
    expect(migrated.find((s) => s.id === 'custom-1')!.prompt).toBe('x')
  })
})
