import { describe, it, expect } from 'vitest'
import { splitForTranslate } from '../src/main/core/text-split'

describe('splitForTranslate', () => {
  it('короткий текст остаётся одним куском', () => {
    expect(splitForTranslate('Привет, мир.', 100)).toEqual(['Привет, мир.'])
  })

  it('пустой текст — ни одного куска', () => {
    expect(splitForTranslate('', 100)).toEqual([])
  })

  it('склейка частей возвращает исходный текст ДОСЛОВНО, вместе с абзацами', () => {
    const текст = [
      'Первый абзац про одно.',
      '',
      'Второй абзац про другое, он подлиннее первого.',
      '',
      '- пункт списка',
      '- второй пункт списка'
    ].join('\n')
    const части = splitForTranslate(текст, 40)
    expect(части.length).toBeGreaterThan(1)
    expect(части.join('')).toBe(текст)
  })

  it('режет по границам строк, пока строки помещаются', () => {
    const текст = 'раз раз раз\nдва два два\nтри три три\n'
    const части = splitForTranslate(текст, 12)
    expect(части).toEqual(['раз раз раз\n', 'два два два\n', 'три три три\n'])
  })

  it('слишком длинная строка делится по предложениям', () => {
    const текст = 'Первое предложение. Второе предложение. Третье предложение.'
    const части = splitForTranslate(текст, 25)
    expect(части.join('')).toBe(текст)
    expect(части.every((p) => p.length <= 25)).toBe(true)
  })

  it('одно предложение длиннее лимита режется по пробелам, не разрывая слова', () => {
    const текст = 'слово '.repeat(20).trim()
    const части = splitForTranslate(текст, 20)
    expect(части.join('')).toBe(текст)
    for (const часть of части) {
      expect(часть.length).toBeLessThanOrEqual(20)
      expect(часть.trim().split(' ').every((w) => w === 'слово')).toBe(true)
    }
  })

  it('слово длиннее лимита не зацикливает резку', () => {
    const текст = 'я'.repeat(50)
    const части = splitForTranslate(текст, 10)
    expect(части.join('')).toBe(текст)
    expect(части.length).toBe(5)
  })
})
