import { describe, it, expect } from 'vitest'
import { cleanApiKey, inspectApiKey } from '../src/main/core/api-key'

describe('cleanApiKey: мусор, приезжающий вместе со вставкой', () => {
  it('пробелы и перевод строки по краям снимаются', () => {
    expect(cleanApiKey('  gsk_ABC123\n')).toBe('gsk_ABC123')
  })

  it('неразрывный пробел по краям тоже снимается', () => {
    expect(cleanApiKey('\u00A0gsk_ABC123\u00A0')).toBe('gsk_ABC123')
  })

  it('знак нулевой ширины вырезается — его не видно, но заголовок он ломает', () => {
    expect(cleanApiKey('gsk_ABC\u200B123')).toBe('gsk_ABC123')
  })

  it('метка порядка байтов в начале вырезается', () => {
    expect(cleanApiKey('\uFEFFgsk_ABC123')).toBe('gsk_ABC123')
  })

  it('кавычки от копирования из кода снимаются', () => {
    expect(cleanApiKey('"gsk_ABC123"')).toBe('gsk_ABC123')
    expect(cleanApiKey("'gsk_ABC123'")).toBe('gsk_ABC123')
    expect(cleanApiKey('«gsk_ABC123»')).toBe('gsk_ABC123')
  })

  it('приставка Bearer из примеров запросов снимается', () => {
    expect(cleanApiKey('Bearer gsk_ABC123')).toBe('gsk_ABC123')
    expect(cleanApiKey('bearer   gsk_ABC123')).toBe('gsk_ABC123')
  })

  it('кавычки и Bearer вместе — снимаются оба слоя', () => {
    expect(cleanApiKey('  "Bearer gsk_ABC123"  ')).toBe('gsk_ABC123')
  })

  it('сам ключ не трогаем: подчёркивания и регистр на месте', () => {
    expect(cleanApiKey('gsk_Ab_12-XY')).toBe('gsk_Ab_12-XY')
  })
})

describe('inspectApiKey: что не так с ключом до обращения к сервису', () => {
  it('чистый ключ годится', () => {
    expect(inspectApiKey(' gsk_ABC123 ')).toEqual({ key: 'gsk_ABC123', shape: 'ok' })
  })

  it('пустое поле — пустое, а не «сервис не принял»', () => {
    expect(inspectApiKey('   ').shape).toBe('empty')
  })

  it('кириллическая «с» вместо латинской видна сразу', () => {
    expect(inspectApiKey('gsk_ABс123').shape).toBe('foreign-chars')
  })

  it('пробел внутри ключа — тоже посторонний знак', () => {
    expect(inspectApiKey('gsk_ABC 123').shape).toBe('foreign-chars')
  })
})
