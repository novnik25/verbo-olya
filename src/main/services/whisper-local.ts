import { execFile as execFileCb } from 'child_process'
import { createWriteStream, promises as fsp } from 'fs'
import { Readable } from 'stream'
import { cpus } from 'os'
import { dirname, join } from 'path'
import { APP_NAME } from '../../shared/app'
import type { TextResult } from './groq'

/**
 * Модели whisper.cpp по приоритету поиска установленной: сначала быстрая квантованная q8_0
 * (~264 МБ, качество практически не отличается от полной модели), затем обычная — на случай,
 * если она осталась от старой версии VoxFlow. downloadLocal всегда качает первую (q8_0).
 */
export const MODEL_CANDIDATES = ['ggml-small-q8_0.bin', 'ggml-small.bin'] as const
export const LOCAL_MODEL = MODEL_CANDIDATES[0]

// прибито к проверенному релизу: структура архивов у whisper.cpp меняется от версии
// к версии («whisper-cli не найден» на свежих релизах); обновляем тег осознанно
const GITHUB_RELEASE_URL = 'https://api.github.com/repos/ggerganov/whisper.cpp/releases/tags/v1.9.2'
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin'
// файл меньше этого размера — заведомо битая/недокачанная модель (с запасом ниже размера обоих кандидатов)
const MIN_MODEL_BYTES = 100 * 1024 * 1024

export function localPaths(baseDir: string): {
  dir: string
  binPath: string
  modelPath: string
  modelPaths: string[]
  gpuDir: string
  gpuBinPath: string
  gpuMarkerPath: string
} {
  const dir = join(baseDir, 'whisper')
  const gpuDir = join(dir, 'gpu')
  return {
    dir,
    binPath: join(dir, 'whisper-cli.exe'),
    modelPath: join(dir, LOCAL_MODEL), // куда качает новую модель downloadLocal (всегда q8_0)
    modelPaths: MODEL_CANDIDATES.map((name) => join(dir, name)), // порядок = приоритет поиска установленной
    gpuDir, // подпапка с GPU-сборкой (cublas) — отдельно от CPU-файлов в dir
    gpuBinPath: join(gpuDir, 'whisper-cli.exe'),
    gpuMarkerPath: join(gpuDir, 'gpu-ok.json') // признак того, что GPU-сборка реально запускалась (smoke пройден)
  }
}

/** Существует ли путь на диске (файл или папка) — не бросает исключение. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

/** Первый из кандидатов, который реально лежит на диске и не битый (см. MIN_MODEL_BYTES), либо null. */
async function findInstalledModel(modelPaths: string[]): Promise<string | null> {
  for (const p of modelPaths) {
    try {
      const st = await fsp.stat(p)
      if (st.size > MIN_MODEL_BYTES) return p
    } catch {
      // нет такого файла — пробуем следующего кандидата
    }
  }
  return null
}

/** Есть ли рядом с движком библиотека с 'blas' в имени (значит движок — ускоренная BLAS-сборка). */
async function hasBlasDll(dir: string): Promise<boolean> {
  try {
    const names = await fsp.readdir(dir)
    return names.some((n) => n.toLowerCase().endsWith('.dll') && n.toLowerCase().includes('blas'))
  } catch {
    return false
  }
}

let gpuAvailableCache: boolean | null = null

/**
 * Есть ли на машине видеокарта NVIDIA — определяется лениво через PowerShell CIM
 * (Win32_VideoController), результат кэшируется на весь процесс (опрос не бесплатный).
 * При любой ошибке (нет PowerShell, WMI недоступен и т.п.) считаем, что GPU нет.
 */
export async function detectGpuAvailable(execFileFn?: ExecFileFn): Promise<boolean> {
  if (gpuAvailableCache !== null) return gpuAvailableCache
  const fn = execFileFn ?? (execFileCb as unknown as ExecFileFn)
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      fn(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | ForEach-Object Name'],
        { windowsHide: true, timeout: 15_000 },
        (err, out) => (err ? reject(err) : resolve(out))
      )
    })
    gpuAvailableCache = /nvidia/i.test(stdout)
  } catch {
    gpuAvailableCache = false
  }
  return gpuAvailableCache
}

