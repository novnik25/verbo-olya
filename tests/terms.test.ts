import { describe, it, expect } from 'vitest'
import { extractTerms } from '../src/main/core/terms'

describe('extractTerms', () => {
  it('латинские названия (частота ≥ 2) попадают в список, сохраняя написание первого вхождения', () => {
    const texts = ['Я использую Ozon для покупок.', 'Ozon доставляет быстро.']
    expect(extractTerms(texts)).toContain('Ozon')
  })

  it('слова с цифрой и буквой считаются терминами', () => {
    const texts = ['Использую GPT4 каждый день.', 'GPT4 отвечает быстро сегодня.']
    expect(extractTerms(texts)).toContain('GPT4')
  })

  it('русское Имя с большой буквы в середине предложения — термин; в начале предложения — нет', () => {
    const text =
      'Ко мне вчера заходил Максим, и мы поговорили. Потом опять пришёл Максим с новыми идеями.'
    const terms = extractTerms([text])
    expect(terms).toContain('Максим')
    expect(terms).not.toContain('Ко') // первое слово текста — не термин, даже с большой буквы
    expect(terms).not.toContain('Потом') // начало предложения после точки — не термин
  })

  it('частые английские стоп-слова не считаются терминами, даже при частоте ≥ 2', () => {
    const texts = ['Мы обсуждали this and that вчера.', 'Потом снова this and that.']
    const terms = extractTerms(texts)
    expect(terms).not.toContain('this')
    expect(terms).not.toContain('and')
    expect(terms).not.toContain('that')
  })

  it('термин с частотой 1 отсекается', () => {
    const terms = extractTerms(['Установил Anthropic один раз и больше не упоминал.'])
    expect(terms).not.toContain('Anthropic')
  })

  it('уважает limit и сортирует по убыванию частоты, потом по алфавиту', () => {
    // Alpha встречается 3 раза, Beta и Gamma — по 2
    const texts = [
      'Alpha Beta Gamma встретились сегодня.',
      'Alpha Beta Gamma снова были на месте.',
      'Alpha пришёл ещё раз.'
    ]
    const all = extractTerms(texts) // лимит по умолчанию — 15, кандидатов всего 3
    expect(all).toEqual(['Alpha', 'Beta', 'Gamma'])

    const limited = extractTerms(texts, 2)
    expect(limited).toEqual(['Alpha', 'Beta'])
    expect(limited).toHaveLength(2)
  })
})
