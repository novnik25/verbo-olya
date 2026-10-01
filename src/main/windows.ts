import { BrowserWindow, screen, session } from 'electron'
import { join } from 'path'
import { APP_NAME } from '../shared/app'

const preload = join(__dirname, '../preload/index.js')

function load(win: BrowserWindow, page: 'index' | 'overlay' | 'recorder' | 'region'): void {
  // единственная точка, через которую грузятся все четыре окна: запрет навигации
  // ставим здесь, чтобы новое окно нельзя было завести без него
  lockNavigation(win)
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${page}.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`))
  }
}

/**
 * Разрешаем только микрофон, выбор устройства воспроизведения и только нашим окнам.
 *
 * 'speaker-selection' нужен для setSinkId: без него Chromium отказывает, и речь
 * продолжает звучать в устройстве по умолчанию, молча игнорируя выбор в настройках.
 */
export function setupPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'speaker-selection')
  })
}

/**
 * Окна приложения никуда не ходят и ничего не открывают.
 *
 * В рендерер постоянно попадает чужой текст: распознанная речь, выделение из
 * других окон, ответы модели, результат распознавания с картинки. Если такой
 * текст когда-нибудь превратится в разметку, единственное, что у него останется —
 * увести окно на чужой адрес или открыть новое. Закрываем оба пути наглухо:
 * ссылки наружу открывает главный процесс через shell.openExternal (IPC).
 */
export function lockNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const stay = (e: { preventDefault(): void }, url: string): void => {
    // единственный разрешённый переход — на страницу самого приложения
    if (url === win.webContents.getURL()) return
    e.preventDefault()
  }
  win.webContents.on('will-navigate', stay)
  win.webContents.on('will-frame-navigate', (e) => stay(e, e.url))
  // вложенных webview в приложении нет — но если появятся, пусть не наследуют лишнего
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
}

/** Цвета системной полосы заголовка под тему приложения. */
export function titleBarColors(theme: 'dark' | 'light'): { color: string; symbolColor: string } {
  return theme === 'light'
    ? { color: '#f3f5f7', symbolColor: '#15191d' }
    : { color: '#15181b', symbolColor: '#edeff1' }
}

export function createMainWindow(show: boolean, theme: 'dark' | 'light'): BrowserWindow {
  const win = new BrowserWindow({
    width: 1050,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    show,
    autoHideMenuBar: true,
    title: APP_NAME,
    // системная полоса заголовка перекрашена под тему приложения:
    // прячем рамку, а родные кнопки (свернуть/развернуть/закрыть) рисуем поверх в цветах темы
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...titleBarColors(theme), height: 36 },
    backgroundColor: titleBarColors(theme).color,
    webPreferences: { preload }
  })
  load(win, 'index')
  return win
}

// Окно вмещает плашку, карточки и меню ВМЕСТЕ С ТЕНЬЮ: всё, что выходит за его
// границы, обрезается — при узком окне мягкая тень превращалась в прямоугольный
// ореол с резкими краями. Запас по сторонам — больше радиуса размытия тени.
export const OVERLAY_W = 520
export const OVERLAY_H = 620

export function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: OVERLAY_W,
    height: OVERLAY_H,
    show: false,
    frame: false,
    transparent: true,
    // явный прозрачный фон окна: иначе Windows подмешивает свою подложку и вокруг
    // панели виден прямоугольный ореол вместо скруглённой тени
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { preload }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // клики проходят сквозь прозрачные места; интерактивные элементы (кружок, меню)
  // временно выключают проброс через IPC overlay:mouse
  win.setIgnoreMouseEvents(true, { forward: true })
  load(win, 'overlay')
  return win
}

/** Экран, на котором пользователь сейчас работает (под указателем мыши). */
export function activeDisplayId(): number {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
}

/**
 * Ставит оверлей по центру снизу того экрана, где сейчас курсор: панели и плашка
 * должны появляться там, где человек работает, а не всегда на главном мониторе.
 */
export function positionOverlay(win: BrowserWindow): void {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  win.setBounds({
    x: Math.round(workArea.x + workArea.width / 2 - OVERLAY_W / 2),
    y: workArea.y + workArea.height - OVERLAY_H,
    width: OVERLAY_W,
    height: OVERLAY_H
  })
}

/** Полноэкранное окно поверх всего для выделения области экрана мышью. */
export function createRegionWindow(bounds: Electron.Rectangle): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: { preload }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  load(win, 'region')
  return win
}

/** Экран, на котором сейчас работает пользователь: границы для захвата. */
export function activeDisplay(): Electron.Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

export function createRecorderWindow(): BrowserWindow {
  // backgroundThrottling: скрытое окно Chromium усыпляет таймеры и звук —
  // чтение замолкало на середине и оживало при переключении окон
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload, backgroundThrottling: false }
  })
  load(win, 'recorder')
  return win
}
