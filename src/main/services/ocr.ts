import { execFile } from 'child_process'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { cyrShare } from '../../shared/lang'

export interface OcrResult {
  ok: boolean
  text: string
  message?: string
  /**
   * Встроенного движка Windows нет: не установлен языковой пакет распознавания.
   * Помечаем отдельно от прочих ошибок — окно по этому признаку предлагает
   * открыть нужный раздел параметров Windows.
   */
  engineMissing?: boolean
}

/** Запасной путь: прочитать картинку в облаке. Возвращает то же, что и местный движок. */
export type OcrCloud = (image: Buffer) => Promise<{ ok: boolean; text?: string; message?: string }>

/**
 * Что показать, когда прочитать картинку нечем ни на месте, ни через интернет.
 * Формулировка верна для всех случаев сразу: пакета нет, а запасной путь не
 * сработал — ключа нет, он недействителен, сети нет или подходящей модели нет.
 */
export const ENGINE_MISSING_MESSAGE =
  'Распознавание текста на изображении недоступно: в Windows не установлен ' +
  'языковой пакет распознавания, а прочитать картинку через интернет не удалось. ' +
  'Установите языковой пакет в параметрах Windows — тогда распознавание будет ' +
  'работать и без интернета.'

/** Запуск PowerShell-скрипта распознавания. Вынесен для подмены в тестах. */
export type OcrRunner = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>

export function makeRunner(scriptPath: string): OcrRunner {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
        { windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout, stderr) => {
          const code = err ? ((err as { code?: number }).code ?? 1) : 0
          resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' })
        }
      )
    })
}

/** Убирает переносы, которыми движок делит строки макета, но сохраняет абзацы. */
export function tidyOcrText(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const out: string[] = []
  for (const line of lines) {
    const prev = out[out.length - 1]
    // строку, начатую со строчной буквы, приклеиваем к предыдущей: это перенос макета
    if (prev && /^[a-zа-яё]/.test(line) && !/[.!?:;]$/.test(prev)) {
      out[out.length - 1] = prev + ' ' + line
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}

/**
 * Распознаёт текст на изображении встроенным движком Windows.
 * Профильный язык системы срабатывает первым; если результат оказался
 * преимущественно латиницей, повторяем с английским движком — русский пакет
 * читает английские слова заметно хуже (Hello → Непо).
 */
export async function recognizeImage(opts: {
  imagePath: string
  run: OcrRunner
}): Promise<OcrResult> {
  // WinRT принимает только путь с обратными слэшами: со «/» он отвечает
  // «указан недопустимый путь»
  const path = opts.imagePath.replace(/\//g, '\\')
  const first = await opts.run(['-Path', path])
  if (first.code === 2) {
    return { ok: false, text: '', message: ENGINE_MISSING_MESSAGE, engineMissing: true }
  }
  if (first.code !== 0) {
    return { ok: false, text: '', message: first.stderr.trim() || 'Не удалось распознать изображение' }
  }
  let text = tidyOcrText(first.stdout)
  if (text && cyrShare(text) < 0.3) {
    const second = await opts.run(['-Path', path, '-Lang', 'en-US'])
    if (second.code === 0) {
      const alt = tidyOcrText(second.stdout)
      if (alt.length >= text.length * 0.8) text = alt
    }
  }
  if (!text.trim()) return { ok: false, text: '', message: 'На изображении не найдено текста' }
  return { ok: true, text }
}

/**
 * Сохраняет присланное изображение во временный файл и распознаёт его.
 *
 * Порядок именно такой: сперва встроенный движок Windows — он бесплатный,
 * работает без интернета и отвечает мгновенно. В облако уходим ТОЛЬКО когда
 * движка в системе нет вовсе. Пустой результат за отказ движка не считаем:
 * он отработал и честно сказал, что текста на картинке нет.
 */
export async function recognizeImageBuffer(opts: {
  data: Buffer
  tmpDir: string
  run: OcrRunner
  cloud?: OcrCloud
}): Promise<OcrResult> {
  await fsp.mkdir(opts.tmpDir, { recursive: true })
  const path = join(opts.tmpDir, `ocr-${Date.now()}.png`)
  await fsp.writeFile(path, opts.data)
  let local: OcrResult
  try {
    local = await recognizeImage({ imagePath: path, run: opts.run })
  } finally {
    await fsp.rm(path, { force: true })
  }
  if (!local.engineMissing || !opts.cloud) return local

  const remote = await opts.cloud(opts.data)
  if (remote.ok && remote.text?.trim()) return { ok: true, text: remote.text.trim() }
  // облако тоже не помогло: объясняем, чего не хватает системе, а не прячем причину
  return { ok: false, text: '', message: ENGINE_MISSING_MESSAGE, engineMissing: true }
}
