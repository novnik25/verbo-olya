import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HistoryService, countWords, countChangedWords } from '../src/main/core/history'

let h: HistoryService
beforeEach(() => {
  h = new HistoryService(join(mkdtempSync(join(tmpdir(), 'vf-')), 'h.json'))
})

const base = { durationMs: 60_000, status: 'done' as const, styleId: 'raw', attempts: 0 }

describe('countWords', () => {
  it('считает слова', () => {
    expect(countWords('привет,  мир — hello')).toBe(3)
    expect(countWords('')).toBe(0)
  })
})

describe('countChangedWords', () => {
  it('идентичные тексты -> 0', () => {
    expect(countChangedWords('купить молоко', 'купить молоко')).toBe(0)
  })
  it('только пунктуация/регистр/удаление слова-паразита -> 0 или мало', () => {
    expect(countChangedWords('ну купить молоко', 'Купить молоко.')).toBe(0)
  })
  it('вставка нового слова -> считается', () => {
    expect(countChangedWords('купить молоко', 'нужно купить молоко')).toBe(1)
  })
})

describe('HistoryService', () => {
  it('add генерирует id/createdAt/wordCount; list сортирует новые сверху', () => {
    const a = h.add({ ...base, styledText: 'раз два' })
    const b = h.add({ ...base, styledText: 'три', createdAt: new Date(Date.now() + 1000).toISOString() })
    expect(a.wordCount).toBe(2)
    expect(h.list().map((e) => e.id)).toEqual([b.id, a.id])
  })
  it('поиск по тексту без регистра', () => {
    h.add({ ...base, styledText: 'Купить молоко' })
    h.add({ ...base, styledText: 'позвонить маме' })
    expect(h.list('МОЛОКО')).toHaveLength(1)
  })
  it('update патчит и пересчитывает wordCount', () => {
    const e = h.add({ ...base, status: 'pending' })
    h.update(e.id, { status: 'done', styledText: 'один два три' })
    expect(h.list()[0].wordCount).toBe(3)
  })
  it('pending возвращает только pending', () => {
    h.add({ ...base, status: 'pending' })
    h.add({ ...base })
    expect(h.pending()).toHaveLength(1)
  })
  it('stats: слова, wpm, streak за сегодня и вчера', () => {
    const now = new Date('2026-08-05T12:00:00')
    const day = (offset: number, text: string) =>
      h.add({ ...base, styledText: text, createdAt: new Date(now.getTime() - offset * 86_400_000).toISOString() })
    day(0, 'раз два три четыре') // 4 слова за 1 минуту
    day(1, 'пять шесть')
    day(3, 'семь')
    const s = h.stats(now)
    expect(s.totalWords).toBe(7)
    expect(s.wpm).toBeCloseTo(7 / 3, 1)
    expect(s.streakDays).toBe(2) // сегодня + вчера; разрыв на -2 днях
  })
  it('onChange вызывается при add/update/delete', () => {
    let n = 0
    h.onChange(() => n++)
    const e = h.add({ ...base })
    h.update(e.id, { status: 'failed' })
    h.delete(e.id)
    expect(n).toBe(3)
  })
  it('longestStreak учитывает самую длинную серию за всю историю, даже с разрывом', () => {
    const now = new Date('2026-08-05T12:00:00')
    const day = (offset: number) =>
      h.add({ ...base, styledText: 'слово', createdAt: new Date(now.getTime() - offset * 86_400_000).toISOString() })
    day(10); day(9); day(8) // серия из 3 дней в прошлом
    day(1); day(0) // текущая серия из 2 дней (вчера + сегодня)
    const s = h.stats(now)
    expect(s.streakDays).toBe(2)
    expect(s.longestStreak).toBe(3)
  })
  it('byDay: ровно 140 дней подряд, последний элемент — сегодня', () => {
    const now = new Date('2026-08-05T12:00:00')
    const ymd = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    h.add({ ...base, styledText: 'раз два', createdAt: now.toISOString() })
    const s = h.stats(now)
    expect(s.byDay).toHaveLength(140)
    expect(s.byDay[139].date).toBe(ymd(now))
    expect(s.byDay[139].words).toBe(2)
    expect(s.byDay[0].date).toBe(ymd(new Date(now.getTime() - 139 * 86_400_000)))
    expect(s.byDay[0].words).toBe(0)
  })
  it('тренд words30/wordsPrev30: записи на -5 и -40 дней', () => {
    const now = new Date('2026-08-05T12:00:00')
    const day = (offset: number, text: string) =>
      h.add({ ...base, styledText: text, createdAt: new Date(now.getTime() - offset * 86_400_000).toISOString() })
    day(5, 'раз два три') // в пределах последних 30 дней
    day(40, 'четыре пять') // в предыдущих 30 (31-60 дней назад)
    const s = h.stats(now)
    expect(s.words30).toBe(3)
    expect(s.wordsPrev30).toBe(2)
  })
  it('styleBreakdown: количество диктовок по стилю, отсортировано по убыванию', () => {
    h.add({ ...base, styleId: 'clean', styledText: 'а' })
    h.add({ ...base, styleId: 'clean', styledText: 'б' })
    h.add({ ...base, styleId: 'business', styledText: 'в' })
    h.add({ ...base, styleId: 'raw', styledText: 'г' })
    h.add({ ...base, styleId: 'raw', styledText: 'д' })
    h.add({ ...base, styleId: 'raw', styledText: 'е' })
    const s = h.stats()
    expect(s.styleBreakdown).toEqual([
      { styleId: 'raw', count: 3 },
      { styleId: 'clean', count: 2 },
      { styleId: 'business', count: 1 }
    ])
    expect(s.totalEntries).toBe(6)
    expect(s.totalDurationMs).toBe(6 * 60_000)
  })
  it('fixedWords суммирует countChangedWords по записям, где есть оба текста и они различаются', () => {
    h.add({ ...base, rawText: 'ну купить молоко', styledText: 'Купить молоко.' }) // 0 изменений
    h.add({ ...base, rawText: 'купить хлеб', styledText: 'нужно купить хлеб' }) // 1 изменение
    h.add({ ...base, styledText: 'просто текст' }) // rawText отсутствует — не считается
    const s = h.stats()
    expect(s.fixedWords).toBe(1)
  })
  it('stats() возвращает пустой topTerms — его заполняет вызывающий', () => {
    h.add({ ...base, styledText: 'слово' })
    expect(h.stats().topTerms).toEqual([])
  })
})
