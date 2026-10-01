import type { OutputLang } from '../../../shared/lang'
import { IconCheck, IconSliders } from './icons'

export const LANG_BADGE: Record<OutputLang, string> = { none: 'RU', en: 'EN', zh: '中' }

const LANG_MENU: Array<{ lang: OutputLang; label: string; note: string }> = [
  { lang: 'none', label: 'Без перевода', note: 'Язык оригинала' },
  { lang: 'en', label: 'English', note: 'Перевод при вводе' },
  { lang: 'zh', label: '中文 (简体)', note: 'Перевод при вводе' }
]

/** Меню выбора языка результата диктовки. */
export function LangMenu(props: {
  lang: OutputLang
  hover: { onMouseEnter: () => void; onMouseLeave: () => void }
  onPick: (lang: OutputLang) => void
  onOpenSettings: () => void
}): JSX.Element {
  return (
    <div className="menu" role="menu" {...props.hover}>
      <div className="menu-title">Язык результата</div>
      {LANG_MENU.map((item) => (
        <button
          key={item.lang}
          role="menuitemradio"
          aria-checked={props.lang === item.lang}
          className={`menu-item ${props.lang === item.lang ? 'on' : ''}`}
          onClick={() => props.onPick(item.lang)}
        >
          <span className="menu-item-main">
            <span className="menu-item-label">{item.label}</span>
            <span className="menu-item-note">{item.note}</span>
          </span>
          {props.lang === item.lang && <IconCheck />}
        </button>
      ))}
      <div className="menu-sep" />
      <button className="menu-item compact" onClick={props.onOpenSettings}>
        <IconSliders />
        <span className="menu-item-label">Все параметры</span>
      </button>
    </div>
  )
}

/** Подпись пункта меню — нужна для всплывающей подсказки при выборе языка. */
export function langLabel(lang: OutputLang): string {
  return LANG_MENU.find((i) => i.lang === lang)?.label ?? ''
}
