import { Menu, Tray, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { APP_TITLE } from '../shared/app'
import { OUTPUT_LANG_LABELS } from '../shared/lang'
import type { OutputLang } from '../shared/lang'

export interface TrayControls {
  tray: Tray
  /** Перестроить меню (после смены языка вывода из настроек и т.п.). */
  refresh: () => void
}

export function setupTray(opts: {
  iconPath: string
  onOpen: () => void
  onTogglePause: (paused: boolean) => void
  onQuit: () => void
  getOutputLang: () => OutputLang
  onOutputLang: (lang: OutputLang) => void
}): TrayControls {
  const icon = existsSync(opts.iconPath)
    ? nativeImage.createFromPath(opts.iconPath)
    : nativeImage.createEmpty()
  const tray = new Tray(icon)
  tray.setToolTip(`${APP_TITLE} — перевод с транскрипцией, голосовой ввод и озвучивание`)

  // состояние паузы живёт здесь: меню перестраивается, галочка не должна сбрасываться
  let paused = false

  function buildMenu(): void {
    const current = opts.getOutputLang()
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Открыть ${APP_TITLE}`, click: opts.onOpen },
        {
          label: 'Приостановить горячие клавиши',
          type: 'checkbox',
          checked: paused,
          click: (item) => {
            paused = item.checked
            opts.onTogglePause(paused)
          }
        },
        { type: 'separator' },
        {
          label: 'Язык результата',
          submenu: (Object.keys(OUTPUT_LANG_LABELS) as OutputLang[]).map((lang) => ({
            label: OUTPUT_LANG_LABELS[lang],
            type: 'radio' as const,
            checked: current === lang,
            click: () => opts.onOutputLang(lang)
          }))
        },
        { type: 'separator' },
        { label: 'Выход', click: opts.onQuit }
      ])
    )
  }

  buildMenu()
  // левый клик — то же меню: быстрый доступ к переключению языка вывода
  tray.on('click', () => tray.popUpContextMenu())
  tray.on('double-click', opts.onOpen)
  return { tray, refresh: buildMenu }
}