/** Сбрасывает кэш определения видеокарты — используется только тестами. */
export function resetGpuAvailableCache(): void {
  gpuAvailableCache = null
}

export async function localStatus(
  baseDir: string,
  detectGpuFn: () => Promise<boolean> = detectGpuAvailable
): Promise<{ installed: boolean; upgradable: boolean; gpuReady: boolean; gpuAvailable: boolean }> {
  const { dir, binPath, modelPaths, gpuBinPath, gpuMarkerPath } = localPaths(baseDir)
  const gpuReady = (await pathExists(gpuMarkerPath)) && (await pathExists(gpuBinPath))
  const gpuAvailable = await detectGpuFn()
  try {
    await fsp.access(binPath)
    const found = await findInstalledModel(modelPaths)
    if (!found) return { installed: false, upgradable: false, gpuReady, gpuAvailable }
    const isQ8 = found === modelPaths[0]
    const hasBlas = await hasBlasDll(dir)
    // апгрейд имеет смысл, если модель ещё не квантованная или движок ещё без BLAS-ускорения
    return { installed: true, upgradable: !isQ8 || !hasBlas, gpuReady, gpuAvailable }
  } catch {
    return { installed: false, upgradable: false, gpuReady, gpuAvailable }
  }
}

/** Аргументы whisper-cli.exe. Чистая функция — проверено юнит-тестами. threads вычисляет вызывающий. */
export function buildArgs(opts: {
  modelPath: string
  wavPath: string
  outBase: string
  language?: 'ru' | 'en'
  prompt?: string
  threads: number
}): string[] {
  const args = ['-m', opts.modelPath, '-f', opts.wavPath, '-otxt', '-of', opts.outBase, '-np', '-t', String(opts.threads)]
  // whisper-cli без -l по умолчанию распознаёт как английский (не авто!) — явно просим 'auto'
  args.push('-l', opts.language ?? 'auto')
  if (opts.prompt) args.push('--prompt', opts.prompt)
  return args
}

export type ExecFileFn = (
  file: string,
  args: string[],
  options: { cwd?: string; timeout?: number; windowsHide?: boolean },
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => void

function shortReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.split('\n')[0].slice(0, 200)
}

/** Число потоков для whisper-cli: почти все ядра, но не больше 8 (выше — без заметного выигрыша) и не меньше 4. */
function pickThreads(cpuCount: number): number {
  return Math.min(8, Math.max(4, cpuCount - 1))
}

/** Запускает whisper-cli.exe (CPU или GPU бинарь) и ждёт завершения. cwd — там, где лежат его DLL. */
function runWhisperBin(
  execFileFn: ExecFileFn,
  bin: string,
  cwd: string,
  args: string[]
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFileFn(bin, args, { cwd, timeout: 5 * 60_000, windowsHide: true }, (err) =>
      err ? reject(err) : resolve()
    )
  })
}

