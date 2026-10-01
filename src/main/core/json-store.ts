import { mkdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'fs'
import { dirname } from 'path'

/**
 * Атомарный JSON-файл: запись через .tmp + rename, чтение с дефолтами.
 *
 * Разобранное значение держится в памяти. Раньше каждый settings.get() читал
 * файл с диска и разбирал его заново — а зовут его часто, вплоть до каждого
 * фрагмента при чтении вслух. Теперь файл трогаем только когда он изменился:
 * сверяем время правки и размер, это заметно дешевле полного чтения с разбором.
 *
 * Кэш намеренно проверяется по метаданным, а не живёт вечно: настройки можно
 * поправить и снаружи, и такая правка обязана подхватиться.
 */
export class JsonFileStore<T extends object> {
  private cache: { data: T; mtimeMs: number; size: number } | null = null

  constructor(
    private filePath: string,
    private defaults: T
  ) {}

  read(): T {
    let stamp: { mtimeMs: number; size: number }
    try {
      const st = statSync(this.filePath)
      stamp = { mtimeMs: st.mtimeMs, size: st.size }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        this.cache = null // файл исчез: последнее значение больше не про него
        return { ...this.defaults }
      }
      throw err
    }

    if (this.cache && this.cache.mtimeMs === stamp.mtimeMs && this.cache.size === stamp.size) {
      // копия, а не сама запись кэша: вызывающий вправе менять полученный объект
      return structuredClone(this.cache.data)
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const data = { ...this.defaults, ...JSON.parse(raw) } as T
      this.cache = { data, ...stamp }
      return structuredClone(data)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      // нет файла или битый JSON — честные «нет данных»; всё остальное (EBUSY/EPERM…)
      // пробрасываем, иначе следующий write перезапишет весь файл дефолтами
      if (code === 'ENOENT' || err instanceof SyntaxError) {
        this.cache = null
        return { ...this.defaults }
      }
      throw err
    }
  }

  write(data: T): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = this.filePath + '.tmp'
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
    renameSync(tmp, this.filePath)
    // запомним записанное сразу: следующее чтение обойдётся без диска
    try {
      const st = statSync(this.filePath)
      this.cache = { data: structuredClone(data), mtimeMs: st.mtimeMs, size: st.size }
    } catch {
      this.cache = null // не смогли снять метку — пусть следующее чтение сходит на диск
    }
  }
}
