import { useState } from 'react'
import type { HotkeyCombo } from '../../../shared/types'
import { vox } from '../api'

/** Метка двойного нажатия: показываем «Ctrl + C ×2», хранит её сам combo.label. */
const DOUBLE_SUFFIX = ' ×2'

export function HotkeyCapture(props: {
  current: HotkeyCombo
  onCaptured: (c: HotkeyCombo) => void
  /** Сочетание срабатывает по двойному нажатию — записывается всё равно одним. */
  doubleTap?: boolean
  /** Вернуть заводское сочетание (если пользователь запутался). */
  onReset?: () => void
}): JSX.Element {
  const [capturing, setCapturing] = useState(false)

  const start = async (): Promise<void> => {
    setCapturing(true)
    const combo = await vox.captureHotkey()
    setCapturing(false)
    if (!combo || combo.keys.length === 0) return
    const label = props.doubleTap
      ? combo.label.replace(DOUBLE_SUFFIX, '') + DOUBLE_SUFFIX
      : combo.label
    props.onCaptured({ keys: combo.keys, label })
  }

  return (
    <div className="inline">
      <button className="btn secondary" onClick={() => void start()} disabled={capturing}>
        {capturing
          ? props.doubleTap
            ? 'Нажмите сочетание ОДИН раз… (Esc — отмена)'
            : 'Нажмите новую комбинацию… (Esc — отмена)'
          : props.current.label || 'Не назначено'}
      </button>
      {props.onReset && (
        <button className="link-btn" onClick={props.onReset}>
          Сбросить
        </button>
      )}
    </div>
  )
}
