import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TranslationStore } from '../src/main/core/translations'

let t: TranslationStore
beforeEach(() => {
  t = new TranslationStore(join(mkdtempSync(join(tmpdir(), 'vf-tr-')), 't.json'))
})

const base = { targetLang: 'en', via: 'popup' as const }

describe('TranslationStore', () => {
  it('add генерирует id/createdAt; list сортирует новые сверху', async () => {
    const a = t.add({ ...base, source: 'привет', result: 'hello' })
    await new Promise((r) => setTimeout(r, 2))
    const b = t.add({ ...base, source: 'пока', result: 'bye' })
    expect(a.id).toBeTruthy()
    expect(a.createdAt).toBeTruthy()
    expect(t.list().map((e) => e.id)).toEqual([b.id, a.id])
  })

  it('поиск по source и result без регистра', () => {
    t.add({ ...base, source: 'Купить молоко', result: 'Buy milk' })
    t.add({ ...base, source: 'позвонить маме', result: 'call mom' })
    expect(t.list('МОЛОКО')).toHaveLength(1)
    expect(t.list('milk')).toHaveLength(1)
    expect(t.list('нет такого')).toHaveLength(0)
  })

  it('list принимает limit', () => {
    for (let i = 0; i < 5; i++) t.add({ ...base, source: `s${i}`, result: `r${i}` })
    expect(t.list(undefined, 2)).toHaveLength(2)
  })

  it('delete удаляет и возвращает запись, повторное удаление -> null', () => {
    const a = t.add({ ...base, source: 'x', result: 'y' })
    const deleted = t.delete(a.id)
    expect(deleted?.id).toBe(a.id)
    expect(t.list()).toHaveLength(0)
    expect(t.delete(a.id)).toBeNull()
  })

  it('clear очищает всё', () => {
    t.add({ ...base, source: 'x', result: 'y' })
    t.add({ ...base, source: 'a', result: 'b' })
    t.clear()
    expect(t.list()).toHaveLength(0)
  })

  it('onChange вызывается при add/delete/clear', () => {
    let n = 0
    t.onChange(() => n++)
    const e = t.add({ ...base, source: 'x', result: 'y' })
    t.delete(e.id)
    t.clear()
    expect(n).toBe(3)
  })

  it('ограничение 500 записей: при переполнении обрезается хвост (самые старые)', () => {
    for (let i = 0; i < 520; i++) t.add({ ...base, source: `s${i}`, result: `r${i}` })
    const all = t.list(undefined, 1000)
    expect(all).toHaveLength(500)
    // 520 добавлений, лимит 500 -> первые 20 (самые старые) вырезаны, s20..s519 остались
    expect(all.some((e) => e.source === 's0')).toBe(false)
    expect(all.some((e) => e.source === 's19')).toBe(false)
    expect(all.some((e) => e.source === 's20')).toBe(true)
    expect(all.some((e) => e.source === 's519')).toBe(true)
  })
})
