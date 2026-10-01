import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { APP_TITLE } from '../../shared/app'

/**
 * Простой журнал в %APPDATA%\VoxFlow\voxflow.log — чтобы разбирать проблемы
 * на чужих машинах. Пишем только события и размеры, без содержимого текста.
 * Папка данных осталась от прежнего имени приложения: менять её нельзя.
 */
let logPath = ''
const MAX_BYTES = 512 * 1024

export function initLog(dataDir: string): void {
  logPath = join(dataDir, 'voxflow.log')
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    if (statSync(logPath).size > MAX_BYTES) renameSync(logPath, logPath + '.old')
  } catch {
    /* файла ещё нет — нормально */
  }
  log(`=== запуск ${APP_TITLE} ===`)
}

/**
 * Отметка времени по МЕСТНЫМ часам. Раньше бралось toISOString(), то есть UTC:
 * при разборе проблемы время в журнале не сходилось с часами пользователя и
 * сбивало с толку. Чистая функция.
 */
export function stamp(d: Date = new Date()): string {
  const p = (n: number, len = 2): string => String(n).padStart(len, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

export function log(message: string): void {
  if (!logPath) return
  try {
    appendFileSync(logPath, `${stamp()} ${message}\n`, 'utf-8')
  } catch {
    /* журнал не должен ломать работу программы */
  }
}
