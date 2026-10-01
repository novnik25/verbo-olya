export type PasteVerdict = 'pasted' | 'no-field' | 'failed'

export interface InserterDeps {
  clipboard: { readText(): string; writeText(t: string): void }
  /** Способы «нажать Ctrl+V», по порядку — до первого содержательного вердикта.
   *  Получают вставляемый текст: умный хелпер по нему проверяет, что вставка удалась. */
  attempts: Array<(text: string) => Promise<PasteVerdict>>
  /** Диагностика: какой способ что ответил. */
  log?: (message: string) => void
}

/**
 * Вставляет текст в активное окно: буфер обмена + Ctrl+V.
 * «no-field» (фокус не в поле ввода) прекращает попытки сразу — слепая вставка
 * в никуда бессмысленна, пользователю показывается карточка с текстом.
 * Текст ВСЕГДА остаётся в буфере обмена.
 */
export async function insertText(
  text: string,
  deps: InserterDeps
): Promise<'inserted' | 'clipboard-only'> {
  deps.clipboard.writeText(text)
  for (const attempt of deps.attempts) {
    let verdict: PasteVerdict = 'failed'
    try {
      verdict = await attempt(text)
    } catch {
      verdict = 'failed'
    }
    deps.log?.(`вставка: ${verdict}`)
    if (verdict === 'pasted') return 'inserted'
    if (verdict === 'no-field') return 'clipboard-only'
  }
  return 'clipboard-only'
}

/** Хвост текста для проверки вставки: короткий и без переводов строк. */
export function pasteTail(text: string, len = 24): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= len ? flat : flat.slice(flat.length - len)
}

/**
 * Основной способ: умный SendInput-хелпер. Через UI Automation отсекает поля
 * только для чтения, а после вставки проверяет, что текст появился у каретки
 * (exit 2 — «текст не вставлен», показываем карточку с текстом).
 */
export function makeRunHelper(exePath: string): (text: string) => Promise<PasteVerdict> {
  return (text: string) =>
    new Promise((resolve) => {
      const { execFile } = require('child_process') as typeof import('child_process')
      execFile(exePath, [pasteTail(text)], { windowsHide: true, timeout: 8000 }, (err) => {
        if (!err) return resolve('pasted')
        const code = (err as { code?: number }).code
        resolve(code === 2 ? 'no-field' : 'failed')
      })
    })
}

/** Резерв: нативная отправка Ctrl+V из процесса приложения (uiohook), «вслепую». */
export function makeUiohookPaste(): () => Promise<PasteVerdict> {
  return async () => {
    const { uIOhook, UiohookKey } = require('uiohook-napi') as typeof import('uiohook-napi')
    uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl])
    return 'pasted'
  }
}

/** Резерв: встроенные средства Windows — WScript.Shell.SendKeys('^v'). */
export function makePsPaste(): () => Promise<PasteVerdict> {
  return () =>
    new Promise((resolve) => {
      const { execFile } = require('child_process') as typeof import('child_process')
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-Command',
          "Start-Sleep -Milliseconds 60; $w = New-Object -ComObject WScript.Shell; $w.SendKeys('^v')"
        ],
        { windowsHide: true, timeout: 8000 },
        (err) => resolve(err ? 'failed' : 'pasted')
      )
    })
}