/** Распознаёт wav-файл локальным whisper-cli.exe: GPU-сборкой, если она готова, иначе CPU. Таймаут — 5 минут. */
export async function transcribeLocal(opts: {
  baseDir: string
  wavPath: string
  language?: 'ru' | 'en'
  prompt?: string
  execFileFn?: ExecFileFn
}): Promise<TextResult> {
  const { dir, binPath, modelPaths, modelPath: defaultModelPath, gpuDir, gpuBinPath, gpuMarkerPath } =
    localPaths(opts.baseDir)
  const modelPath = (await findInstalledModel(modelPaths)) ?? defaultModelPath
  const outBase = opts.wavPath.replace(/\.[^./\\]+$/, '')
  const args = buildArgs({
    modelPath,
    wavPath: opts.wavPath,
    outBase,
    language: opts.language,
    prompt: opts.prompt,
    threads: pickThreads(cpus().length)
  })
  const execFileFn = opts.execFileFn ?? (execFileCb as unknown as ExecFileFn)
  const gpuReady = (await pathExists(gpuMarkerPath)) && (await pathExists(gpuBinPath))

  try {
    if (gpuReady) {
      try {
        // cwd = gpuDir: GPU-бинарь ищет свои DLL (включая CUDA runtime) рядом с собой;
        // modelPath уже абсолютный, поэтому общая модель из ../whisper находится независимо от cwd
        await runWhisperBin(execFileFn, gpuBinPath, gpuDir, args)
      } catch (gpuErr) {
        // тихий фолбэк: GPU-бинарь не запустился в рантайме (например, драйвер обновился/слетел) —
        // пользователю об этом не сообщаем, один раз пробуем CPU-движком и больше GPU не трогаем
        console.error('[whisper-local] GPU-бинарь не запустился, фолбэк на CPU:', shortReason(gpuErr))
        await fsp.rm(gpuMarkerPath, { force: true })
        await runWhisperBin(execFileFn, binPath, dir, args)
      }
    } else {
      await runWhisperBin(execFileFn, binPath, dir, args)
    }
  } catch (err) {
    return { ok: false, kind: 'permanent', message: 'Локальное распознавание: ' + shortReason(err) }
  }

  const txtPath = `${outBase}.txt`
  try {
    const raw = await fsp.readFile(txtPath, 'utf-8')
    await fsp.rm(txtPath, { force: true })
    return { ok: true, text: raw.trim() }
  } catch (err) {
    return {
      ok: false,
      kind: 'permanent',
      message: 'Локальное распознавание: не удалось прочитать результат (' + shortReason(err) + ')'
    }
  }
}

interface GithubAsset {
  name: string
  browser_download_url: string
}

/**
 * Выбирает сборку whisper.cpp для Windows x64 среди ассетов релиза.
 * Отсеивает GPU-варианты (cublas/cuda); среди оставшихся предпочитает bin-x64/win-x64 и,
 * при прочих равных, сборку с BLAS (OpenBLAS) — она заметно быстрее на CPU за счёт ускоренного
 * матричного умножения. Если BLAS x64-сборки в релизе нет, та же логика сама откатится на
 * обычную CPU x64-сборку (у неё просто не будет бонуса за blas) — специального фолбэка не нужно.
 */
export function pickWindowsAsset(assets: GithubAsset[]): GithubAsset | null {
  let best: (GithubAsset & { score: number }) | null = null
  for (const a of assets) {
    if (!/\.zip$/i.test(a.name)) continue
    if (!/win|x64/i.test(a.name)) continue
    if (/cublas|cuda/i.test(a.name)) continue // GPU-сборки — не наш случай
    let score = 0
    if (/bin-x64|win-x64/i.test(a.name)) score += 2
    if (/x64/i.test(a.name)) score += 1
    if (/blas/i.test(a.name)) score += 4 // BLAS-сборка (OpenBLAS) — предпочитаем, она быстрее
    if (!best || score > best.score) best = { ...a, score }
  }
  return best
}

/**
 * Выбирает GPU-сборку (cublas/CUDA) whisper.cpp для Windows x64 среди ассетов релиза.
 * Берёт только cublas/cuda-варианты (зеркально pickWindowsAsset, который их отсеивает).
 * Если в релизе несколько версий CUDA (например 11.8 и 12.4), предпочитает более новую —
 * драйверы NVIDIA обратно совместимы, так что более новая CUDA runtime запустится и на ней.
 */
