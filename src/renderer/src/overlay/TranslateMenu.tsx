import type { SettingsPublic } from '../../../shared/types'
import { TRANSLATE_LANGS } from '../../../shared/lang'
import { Picker } from './Picker'
import { IconTranslate, IconCrop, IconSliders } from './icons'

/** Меню перевода на плашке покоя: язык и три способа перевести. */
export function TranslateMenu(props: {
  settings: SettingsPublic
  hover: { onMouseEnter: () => void; onMouseLeave: () => void }
  onPatch: (p: Partial<SettingsPublic>) => void
  onTranslateSelection: () => void
  onTranslateRegion: () => void
  onOpenTranslator: () => void
}): JSX.Element {
  return (
    <div className="menu wide" {...props.hover}>
      <div className="menu-title">Перевод выделенного</div>
      <div className="menu-group">Язык перевода</div>
      <Picker
        label="Язык перевода"
        value={props.settings.translateTargetLang}
        options={TRANSLATE_LANGS}
        onPick={(code) => props.onPatch({ translateTargetLang: code })}
      />
      <button className="menu-action" onClick={props.onTranslateSelection}>
        <IconTranslate />
        <span>Перевести выделенный текст</span>
      </button>
      <button className="menu-item compact" onClick={props.onTranslateRegion}>
        <IconCrop />
        <span className="menu-item-label">Перевести область экрана</span>
      </button>
      <button className="menu-item compact" onClick={props.onOpenTranslator}>
        <IconSliders />
        <span className="menu-item-label">Открыть переводчик</span>
      </button>
    </div>
  )
}
