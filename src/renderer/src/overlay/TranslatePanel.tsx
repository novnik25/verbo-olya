import { TRANSLATE_LANGS } from '../../../shared/lang'
import type { OverlayState } from '../../../shared/types'
import { PhoneticText } from '../components/PhoneticText'
import { api, hot } from './api'
import { Picker } from './Picker'
import { IconClose, IconCheck, IconCopy, IconSpeaker } from './icons'

type TranslateView = Extract<OverlayState, { phase: 'translate' }>

const langName = (code: string): string => TRANSLATE_LANGS.find((l) => l.code === code)?.label ?? code

/**
 * Панель мгновенного перевода выделенного текста (Ctrl+V ×2) и области экрана.
 *
 * Если оригинал иностранный, он показывается над переводом — со значками
 * произношения под словами и кнопкой «послушать». Если иностранный перевод,
 * значки стоят под ним. Без транскрипции панель такая же, как в основном Verbo.
 */
export function TranslatePanel(props: {
  view: TranslateView
  toast: string | null
  onClose: () => void
  onCopy: () => void
}): JSX.Element {
  const v = props.view
  const занято = v.loading || !!v.error || !v.result
  const style = v.phoneticsStyle ?? 'ipa'
  const showSource = Boolean(v.sourceLang && v.source.trim())
  const ждёмЗначки =
    v.phoneticsPending &&
    ((v.sourceLang && !v.sourcePhonetics) || (v.resultLang && v.result && !v.resultPhonetics))
  return (
    <div className="dock">
      <div className="card" {...hot}>
        <div className="card-head">
          <Picker
            label="Язык перевода"
            value={v.target}
            options={TRANSLATE_LANGS}
            onPick={(code) => void api.translateRetarget(code)}
          />
          <button className="icon-btn" aria-label="Закрыть" onClick={props.onClose}>
            <IconClose />
          </button>
        </div>
        <div className="card-body">
          {showSource && (
            <div className="phon-source">
              <div className="phon-head">
                <span>{langName(v.sourceLang!)} · оригинал</span>
                <button
                  className="icon-btn"
                  aria-label="Прослушать оригинал"
                  title="Прослушать оригинал"
                  onClick={() => void api.speakText(v.source)}
                >
                  <IconSpeaker />
                </button>
              </div>
              {v.sourcePhonetics ? (
                <PhoneticText phonetics={v.sourcePhonetics} style={style} />
              ) : (
                <div className="phon-plain">{v.source.trim()}</div>
              )}
            </div>
          )}
          {showSource && (
            <div className="phon-head">
              <span>{langName(v.target)} · перевод</span>
            </div>
          )}
          {v.loading && <div className="skeleton">Выполняется перевод…</div>}
          {!v.loading && v.error && <div className="card-error">{v.error}</div>}
          {!v.loading &&
            !v.error &&
            (v.resultPhonetics ? (
              <PhoneticText phonetics={v.resultPhonetics} style={style} />
            ) : (
              <div className="card-result">{v.result}</div>
            ))}
          {ждёмЗначки && <div className="phon-wait">Готовлю транскрипцию…</div>}
          {v.phoneticsNote && <div className="phon-wait">{v.phoneticsNote}</div>}
        </div>
        <div className="card-foot">
          <span className="card-hint">{v.loading || v.error ? '' : 'Esc — закрыть'}</span>
          <div className="actions">
            <button className="btn ghost" disabled={занято} onClick={props.onCopy}>
              {props.toast === 'Скопировано' ? <IconCheck /> : <IconCopy />}
              <span>Копировать</span>
            </button>
            <button
              className="btn ghost"
              disabled={занято}
              onClick={() => void api.speakText(v.result)}
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
