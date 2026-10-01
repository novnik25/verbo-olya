import { describe, it, expect } from 'vitest'
import { scaleRect } from '../src/shared/region'

describe('пересчёт области под масштаб снимка', () => {
  const обл = { x: 100, y: 50, width: 300, height: 200 }

  it('масштаб 1 к 1 ничего не меняет', () => {
    expect(scaleRect(обл, 1)).toEqual(обл)
  })

  it('снимок вдвое крупнее экрана — область тоже вдвое', () => {
    expect(scaleRect(обл, 2)).toEqual({ x: 200, y: 100, width: 600, height: 400 })
  })

  it('дробный масштаб округляется', () => {
    // 110% — реальный случай: снимок в физических пикселях, выделение в логических
    expect(scaleRect({ x: 10, y: 10, width: 100, height: 100 }, 1.1)).toEqual({
      x: 11,
      y: 11,
      width: 110,
      height: 110
    })
  })

  it('нулевая ширина превращается в один пиксель, а не в отказ обрезки', () => {
    const r = scaleRect({ x: 0, y: 0, width: 0, height: 0 }, 1)
    expect(r.width).toBe(1)
    expect(r.height).toBe(1)
  })

  it('крошечное выделение при уменьшении не схлопывается в ноль', () => {
    const r = scaleRect({ x: 0, y: 0, width: 2, height: 2 }, 0.1)
    expect(r.width).toBeGreaterThanOrEqual(1)
    expect(r.height).toBeGreaterThanOrEqual(1)
  })
})
import { rectFrom } from '../src/shared/region'

describe('rectFrom', () => {
  it('строит прямоугольник при протяжке вправо-вниз', () => {
    expect(rectFrom({ x: 10, y: 20 }, { x: 110, y: 70 })).toEqual({ x: 10, y: 20, width: 100, height: 50 })
  })

  it('работает при протяжке в обратную сторону', () => {
    expect(rectFrom({ x: 110, y: 70 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 100, height: 50 })
  })

  it('округляет дробные координаты', () => {
    expect(rectFrom({ x: 10.4, y: 20.6 }, { x: 30.5, y: 41.2 })).toEqual({
      x: 10, y: 21, width: 20, height: 21
    })
  })
})
