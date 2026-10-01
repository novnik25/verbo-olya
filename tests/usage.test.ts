import { describe, it, expect } from 'vitest'
import { spokenChars } from '../src/main/core/usage'

describe('сколько знаков реально прочитано', () => {
  const фрагменты = ['Первый кусок.', 'Второй.', 'Третий кусок подлиннее.']

  it('чтение оборвали до первого фрагмента — не засчитываем ничего', () => {
    expect(spokenChars(фрагменты, 0)).toBe(0)
  })

  it('дочитали до конца — засчитываем всё', () => {
    expect(spokenChars(фрагменты, 3)).toBe(фрагменты.join('').length)
  })

  it('«Стоп» после первого фрагмента — засчитываем только его', () => {
    expect(spokenChars(фрагменты, 1)).toBe('Первый кусок.'.length)
  })

  it('счётчик не может уйти дальше конца списка', () => {
    expect(spokenChars(фрагменты, 99)).toBe(фрагменты.join('').length)
  })

  it('отрицательное значение не ломает счёт', () => {
    expect(spokenChars(фрагменты, -1)).toBe(0)
  })
})

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { UsageStore, emptyBucket, localDayKey, summarize, trimDays } from '../src/main/core/usage'

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'voxflow-usage-')), 'usage.json')
}

describe('trimDays', () => {
  it('оставляет только последние даты', () => {
    const byDay: Record<string, number> = {
      '2026-01-01': 1,
      '2026-01-02': 2,
      '2026-01-03': 3
    }
    expect(trimDays(byDay, 2)).toEqual({ '2026-01-02': 2, '2026-01-03': 3 })
  })

  it('короткий список не трогает', () => {
    const byDay = { '2026-01-01': 1 }
    expect(trimDays(byDay, 5)).toBe(byDay)
  })
})

describe('summarize', () => {
  const now = new Date(2026, 0, 31)
  it('считает всего, за 30 дней и активные дни', () => {
    const bucket = {
      total: 10,
      chars: 4500,
      byKey: { en: 6, de: 3, fr: 1 },
      byDay: { [localDayKey(now)]: 4, '2026-01-20': 5, '2025-11-01': 1 }
    }
    const s = summarize(bucket, now)
    expect(s.total).toBe(10)
    expect(s.chars).toBe(4500)
    expect(s.last30).toBe(9) // старая запись из ноября не попадает
    expect(s.activeDays).toBe(3)
    expect(s.top[0]).toEqual({ key: 'en', count: 6 })
    expect(s.minutes).toBe(5) // 4500 знаков ≈ 5 минут чтения
  })

  it('пустой раздел не падает', () => {
    const s = summarize(emptyBucket(), now)
    expect(s).toMatchObject({ total: 0, chars: 0, last30: 0, activeDays: 0, top: [] })
  })
})

describe('UsageStore', () => {
  it('накапливает события по разделам и не смешивает их', () => {
    const file = tmpFile()
    try {
      const store = new UsageStore(file)
      const now = new Date(2026, 5, 10)
      store.record('translate', { key: 'en', chars: 100 }, now)
      store.record('translate', { key: 'en', chars: 50 }, now)
      store.record('speak', { key: 'ru-RU-SvetlanaNeural', chars: 900 }, now)

      const data = store.data()
      expect(data.translate.total).toBe(2)
      expect(data.translate.chars).toBe(150)
      expect(data.translate.byKey).toEqual({ en: 2 })
      expect(data.translate.byDay[localDayKey(now)]).toBe(2)
      expect(data.speak.total).toBe(1)
      expect(data.speak.chars).toBe(900)
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('переживает перезапуск: данные читаются из файла', () => {
    const file = tmpFile()
    try {
      new UsageStore(file).record('speak', { key: 'ru-RU-DmitryNeural', chars: 10 })
      const again = new UsageStore(file)
      expect(again.stats().speak.total).toBe(1)
      expect(again.stats().translate.total).toBe(0)
    } finally {
      rmSync(file, { force: true })
    }
  })
})
