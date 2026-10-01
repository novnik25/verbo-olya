const RIGHT_TO_LEFT: Record<number, number> = {
  3613: 29,   // CtrlRight -> Ctrl
  54: 42,     // ShiftRight -> Shift
  3640: 56,   // AltRight -> Alt
  3676: 3675  // MetaRight -> Meta
}

export function normalizeKey(code: number): number {
  return RIGHT_TO_LEFT[code] ?? code
}

export interface HoldTrackerCallbacks {
  onStart(): void
  onStop(): void
}

/** Отслеживает зажатие комбинации по потоку keydown/keyup. Чистая логика, без uiohook. */
export class HoldTracker {
  private combo = new Set<number>()
  private pressed = new Set<number>()
  private mode: 'hold' | 'toggle' = 'hold'
  private isActive = false
  private comboWasDown = false // для toggle: ловим фронт нажатия

  constructor(private cb: HoldTrackerCallbacks) {}

  get active(): boolean {
    return this.isActive
  }

  setCombo(keys: number[]): void {
    this.combo = new Set(keys.map(normalizeKey))
  }

  setMode(mode: 'hold' | 'toggle'): void {
    this.mode = mode
  }

  private comboDown(): boolean {
    return this.combo.size > 0 && [...this.combo].every((k) => this.pressed.has(k))
  }

  keyDown(code: number): void {
    this.pressed.add(normalizeKey(code))
    const down = this.comboDown()
    if (this.mode === 'hold') {
      if (down && !this.isActive) {
        this.isActive = true
        this.cb.onStart()
      }
    } else {
      if (down && !this.comboWasDown) {
        this.comboWasDown = true
        this.isActive = !this.isActive
        if (this.isActive) this.cb.onStart()
        else this.cb.onStop()
      }
    }
  }

  /**
   * Страховка от потерянного keyup: если клавиши комбинации физически уже
   * отпущены (их нет в наборе, который ведёт HotkeyService), а запись всё ещё
   * идёт — завершаем её. Иначе капсула висела «как будто идёт запись».
   */
  syncPhysical(pressedNow: Set<number>): void {
    if (this.mode !== 'hold' || !this.isActive) return
    const stillDown = [...this.combo].every((k) => pressedNow.has(k))
    if (stillDown) return
    this.pressed.clear()
    this.isActive = false
    this.cb.onStop()
  }

  keyUp(code: number): void {
    const norm = normalizeKey(code)
    this.pressed.delete(norm)
    if (!this.comboDown()) this.comboWasDown = false
    if (this.mode === 'hold' && this.isActive && this.combo.has(norm)) {
      this.isActive = false
      this.cb.onStop()
    }
  }

  reset(): void {
    if (this.isActive) {
      this.isActive = false
      this.cb.onStop()
    }
    this.pressed.clear()
    this.comboWasDown = false
  }
}

// окно для второго нажатия: 600 мс оказалось тесновато при спокойном темпе
const DOUBLE_TAP_WINDOW_MS = 850

/**
 * Отслеживает двойное нажатие одной и той же комбинации клавиш подряд
 * («нажал → отпустил → снова нажал») в пределах DOUBLE_TAP_WINDOW_MS.
 * Чистая логика, без uiohook.
 */
export class DoubleTapTracker {
  private combo: Set<number>
  private pressed = new Set<number>()
  private comboWasDown = false
  private armed = false // первый тап уже случился, ждём второго в пределах окна
  private armedAt = 0
  private now: () => number

  constructor(combo: number[], private onDoubleTap: () => void, now?: () => number) {
    this.combo = new Set(combo.map(normalizeKey))
    this.now = now ?? (() => Date.now())
  }

  private comboDown(): boolean {
    return this.combo.size > 0 && [...this.combo].every((k) => this.pressed.has(k))
  }

  keyDown(code: number): void {
    this.pressed.add(normalizeKey(code))
    const down = this.comboDown()
    if (down && !this.comboWasDown) {
      this.comboWasDown = true
      if (this.armed && this.now() - this.armedAt <= DOUBLE_TAP_WINDOW_MS) {
        this.armed = false
        this.onDoubleTap()
      } else {
        this.armed = false
      }
    }
  }

  keyUp(code: number): void {
    const norm = normalizeKey(code)
    this.pressed.delete(norm)
    if (!this.comboDown() && this.comboWasDown) {
      this.comboWasDown = false
      if (!this.armed) {
        this.armed = true
        this.armedAt = this.now()
      }
    }
  }

  reset(): void {
    this.pressed.clear()
    this.comboWasDown = false
    this.armed = false
  }
}
