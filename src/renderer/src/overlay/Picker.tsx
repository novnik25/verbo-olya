import { useState } from 'react'
import { IconChevron, IconCheck } from './icons'

/** Выбор из списка в стиле панели: системный <select> открывает белое меню Windows. */
export function Picker(props: {
  value: string
  options: Array<{ code: string; label: string }>
  onPick: (code: string) => void
  label: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const current = props.options.find((o) => o.code === props.value)
  return (
    <div className="picker">
      <button
        className="picker-value"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.label}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current?.label ?? props.value}</span>
        <IconChevron open={open} />
      </button>
      {open && (
        <div className="picker-list" role="listbox">
          {props.options.map((o) => (
            <button
              key={o.code}
              role="option"
              aria-selected={o.code === props.value}
              className={`menu-item ${o.code === props.value ? 'on' : ''}`}
              onClick={() => {
                setOpen(false)
                props.onPick(o.code)
              }}
            >
              <span className="menu-item-label">{o.label}</span>
              {o.code === props.value && <IconCheck />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
