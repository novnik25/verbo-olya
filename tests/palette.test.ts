import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PALETTE, rootVars } from '../src/shared/palette'

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')

/** Достаёт переменные из блока :root указанного селектора. */
function cssVars(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`не найден блок ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const out: Record<string, string> = {}
  for (const line of css.slice(open + 1, close).split('\n')) {
    const m = line.match(/^\s*(--[a-z-]+)\s*:\s*(.+?);/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

describe('палитра живёт в одном месте', () => {
  const styles = read('src/renderer/src/styles.css')

  it('тёмная тема styles.css совпадает с палитрой', () => {
    const vars = cssVars(styles, ':root {')
    for (const [name, value] of Object.entries(PALETTE.dark)) {
      expect(`${name}=${vars[name]}`).toBe(`${name}=${value}`)
    }
  })

  it('светлая тема styles.css совпадает с палитрой', () => {
    const vars = cssVars(styles, ":root[data-theme='light']")
    for (const [name, value] of Object.entries(PALETTE.light)) {
      expect(`${name}=${vars[name]}`).toBe(`${name}=${value}`)
    }
  })

  it('оформление установщика берёт цвета из палитры', () => {
    const art = read('scripts/gen-installer-art.mjs')
    // скрипт запускается обычным node и импортировать TS не может — сверяем значения
    for (const [имя, значение] of [
      ['BG', PALETTE.dark['--bg']],
      ['BG2', PALETTE.dark['--panel']],
      ['INK', PALETTE.dark['--ink']],
      ['MUTED', PALETTE.dark['--muted']],
      ['ACCENT', PALETTE.dark['--accent']]
    ]) {
      expect(art).toContain(`const ${имя} = '${значение}'`)
    }
  })

  it('старый акцент rgba(29, 110, 98) больше нигде не встречается', () => {
    expect(styles).not.toContain('29, 110, 98')
  })

  it('окно выбора области не держит собственную копию акцента', () => {
    const region = read('src/renderer/src/region.tsx')
    expect(region).not.toContain('#4fbf9b')
  })

  it('плавающая панель не держит собственную копию акцента', () => {
    const overlay = read('src/renderer/src/overlay.tsx')
    expect(overlay).not.toContain('#63c9a6')
    expect(overlay).not.toContain('#2c8c74')
    // тинты акцента задавались числами rgb того же цвета
    expect(overlay).not.toContain('99, 201, 166')
  })
})

describe('сборка блока :root', () => {
  it('превращает пары в строки CSS-переменных', () => {
    expect(rootVars({ '--accent': '#000', '--ink': '#fff' })).toBe('--accent: #000;\n--ink: #fff;')
  })

  it('пустой набор даёт пустую строку', () => {
    expect(rootVars({})).toBe('')
  })
})
