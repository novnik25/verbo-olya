import { describe, it, expect } from 'vitest'
import { SPEED_STEPS, snapRate, rateLabel } from '../src/shared/speech-rate'

describe('шкала темпа речи одна на всё приложение', () => {
  it('значения шкалы идут по возрастанию и включают обычный темп', () => {
    const v = SPEED_STEPS.map((s) => s.value)
    expect(v).toEqual([...v].sort((a, b) => a - b))
    expect(v).toContain(0)
  })

  it('у каждого шага есть подпись-множитель', () => {
    for (const s of SPEED_STEPS) expect(s.label).toMatch(/×/)
  })
})

describe('приведение сохранённого темпа к шкале', () => {
  it('значение из шкалы остаётся как есть', () => {
    for (const s of SPEED_STEPS) expect(snapRate(s.value)).toBe(s.value)
  })

  it('старые значения из настроек подтягиваются к ближайшему шагу', () => {
    // раздел настроек раньше предлагал свою шкалу: −20, 0, 20, 40
    expect(snapRate(-20)).toBe(-25)
    expect(snapRate(20)).toBe(25)
    expect(snapRate(40)).toBe(50)
  })

  it('значение за пределами шкалы прижимается к краю', () => {
    expect(snapRate(-999)).toBe(SPEED_STEPS[0].value)
    expect(snapRate(999)).toBe(SPEED_STEPS[SPEED_STEPS.length - 1].value)
  })

  it('мусор вместо числа даёт обычный темп, а не поломку', () => {
    expect(snapRate(Number.NaN)).toBe(0)
    expect(snapRate(undefined as unknown as number)).toBe(0)
  })

  it('ровно посередине между шагами берётся меньший — чтобы не ускорять без спроса', () => {
    // между 0 и 25 середина 12.5
    expect(snapRate(12.5)).toBe(0)
  })

  it('подпись находится по значению', () => {
    expect(rateLabel(0)).toBe('1×')
    expect(rateLabel(25)).toBe('1,25×')
  })
})
