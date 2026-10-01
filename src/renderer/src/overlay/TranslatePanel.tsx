import { TRANSLATE_LANGS } from '../../../shared/lang'
import { api, hot } from './api'
import { Picker } from './Picker'
import { IconClose, IconCheck, IconCopy, IconSpeaker } from './icons'

/** Панель мгновенного перевода выделенного текста (Ctrl+V ×2). */
export function TranslatePanel(props: {
  target: string
  result: string
  loading: boolean
  error?: string
  toast: string | null
  onClose: () => void
  onCopy: () => void
}): JSX.Element {
  const занято = props.loading || !!props.error || !props.result
  return (
    <div className="dock">
      <div className="card" {...hot}>
        <div className="card-head">
          <Picker
            label="Язык перевода"
            value={props.target}
            options={TRANSLATE_LANGS}
            onPick={(code) => void api.translateRetarget(code)}
          />
          <button className="icon-btn" aria-label="Закрыть" onClick={props.onClose}>
            <IconClose />
          </button>
        </div>
        <div className="card-body">
          {props.loading && <div className="skeleton">Выполняется перевод…</div>}
          {!props.loading && props.error && <div className="card-error">{props.error}</div>}
          {!props.loading && !props.error && <div className="card-result">{props.result}</div>}
        </div>
        <div className="card-foot">
          <span className="card-hint">{props.loading || props.error ? '' : 'Esc — закрыть'}</span>
          <div className="actions">
            <button className="btn ghost" disabled={занято} onClick={props.onCopy}>
              {props.toast === 'Скопировано' ? <IconCheck /> : <IconCopy />}
              <span>Копировать</span>
            </button>
            <button
              className="btn ghost"
              disabled={занято}
              onClick={() => void api.speakText(props.result)}
            >
              <IconSpeaker />
              <span>Прослушать</span>
            </button>
            <button className="btn" disabled={занято} onClick={() => void api.translateReplace()}>
              Заменить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
