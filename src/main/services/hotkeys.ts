import { uIOhook, UiohookKey } from 'uiohook-napi'
import { DoubleTapTracker, HoldTracker, normalizeKey } from '../core/hotkeys-logic'
import type { HotkeyCombo } from '../../shared/types'

const ESC = 1

const CODE_TO_NAME: Record<number, string> = {}
for (const [name, code] of Object.entries(UiohookKey)) {
  if (typeof code === 'number' && CODE_TO_NAME[code] === undefined) CODE_TO_NAME[code] = name
}
const NICE_NAMES: Record<string, string> = {
  Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Win',
  Space: 'Пробел', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', CapsLock: 'CapsLock'
}
const MODIFIERS = new Set([29, 42, 56, 3675])

export function labelForKeys(keys: number[]): string {
  const norm = [...new Set(keys.map(normalizeKey))]
  norm.sort((a, b) => Number(MODIFIERS.has(b)) - Number(MODIFIERS.has(a)))
  return norm
    .map((k) => {
      const raw = CODE_TO_NAME[k] ?? `K${k}`
      return NICE_NAMES[raw] ?? raw
    })
    .join(' + ')
}

export class HotkeyService {
  private tracker: HoldTracker
  private doubleTaps: DoubleTapTracker[] = []
  private paused = false
  private suppressUntil = 0
  /** Физически зажатые клавиши — чтобы дождаться их отпускания перед своим Ctrl+C. */
  private pressedNow = new Set<number>()
  // слушатели вешаем ровно один раз (uIOhook — глобальный EventEmitter),
  // а сам хук можно останавливать и запускать заново
  private listenersAttached = false
  private started = false
  private watchdog: ReturnType<typeof setInterval> | null = null
  private capturing: {
    pressed: Set<number>
    resolve: (c: HotkeyCombo | null) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

  constructor(private cb: { onStart(): void; onStop(): void; onEsc(): void }) {
    this.tracker = new HoldTracker({ onStart: cb.onStart, onStop: cb.onStop })
  }

  applySettings(s: { hotkey: HotkeyCombo; recordMode: 'hold' | 'toggle' }): void {
    this.tracker.setCombo(s.hotkey.keys)
    this.tracker.setMode(s.recordMode)
    this.tracker.reset()
  }

  setPaused(v: boolean): void {
    this.paused = v
    this.tracker.reset()
    for (const dt of this.doubleTaps) dt.reset()
  }

  /** Двойные нажатия (например «Ctrl+V ×2» для мгновенного перевода). */
  setDoubleTaps(taps: Array<{ keys: number[]; onTap: () => void }>): void {
    this.doubleTaps = taps.map((t) => new DoubleTapTracker(t.keys, t.onTap))
  }

  capture(): Promise<HotkeyCombo | null> {
    this.tracker.reset()
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finishCapture(null), 10_000)
      this.capturing = { pressed: new Set(), resolve, timer }
    })
  }

  private finishCapture(combo: HotkeyCombo | null): void {
    if (!this.capturing) return
    clearTimeout(this.capturing.timer)
    this.capturing.resolve(combo)
    this.capturing = null
  }

  start(): void {
    if (!this.listenersAttached) {
      this.listenersAttached = true
      this.attachListeners()
    }
    if (this.started) return
    this.started = true
    uIOhook.start()
    // сторож потерянных keyup: без него зажатая «по мнению приложения» клавиша
    // держала запись бесконечно (капсула висела, хотя пользователь ничего не говорил)
    if (!this.watchdog) {
      this.watchdog = setInterval(() => this.tracker.syncPhysical(this.pressedNow), 400)
    }
  }

  private attachListeners(): void {
    uIOhook.on('keydown', (e) => {
      if (this.capturing) {
        if (e.keycode === ESC) return this.finishCapture(null)
        this.capturing.pressed.add(normalizeKey(e.keycode))
        return
      }
      // Esc закрывает не только запись (отмена по держанию), но и всплывающие панели
      // (например, панель перевода) — решает вызывающая сторона.
      if (e.keycode === ESC) return this.cb.onEsc()
      this.pressedNow.add(normalizeKey(e.keycode))
      if (!this.paused && !this.suppressed()) {
        this.tracker.keyDown(e.keycode)
        for (const dt of this.doubleTaps) dt.keyDown(e.keycode)
      }
    })
    uIOhook.on('keyup', (e) => {
      if (this.capturing) {
        const keys = [...this.capturing.pressed]
        if (keys.length > 0) this.finishCapture({ keys, label: labelForKeys(keys) })
        return
      }
      this.pressedNow.delete(normalizeKey(e.keycode))
      if (!this.paused && !this.suppressed()) {
        this.tracker.keyUp(e.keycode)
        for (const dt of this.doubleTaps) dt.keyUp(e.keycode)
      }
    })
  }

  /**
   * Глушит обработку событий на время: программа сама отправляет Ctrl+C/Ctrl+V,
   * и без этого её собственные нажатия снова запускали бы озвучку/перевод
   * (бесконечный круг, мерцание панели и подтормаживание ввода).
   */
  suppress(ms: number): void {
    this.suppressUntil = Date.now() + ms
    this.tracker.reset()
    for (const dt of this.doubleTaps) dt.reset()
  }

  private suppressed(): boolean {
    return Date.now() < this.suppressUntil
  }

  /** Ждёт, пока пользователь отпустит клавиши: иначе синтетический Ctrl+C ломается о зажатый Ctrl. */
  async waitKeysReleased(timeoutMs = 700): Promise<void> {
    const step = 30
    for (let waited = 0; waited < timeoutMs; waited += step) {
      if (this.pressedNow.size === 0) return
      await new Promise((r) => setTimeout(r, step))
    }
  }

  stop(): void {
    this.started = false
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    uIOhook.stop()
  }
}
