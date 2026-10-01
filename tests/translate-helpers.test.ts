import { describe, it, expect } from 'vitest'
import { truncate } from '../src/renderer/src/pages/translateHelpers'

describe('truncate', () => {
  it('короткий текст не меняется', () => {
    expect(truncate('привет', 10)).toBe('привет')
  })
  it('обрезает пробелы по краям у короткого текста', () => {
    expect(truncate('  привет  ', 10)).toBe('привет')
  })
  it('длинный текст обрезается и получает многоточие', () => {
    expect(truncate('a'.repeat(20), 5)).toBe('aaaaa…')
  })
  it('обрезает висящий пробел перед многоточием', () => {
    expect(truncate('hello world foo', 11)).toBe('hello world…')
  })
  it('текст ровно по границе не обрезается', () => {
    expect(truncate('12345', 5)).toBe('12345')
  })
})
