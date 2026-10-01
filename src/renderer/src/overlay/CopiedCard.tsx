import { hot } from './api'
import { IconClose, IconCheck, IconCopy } from './icons'

/**
 * Карточка «вставить было некуда»: показывается, когда фокус оказался вне поля
 * ввода. Текст при этом уже лежит в буфере обмена — карточка лишь показывает его
 * и даёт скопировать ещё раз.
 */
export function CopiedCard(props: {
  text: string
  toast: string | null
  onClose: () => void
  onCopy: () => void
}): JSX.Element {
  return (
    <div className="dock">
      <div className="card" {...hot}>
        <div className="card-head">
          <span className="card-title">Курсор вне поля ввода</span>
          <button className="icon-btn" aria-label="Закрыть" onClick={props.onClose}>
            <IconClose />
          </button>
        </div>
        <div className="card-text">
          {props.text.length > 400 ? props.text.slice(0, 400) + '…' : props.text}
        </div>
        <div className="card-foot">
          <span className="card-hint">Текст сохранён в буфере обмена</span>
          <button className="btn" onClick={props.onCopy}>
            {props.toast === 'Скопировано' ? <IconCheck /> : <IconCopy />}
            <span>Копировать</span>
          </button>
        </div>
      </div>
    </div>
  )
}