export function pickGpuAsset(assets: GithubAsset[]): GithubAsset | null {
  let best: (GithubAsset & { score: number }) | null = null
  for (const a of assets) {
    if (!/\.zip$/i.test(a.name)) continue
    if (!/win|x64/i.test(a.name)) continue
    if (!/cublas|cuda/i.test(a.name)) continue // нужны только GPU-сборки
    let score = 0
    if (/bin-x64|win-x64/i.test(a.name)) score += 2
    if (/x64/i.test(a.name)) score += 1
    const ver = a.name.match(/(\d+)\.(\d+)/) // "…-cublas-12.4.0-bin-x64.zip" -> [12, 4]
    if (ver) score += Number(ver[1]) * 100 + Number(ver[2])
    if (!best || score > best.score) best = { ...a, score }
  }
  return best
}

/**
 * Некоторые релизы whisper.cpp кладут CUDA runtime (cudart64_*.dll/cublas64_*.dll/cublasLt64_*.dll)
 * не в сам cublas-zip, а в отдельный ассет "cudart-*.zip" того же релиза — ищет его, если есть.
 */
export function pickCudartAsset(assets: GithubAsset[]): GithubAsset | null {
  return assets.find((a) => /^cudart.*\.zip$/i.test(a.name)) ?? null
}

async function findFileRecursive(dir: string, name: string): Promise<string | null> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      const found = await findFileRecursive(full, name)
      if (found) return found
    } else if (e.name.toLowerCase() === name.toLowerCase()) {
      return full
    }
  }
  return null
}

async function runPowerShell(command: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFileCb(
      'powershell.exe',
      ['-NoProfile', '-Command', command],
      { windowsHide: true, timeout: 120_000 },
      (err) => (err ? reject(err) : resolve())
    )
  })
}

async function downloadToFile(
  url: string,
  destPath: string,
  fetchFn: typeof fetch,
  onProgress?: (pct: number) => void
): Promise<void> {
  const res = await fetchFn(url, { headers: { 'User-Agent': APP_NAME } })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} при скачивании ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let received = 0
  const out = createWriteStream(destPath)
  const nodeStream = Readable.fromWeb(res.body as never)
  await new Promise<void>((resolve, reject) => {
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (total > 0 && onProgress) onProgress(Math.min(100, Math.round((received / total) * 100)))
    })
    nodeStream.on('error', reject)
    out.on('error', reject)
    out.on('finish', resolve)
    nodeStream.pipe(out)
  })
}

