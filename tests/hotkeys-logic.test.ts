import { describe, it, expect, beforeEach } from 'vitest'
import { DoubleTapTracker, HoldTracker, normalizeKey } from '../src/main/core/hotkeys-logic'

// uiohook-коды: Ctrl=29, CtrlRight=3613, Meta=3675, MetaRight=3676, Alt=56, AltRight=3640
describe('normalizeKey', () => {
  it('правые модификаторы -> левые', () => {
    expect(normalizeKey(3613)).toBe(29)
    expect(normalizeKey(3676)).toBe(3675)
    expect(normalizeKey(3640)).toBe(56)
    expect(normalizeKey(54)).toBe(42)
    expect(normalizeKey(30)).toBe(30) // обычная клавиша не меняется
  })
})

let events: string[]
let t: HoldTracker
beforeEach(() => {
  events = []
  t = new HoldTracker({ onStart: () => events.push('start'), onStop: () => events.push('stop') })
  t.setCombo([29, 3675]) // Ctrl + Win
})

describe('HoldTracker (hold)', () => {
  it('старт при полном комбо, стоп при отпускании любой клавиши комбо', () => {
    t.keyDown(29)
    expect(events).toEqual([])
    t.keyDown(3675)
    expect(events).toEqual(['start'])
    t.keyUp(29)
    expect(events).toEqual(['start', 'stop'])
  })
  it('правый Ctrl работает как левый', () => {
    t.keyDown(3613); t.keyDown(3676)
    expect(events).toEqual(['start'])
  })
  it('повторные keydown (автоповтор Windows) не дают второй start', () => {
    t.keyDown(29); t.keyDown(3675); t.keyDown(3675)
    expect(events).toEqual(['start'])
  })
  it('посторонняя клавиша не мешает', () => {
    t.keyDown(29); t.keyDown(30); t.keyDown(3675)
    expect(events).toEqual(['start'])
    t.keyUp(30)
    expect(events).toEqual(['start'])
  })
})

describe('HoldTracker (toggle)', () => {
  it('первое нажатие комбо — старт, второе — стоп', () => {
    t.setMode('toggle')
    t.keyDown(29); t.keyDown(3675)
    t.keyUp(29); t.keyUp(3675)
    expect(events).toEqual(['start'])
    t.keyDown(29); t.keyDown(3675)
    expect(events).toEqual(['start', 'stop'])
  })
})

describe('reset', () => {
  it('reset во время записи вызывает stop и чистит состояние', () => {
    t.keyDown(29); t.keyDown(3675)
    t.reset()
    expect(events).toEqual(['start', 'stop'])
    expect(t.active).toBe(false)
  })
})

describe('DoubleTapTracker', () => {
  let clock: number
  let taps: number
  let dt: DoubleTapTracker
  const now = () => clock

  beforeEach(() => {
    clock = 0
    taps = 0
    dt = new DoubleTapTracker([29, 47], () => { taps++ }, now)
  })

  it('двойное нажатие в окне -> срабатывает', () => {
    dt.keyDown(29); dt.keyDown(47)
    dt.keyUp(29); dt.keyUp(47)
    clock += 200
    dt.keyDown(29); dt.keyDown(47)
    expect(taps).toBe(1)
  })

  it('медленное (1000 мс) -> не срабатывает', () => {
    dt.keyDown(29); dt.keyDown(47)
    dt.keyUp(29); dt.keyUp(47)
    clock += 1000
    dt.keyDown(29); dt.keyDown(47)
    expect(taps).toBe(0)
  })

  it('одиночное нажатие -> не срабатывает', () => {
    dt.keyDown(29); dt.keyDown(47)
    dt.keyUp(29); dt.keyUp(47)
    expect(taps).toBe(0)
  })

  it('посторонние клавиши не мешают', () => {
    dt.keyDown(29); dt.keyDown(30); dt.keyDown(47)
    dt.keyUp(30); dt.keyUp(29); dt.keyUp(47)
    clock += 100
    dt.keyDown(30)
    dt.keyDown(29); dt.keyDown(47)
    expect(taps).toBe(1)
  })

  it('правый Ctrl нормализуется как левый', () => {
    dt.keyDown(3613); dt.keyDown(47)
    dt.keyUp(3613); dt.keyUp(47)
    clock += 50
    dt.keyDown(3613); dt.keyDown(47)
    expect(taps).toBe(1)
  })

  it('reset прерывает ожидание второго тапа', () => {
    dt.keyDown(29); dt.keyDown(47)
    dt.keyUp(29); dt.keyUp(47)
    dt.reset()
    clock += 100
    dt.keyDown(29); dt.keyDown(47)
    expect(taps).toBe(0)
  })
})

// speakHotkey (озвучивание, Stage 2): Ctrl+C ×2, C=46 — другая клавиша, чем у перевода (V=47),
// трекер не должен путать их при независимых инстансах.
describe('DoubleTapTracker — комбинация озвучивания Ctrl+C ×2', () => {
  let clock: number
  let taps: number
  let dt: DoubleTapTracker
  const now = () => clock

  beforeEach(() => {
    clock = 0
    taps = 0
    dt = new DoubleTapTracker([29, 46], () => { taps++ }, now)
  })

  it('двойное нажатие Ctrl+C в окне -> срабатывает', () => {
    dt.keyDown(29); dt.keyDown(46)
    dt.keyUp(29); dt.keyUp(46)
    clock += 200
    dt.keyDown(29); dt.keyDown(46)
    expect(taps).toBe(1)
  })

  it('одиночный Ctrl+V (клавиша перевода) не засчитывается как тап Ctrl+C', () => {
    dt.keyDown(29); dt.keyDown(47)
    dt.keyUp(29); dt.keyUp(47)
    clock += 100
    dt.keyDown(29); dt.keyDown(47)
    expect(taps).toBe(0)
  })

  it('медленное повторное нажатие (1000 мс) -> не срабатывает', () => {
    dt.keyDown(29); dt.keyDown(46)
    dt.keyUp(29); dt.keyUp(46)
    clock += 1000
    dt.keyDown(29); dt.keyDown(46)
    expect(taps).toBe(0)
  })
})

describe('HoldTracker.syncPhysical', () => {
  it('завершает запись, если клавиши уже физически отпущены (keyup потерялся)', () => {
    const events: string[] = []
    const t = new HoldTracker({ onStart: () => events.push('start'), onStop: () => events.push('stop') })
    t.setCombo([29, 3675])
    t.keyDown(29)
    t.keyDown(3675)
    expect(events).toEqual(['start'])
    // keyup не пришёл, но физически клавиш уже нет
    t.syncPhysical(new Set())
    expect(events).toEqual(['start', 'stop'])
    expect(t.active).toBe(false)
  })

  it('не трогает запись, пока клавиши действительно зажаты', () => {
    const events: string[] = []
    const t = new HoldTracker({ onStart: () => events.push('start'), onStop: () => events.push('stop') })
    t.setCombo([29, 3675])
    t.keyDown(29)
    t.keyDown(3675)
    t.syncPhysical(new Set([29, 3675]))
    expect(events).toEqual(['start'])
  })

  it('в режиме переключателя сторож молчит', () => {
    const events: string[] = []
    const t = new HoldTracker({ onStart: () => events.push('start'), onStop: () => events.push('stop') })
    t.setMode('toggle')
    t.setCombo([29, 3675])
    t.keyDown(29)
    t.keyDown(3675)
    t.keyUp(29)
    t.syncPhysical(new Set())
    expect(events).toEqual(['start'])
  })
})
