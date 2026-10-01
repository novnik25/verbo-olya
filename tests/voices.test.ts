import { describe, it, expect } from 'vitest'
import { pickVoice, voiceLabel, RU_VOICES, EN_VOICES, VOICES } from '../src/shared/voices'

describe('VOICES', () => {
  it('4 голоса: 2 русских и 2 английских, id уникальны', () => {
    expect(RU_VOICES).toHaveLength(2)
    expect(EN_VOICES).toHaveLength(2)
    expect(VOICES).toHaveLength(4)
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(4)
  })
})

describe('pickVoice', () => {
  it('текст с преобладанием кириллицы -> русский голос', () => {
    expect(pickVoice('Привет, как дела?', 'ru-RU-SvetlanaNeural', 'en-US-AriaNeural')).toBe(
      'ru-RU-SvetlanaNeural'
    )
  })
  it('английский текст -> английский голос', () => {
    expect(pickVoice('Hello, how are you?', 'ru-RU-SvetlanaNeural', 'en-US-AriaNeural')).toBe(
      'en-US-AriaNeural'
    )
  })
  it('доля кириллицы ровно на границе 0.3 не переключает на русский (строгое >)', () => {
    // 3 кириллических буквы + 7 латинских = 10 букв, доля 0.3 -> НЕ больше 0.3 -> английский
    expect(pickVoice('абвabcdefg', 'ru-RU-SvetlanaNeural', 'en-US-AriaNeural')).toBe(
      'en-US-AriaNeural'
    )
  })
  it('чуть больше 0.3 кириллицы -> русский', () => {
    // 4 кириллических буквы + 6 латинских = 10 букв, доля 0.4 > 0.3 -> русский
    expect(pickVoice('абвгabcdef', 'ru-RU-SvetlanaNeural', 'en-US-AriaNeural')).toBe(
      'ru-RU-SvetlanaNeural'
    )
  })
  it('пустой текст (нет букв) -> английский по умолчанию', () => {
    expect(pickVoice('12345', 'ru-RU-SvetlanaNeural', 'en-US-AriaNeural')).toBe('en-US-AriaNeural')
  })
})

describe('voiceLabel', () => {
  it('известный id -> человекочитаемое имя', () => {
    expect(voiceLabel('ru-RU-SvetlanaNeural')).toContain('Светлана')
  })
  it('неизвестный id -> возвращается как есть', () => {
    expect(voiceLabel('xx-Unknown')).toBe('xx-Unknown')
  })
})