/** Скачивает и устанавливает движок whisper.cpp (по возможности BLAS-сборку) + квантованную модель в baseDir/whisper. */
export async function downloadLocal(
  baseDir: string,
  onProgress: (pct: number, phase: 'engine' | 'model') => void,
  fetchFn?: typeof fetch,
  /** Папка с движком, вшитая в установщик (resources/whisper-engine). */
  engineSourceDir?: string
): Promise<void> {
  const f = fetchFn ?? fetch
  const { dir, binPath, modelPath, modelPaths } = localPaths(baseDir)
  await fsp.mkdir(dir, { recursive: true })

  // --- движок: копируется из установщика, сеть не нужна ---
  // (раньше качали с GitHub — на части машин он недоступен/меняет структуру релизов)
  if (!engineSourceDir) throw new Error('Не указана папка встроенного движка')
  const srcCli = join(engineSourceDir, 'whisper-cli.exe')
  try {
    await fsp.access(srcCli)
  } catch {
    throw new Error(
      `Встроенный движок повреждён — переустановите ${APP_NAME} (антивирус мог удалить файлы)`
    )
  }
  onProgress(10, 'engine')
  await fsp.copyFile(srcCli, binPath)
  for (const name of await fsp.readdir(engineSourceDir)) {
    if (name.toLowerCase().endsWith('.dll')) {
      await fsp.copyFile(join(engineSourceDir, name), join(dir, name))
    }
  }
  onProgress(100, 'engine')

  // --- модель: HuggingFace (доступен без VPN) ---
  const partPath = modelPath + '.part'
  try {
    await downloadToFile(MODEL_URL, partPath, f, (pct) => onProgress(pct, 'model'))
  } catch (err) {
    await fsp.rm(partPath, { force: true })
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Не удалось скачать модель распознавания (~264 МБ) с huggingface.co: ${detail}. ` +
        'Проверьте интернет и попробуйте ещё раз.'
    )
  }
  await fsp.rename(partPath, modelPath)
  onProgress(100, 'model')

  // старая полная модель (если это апгрейд предыдущей установки VoxFlow) больше не нужна —
  // downloadLocal только что скачал q8_0, и findInstalledModel в transcribeLocal найдёт именно её первой
  const oldModelPath = modelPaths.find((p) => p !== modelPath)
  if (oldModelPath) await fsp.rm(oldModelPath, { force: true })
}

/** Копирует все .dll из srcDir (рекурсивно, с поддиректориями) в destDir — плоско, по имени файла. */
async function copyDllsRecursive(srcDir: string, destDir: string): Promise<void> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>
  try {
    entries = await fsp.readdir(srcDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = join(srcDir, e.name)
    if (e.isDirectory()) {
      await copyDllsRecursive(full, destDir)
    } else if (e.name.toLowerCase().endsWith('.dll')) {
      await fsp.copyFile(full, join(destDir, e.name))
    }
  }
}

/** WAV-буфер: 1 секунда цифровой тишины, 16 кГц, моно, 16 бит — только для smoke-теста GPU-бинаря. */
function silentWavBuffer(): Buffer {
  const sampleRate = 16000
  const bytesPerSample = 2
  const dataSize = sampleRate * bytesPerSample // 1 секунда
  const buf = Buffer.alloc(44 + dataSize) // весь буфер изначально нулевой — это и есть тишина
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16) // размер PCM-чанка
  buf.writeUInt16LE(1, 20) // формат = PCM
  buf.writeUInt16LE(1, 22) // каналы = 1 (моно)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * bytesPerSample, 28) // байт/сек
  buf.writeUInt16LE(bytesPerSample, 32) // выравнивание блока
  buf.writeUInt16LE(16, 34) // бит на сэмпл
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)
  return buf
}

/** Прогоняет GPU-бинарь на тихом WAV — убеждается, что он реально запускается (CUDA DLL на месте, драйвер подходит). */
async function smokeTestGpuBinary(
  gpuBinPath: string,
  gpuDir: string,
  modelPath: string,
  execFileFn: ExecFileFn
): Promise<void> {
  const wavPath = join(gpuDir, 'smoke.wav')
  const outBase = join(gpuDir, 'smoke')
  await fsp.writeFile(wavPath, silentWavBuffer())
  try {
    const args = buildArgs({ modelPath, wavPath, outBase, threads: 4 })
    await runWhisperBin(execFileFn, gpuBinPath, gpuDir, args)
  } finally {
    await fsp.rm(wavPath, { force: true })
    await fsp.rm(`${outBase}.txt`, { force: true })
  }
}

/**
 * Скачивает и устанавливает GPU-сборку (cublas/CUDA) whisper.cpp в baseDir/whisper/gpu — отдельно
 * от CPU-файлов в baseDir/whisper, которые не трогает. Требует уже установленный CPU-движок с
 * моделью (модель общая, второй раз её не качает). После распаковки прогоняет бинарь на тихом
 * WAV (smoke-тест): если он не запускается — GPU-папка удаляется целиком и наружу летит понятная
 * ошибка, а пользователь остаётся на рабочем CPU-движке.
 */
export async function downloadGpu(
  baseDir: string,
  onProgress: (pct: number, phase: 'engine' | 'model') => void,
  fetchFn?: typeof fetch
): Promise<void> {
  const f = fetchFn ?? fetch
  const { modelPaths, gpuDir, gpuBinPath, gpuMarkerPath } = localPaths(baseDir)

  const modelPath = await findInstalledModel(modelPaths)
  if (!modelPath) {
    throw new Error(
      'Сначала установите локальный движок распознавания — GPU-ускорение ставится поверх него и использует ту же модель'
    )
  }

  await fsp.rm(gpuDir, { recursive: true, force: true })
  await fsp.mkdir(gpuDir, { recursive: true })

  const releaseRes = await f(GITHUB_RELEASE_URL, {
    headers: { 'User-Agent': APP_NAME, Accept: 'application/vnd.github+json' }
  })
  if (!releaseRes.ok) throw new Error(`GitHub API вернул HTTP ${releaseRes.status}`)
  const release = (await releaseRes.json()) as { assets: GithubAsset[] }
  const assets = release.assets ?? []
  const asset = pickGpuAsset(assets)
  if (!asset) throw new Error('В релизе whisper.cpp не найдена GPU-сборка (cublas) для Windows x64')
  const cudartAsset = pickCudartAsset(assets)
  // сколько прогресса отдать под основной zip, если следом качается ещё и отдельный cudart-zip
  const enginePctScale = cudartAsset ? 0.7 : 1

  const zipPath = join(gpuDir, 'engine-gpu.zip')
  const extractDir = join(gpuDir, 'engine-gpu-extract')
  await downloadToFile(asset.browser_download_url, zipPath, f, (pct) =>
    onProgress(Math.round(pct * enginePctScale), 'engine')
  )
  await fsp.rm(extractDir, { recursive: true, force: true })
  // апостроф в имени профиля (O'Brien) закрывал строку раньше времени —
    // удваиваем его, как требует синтаксис PowerShell
    const q = (v: string): string => v.replace(/'/g, "''")
    await runPowerShell(`Expand-Archive -LiteralPath '${q(zipPath)}' -DestinationPath '${q(extractDir)}' -Force`)
  await fsp.rm(zipPath, { force: true })

  let cliPath = await findFileRecursive(extractDir, 'whisper-cli.exe')
  if (!cliPath) cliPath = await findFileRecursive(extractDir, 'main.exe')
  if (!cliPath) {
    await fsp.rm(gpuDir, { recursive: true, force: true })
    throw new Error('whisper-cli.exe не найден в скачанном GPU-архиве')
  }
  const srcDir = dirname(cliPath)
  await fsp.copyFile(cliPath, gpuBinPath)
  for (const name of await fsp.readdir(srcDir)) {
    if (name.toLowerCase().endsWith('.dll')) await fsp.copyFile(join(srcDir, name), join(gpuDir, name))
  }
  await fsp.rm(extractDir, { recursive: true, force: true })

  // отдельный ассет с CUDA runtime — в части релизов whisper.cpp DLL cudart/cublas лежат не в
  // самом cublas-zip, а рядом отдельным архивом; докачиваем и докладываем dll, если он есть
  if (cudartAsset) {
    const cudartZip = join(gpuDir, 'cudart.zip')
    const cudartExtract = join(gpuDir, 'cudart-extract')
    await downloadToFile(cudartAsset.browser_download_url, cudartZip, f, (pct) =>
      onProgress(70 + Math.round(pct * 0.3), 'engine')
    )
    await fsp.rm(cudartExtract, { recursive: true, force: true })
    await runPowerShell(`Expand-Archive -LiteralPath '${cudartZip}' -DestinationPath '${cudartExtract}' -Force`)
    await fsp.rm(cudartZip, { force: true })
    await copyDllsRecursive(cudartExtract, gpuDir)
    await fsp.rm(cudartExtract, { recursive: true, force: true })
  }

  onProgress(100, 'engine')

  // --- smoke-тест: GPU-бинарь реально запускается на этой машине? ---
  try {
    await smokeTestGpuBinary(gpuBinPath, gpuDir, modelPath, execFileCb as unknown as ExecFileFn)
  } catch (err) {
    await fsp.rm(gpuDir, { recursive: true, force: true })
    throw new Error('GPU-сборка не запустилась — оставлен процессорный движок (' + shortReason(err) + ')')
  }

  await fsp.writeFile(
    gpuMarkerPath,
    JSON.stringify({ verifiedAt: new Date().toISOString(), asset: asset.name }, null, 2),
    'utf-8'
  )
}
