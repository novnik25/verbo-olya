import { RU_VOICES, EN_VOICES } from '../../../shared/voices'
import { api } from './api'
import { IconClose, IconSpeaker } from './icons'
import { SPEED_STEPS } from '../../../shared/speech-rate'

/** Панель чтения вслух: голос и темп переключаются прямо во время чтения. */
export function SpeakingPanel(props: {
  lang: 'ru' | 'en'
  voiceId: string
  rate: number
  paused: boolean
  hover: { onMouseEnter: () => void; onMouseLeave: () => void }
  onStop: () => void
}): JSX.Element {
  // предлагаем только голоса того языка, на котором идёт чтение
  const voices = props.lang === 'ru' ? RU_VOICES : EN_VOICES
  return (
    <div className="dock">
      <div className="card narrow" {...props.hover}>
        <div className="card-head">
          <span className="voice-name">
            <IconSpeaker />
            <span>{props.lang === 'ru' ? 'Русская речь' : 'Английская речь'}</span>
          </span>
          <button className="icon-btn" aria-label="Остановить" onClick={props.onStop}>
            <IconClose />
          </button>
        </div>
        <div className="menu-group">Голос</div>
        <div className="seg">
          {voices.map((v) => (
            <button
              key={v.id}
              className={`seg-btn ${props.voiceId === v.id ? 'on' : ''}`}
              title="Голос применится со следующего фрагмента"
              onClick={() =>
                void api.updateSettings(
                  props.lang === 'ru' ? { speakVoiceRu: v.id } : { speakVoiceEn: v.id }
                )
              }
            >
              {v.gender === 'f' ? 'Женский' : 'Мужской'}
            </button>
          ))}
        </div>
        <div className="menu-group">Темп речи</div>
        <div className="seg">
          {SPEED_STEPS.map((sp) => (
            <button
              key={sp.value}
              className={`seg-btn ${props.rate === sp.value ? 'on' : ''}`}
              title="Темп применится со следующего фрагмента"
              onClick={() => void api.updateSettings({ speakRate: sp.value })}
            >
              {sp.label}
            </button>
          ))}
        </div>
        <div className="card-foot">
          <div className="actions">
            <button
              className="btn"
              onClick={() => void api.speakControl(props.paused ? 'resume' : 'pause')}
            >
              {props.paused ? 'Продолжить' : 'Пауза'}
            </button>
            <button className="btn ghost" onClick={() => void api.speakControl('stop')}>
              Остановить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
