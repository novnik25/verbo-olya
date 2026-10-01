import type { SettingsPublic } from '../../../shared/types'
import { VOICES } from '../../../shared/voices'
import { IconCheck, IconSpeaker } from './icons'
import { SPEED_STEPS } from '../../../shared/speech-rate'

/** Меню озвучивания на плашке покоя: голос для каждого языка и темп речи. */
export function VoiceMenu(props: {
  settings: SettingsPublic
  hover: { onMouseEnter: () => void; onMouseLeave: () => void }
  onPatch: (p: Partial<SettingsPublic>) => void
  onSpeakSelection: () => void
}): JSX.Element {
  const { settings } = props
  return (
    <div className="menu wide" {...props.hover}>
      <div className="menu-title">Озвучивание</div>
      <div className="menu-group">Голос</div>
      {VOICES.map((v) => {
        const on = v.lang === 'ru' ? settings.speakVoiceRu === v.id : settings.speakVoiceEn === v.id
        return (
          <button
            key={v.id}
            className={`menu-item ${on ? 'on' : ''}`}
            onClick={() =>
              props.onPatch(v.lang === 'ru' ? { speakVoiceRu: v.id } : { speakVoiceEn: v.id })
            }
          >
            <span className="menu-item-main">
              <span className="menu-item-label">{v.label}</span>
              <span className="menu-item-note">
                {v.lang === 'ru' ? 'Русская речь' : 'Английская речь'}
              </span>
            </span>
            {on && <IconCheck />}
          </button>
        )
      })}
      <div className="menu-sep" />
      <div className="menu-group">Темп речи</div>
      <div className="seg">
        {SPEED_STEPS.map((s) => (
          <button
            key={s.value}
            className={`seg-btn ${settings.speakRate === s.value ? 'on' : ''}`}
            onClick={() => props.onPatch({ speakRate: s.value })}
          >
            {s.label}
          </button>
        ))}
      </div>
      <button className="menu-action" onClick={props.onSpeakSelection}>
        <IconSpeaker />
        <span>Озвучить выделенный текст</span>
      </button>
    </div>
  )
}
