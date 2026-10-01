import type { OverlayState } from '../../../shared/types'
import { hot } from './api'

const LABELS: Record<string, string> = {
  transcribing: 'Распознавание',
  styling: 'Обработка',
  done: 'Готово',
  empty: 'Речь не распознана',
  queued: 'В очереди',
  error: 'Ошибка'
}

const BARS = [0.45, 0.7, 1, 0.8, 0.55, 0.85, 0.6]

/**
 * Капсула диктовки: во время записи — живая шкала уровня, в остальных
 * состояниях — короткая подпись о том, что сейчас происходит.
 */
export function CompactCapsule(props: {
  state: OverlayState
  onStopRecording: () => void
}): JSX.Element {
  const { state } = props
  const level = state.phase === 'recording' ? state.level : 0
  return (
    <div className="dock">
      <div
        className={`pill ${state.phase}`}
        {...(state.phase === 'recording' ? hot : {})}
        onClick={state.phase === 'recording' ? props.onStopRecording : undefined}
        title={state.phase === 'recording' ? 'Завершить запись' : undefined}
      >
        {state.phase === 'recording' ? (
          <span className={`bars ${level < 0.02 ? 'warming' : ''}`} aria-label="Идёт запись">
            {BARS.map((b, i) => (
              <span key={i} style={{ height: `${3 + 12 * b * Math.min(1, level * 1.7)}px` }} />
            ))}
          </span>
        ) : (
          <span className="label">
            {state.phase === 'error' ? state.message : LABELS[state.phase]}
          </span>
        )}
      </div>
    </div>
  )
}
