import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { MARK, markPaths } from '../src/shared/mark'

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')

describe('фирменный знак нарисован по одному канону', () => {
  it('пути собираются из канонических точек', () => {
    expect(markPaths()).toEqual({
      accent: 'M74 84 L128 178',
      ink: 'M182 84 L128 178'
    })
  })

  it('иконка приложения нарисована теми же координатами', () => {
    const svg = read('resources/icons/icon.svg')
    const p = markPaths()
    expect(svg).toContain(`d="${p.accent}"`)
    expect(svg).toContain(`d="${p.ink}"`)
    expect(svg).toContain(`stroke-width="${MARK.strokeWidth}"`)
    expect(svg).toContain(`cx="${MARK.dot.x}" cy="${MARK.dot.y}" r="${MARK.dot.r}"`)
    expect(svg).toContain(`viewBox="0 0 ${MARK.box} ${MARK.box}"`)
  })

  it('логотип в окне не держит собственной геометрии', () => {
    const app = read('src/renderer/src/App.tsx')
    // старые координаты знака в системе 0..24 — их быть не должно
    expect(app).not.toContain('M6 7.5')
    expect(app).not.toContain('M18 7.5')
    expect(app).not.toContain('cy="4.6"')
  })

  it('оформление установщика не держит собственной геометрии', () => {
    const art = read('scripts/gen-installer-art.mjs')
    const p = markPaths()
    // знак рисовался своими формулами со scale — теперь только вложенный кубик канона
    expect(art).not.toContain('9 * scale')
    expect(art).not.toContain('16 * scale')
    expect(art).not.toContain('2.6 * scale')
    // обычный node не импортирует TypeScript, поэтому числа продублированы —
    // тест следит, чтобы они не разошлись с каноном
    expect(art).toContain(`const MARK_BOX = ${MARK.box}`)
    expect(art).toContain(`d="${p.accent}"`)
    expect(art).toContain(`d="${p.ink}"`)
    expect(art).toContain(`stroke-width="${MARK.strokeWidth}"`)
    expect(art).toContain(`cx="${MARK.dot.x}" cy="${MARK.dot.y}" r="${MARK.dot.r}"`)
  })
})
