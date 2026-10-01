import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, truncateSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildArgs,
  transcribeLocal,
  pickWindowsAsset,
  pickGpuAsset,
  pickCudartAsset,
  localStatus,
  localPaths,
  type ExecFileFn
} from '../src/main/services/whisper-local'

// localStatus умеет определять NVIDIA-видеокарту через PowerShell — в тестах это лишнее и медленное
// обращение к реальному железу, поэтому везде подставляем детерминированную фейковую функцию.
const noGpu = async (): Promise<boolean> => false
const withGpu = async (): Promise<boolean> => true

describe('buildArgs', () => {
  it('без языка -> "-l auto" (whisper-cli без -l распознаёт как en, а не auto)', () => {
    expect(buildArgs({ modelPath: 'm.bin', wavPath: 'a.wav', outBase: 'a', threads: 6 })).toEqual([
      '-m', 'm.bin', '-f', 'a.wav', '-otxt', '-of', 'a', '-np', '-t', '6', '-l', 'auto'
    ])
  })
  it('язык ru', () => {
    expect(
      buildArgs({ modelPath: 'm.bin', wavPath: 'a.wav', outBase: 'a', language: 'ru', threads: 6 })
    ).toEqual(['-m', 'm.bin', '-f', 'a.wav', '-otxt', '-of', 'a', '-np', '-t', '6', '-l', 'ru'])
  })
  it('язык en + prompt', () => {
    expect(
      buildArgs({ modelPath: 'm.bin', wavPath: 'a.wav', outBase: 'a', language: 'en', prompt: 'Ozon', threads: 6 })
    ).toEqual(['-m', 'm.bin', '-f', 'a.wav', '-otxt', '-of', 'a', '-np', '-t', '6', '-l', 'en', '--prompt', 'Ozon'])
  })
  it('prompt без языка (auto)', () => {
    expect(
      buildArgs({ modelPath: 'm.bin', wavPath: 'a.wav', outBase: 'a', prompt: 'Ozon', threads: 6 })
    ).toEqual(['-m', 'm.bin', '-f', 'a.wav', '-otxt', '-of', 'a', '-np', '-t', '6', '-l', 'auto', '--prompt', 'Ozon'])
  })
  it('число потоков подставляется как есть (не захардкожено)', () => {
    expect(buildArgs({ modelPath: 'm.bin', wavPath: 'a.wav', outBase: 'a', threads: 4 })).toEqual([
      '-m', 'm.bin', '-f', 'a.wav', '-otxt', '-of', 'a', '-np', '-t', '4', '-l', 'auto'
    ])
  })
})

describe('transcribeLocal', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vf-wl-'))
  })

  it('успех: читает txt рядом с outBase, обрезает пробелы, удаляет txt', async () => {
    const wavPath = join(dir, 'a.wav')
    const execFileFn: ExecFileFn = (_file, args, _opts, cb) => {
      // симулируем работу whisper-cli.exe: он сам пишет результат в <outBase>.txt
      const outBase = args[args.indexOf('-of') + 1]
      writeFileSync(`${outBase}.txt`, '  привет мир  \n', 'utf-8')
      cb(null, '', '')
    }
    const r = await transcribeLocal({ baseDir: dir, wavPath, language: 'ru', execFileFn })
    expect(r).toEqual({ ok: true, text: 'привет мир' })
    expect(existsSync(join(dir, 'a.txt'))).toBe(false)
  })

  it('ошибка спавна/выхода -> permanent с понятным префиксом', async () => {
    const wavPath = join(dir, 'b.wav')
    const execFileFn: ExecFileFn = (_file, _args, _opts, cb) => {
      cb(new Error('spawn whisper-cli.exe ENOENT'), '', '')
    }
    const r = await transcribeLocal({ baseDir: dir, wavPath, execFileFn })
    expect(r).toMatchObject({ ok: false, kind: 'permanent' })
    expect((r as { ok: false; message: string }).message).toContain('Локальное распознавание:')
  })

  it('exe отработал, но txt не создан -> permanent', async () => {
    const wavPath = join(dir, 'c.wav')
    const execFileFn: ExecFileFn = (_file, _args, _opts, cb) => cb(null, '', '')
    const r = await transcribeLocal({ baseDir: dir, wavPath, execFileFn })
    expect(r).toMatchObject({ ok: false, kind: 'permanent' })
  })

  it('gpuReady (gpu-ok.json + gpu-бинарь на месте) -> использует GPU-бинарь с cwd=gpuDir', async () => {
    const { gpuDir, gpuBinPath, gpuMarkerPath } = localPaths(dir)
    mkdirSync(gpuDir, { recursive: true })
    writeFileSync(gpuBinPath, '')
    writeFileSync(gpuMarkerPath, JSON.stringify({ verifiedAt: 'x', asset: 'whisper-cublas-12.4.0-bin-x64.zip' }))

    const wavPath = join(dir, 'g.wav')
    const calls: Array<{ file: string; cwd?: string }> = []
    const execFileFn: ExecFileFn = (file, args, opts, cb) => {
      calls.push({ file, cwd: opts.cwd })
      const outBase = args[args.indexOf('-of') + 1]
      writeFileSync(`${outBase}.txt`, 'gpu результат', 'utf-8')
      cb(null, '', '')
    }
    const r = await transcribeLocal({ baseDir: dir, wavPath, language: 'ru', execFileFn })
    expect(r).toEqual({ ok: true, text: 'gpu результат' })
    expect(calls).toEqual([{ file: gpuBinPath, cwd: gpuDir }]) // CPU-бинарь не вызывался
  })

  it('gpuReady, но GPU-бинарь падает в рантайме -> тихий фолбэк на CPU + удаляет gpu-ok.json', async () => {
    const { binPath, gpuDir, gpuBinPath, gpuMarkerPath } = localPaths(dir)
    mkdirSync(gpuDir, { recursive: true })
    writeFileSync(gpuBinPath, '')
    writeFileSync(gpuMarkerPath, JSON.stringify({ verifiedAt: 'x', asset: 'a' }))

    const wavPath = join(dir, 'h.wav')
    const calls: string[] = []
    const execFileFn: ExecFileFn = (file, args, _opts, cb) => {
      calls.push(file)
      if (file === gpuBinPath) {
        cb(new Error('CUDA error 999: driver mismatch'), '', '')
        return
      }
      const outBase = args[args.indexOf('-of') + 1]
      writeFileSync(`${outBase}.txt`, 'cpu результат', 'utf-8')
      cb(null, '', '')
    }
    const r = await transcribeLocal({ baseDir: dir, wavPath, execFileFn })
    expect(r).toEqual({ ok: true, text: 'cpu результат' })
    expect(calls).toEqual([gpuBinPath, binPath]) // сперва пробовали GPU, затем CPU
    expect(existsSync(gpuMarkerPath)).toBe(false) // маркер снят — дальше сразу CPU, без повторных попыток GPU
  })

  it('оба бинаря падают -> permanent с сообщением от CPU-попытки (GPU-ошибка в сообщение не попадает)', async () => {
    const { gpuDir, gpuBinPath, gpuMarkerPath } = localPaths(dir)
    mkdirSync(gpuDir, { recursive: true })
    writeFileSync(gpuBinPath, '')
    writeFileSync(gpuMarkerPath, JSON.stringify({ verifiedAt: 'x', asset: 'a' }))

    const wavPath = join(dir, 'i.wav')
    const execFileFn: ExecFileFn = (file, _args, _opts, cb) => {
      cb(new Error(file === gpuBinPath ? 'CUDA явно упала' : 'CPU тоже не смог'), '', '')
    }
    const r = await transcribeLocal({ baseDir: dir, wavPath, execFileFn })
    expect(r).toMatchObject({ ok: false, kind: 'permanent' })
    const message = (r as { ok: false; message: string }).message
    expect(message).toContain('CPU тоже не смог')
    expect(message).not.toContain('CUDA явно упала') // фолбэк молчаливый — GPU-причину наружу не показываем
  })
})

describe('pickWindowsAsset', () => {
  // реальный список ассетов релиза whisper.cpp v1.9.2 (проверено curl'ом при реализации)
  const realAssets = [
    { name: 'whisper-bin-ubuntu-arm64.tar.gz', browser_download_url: 'u1' },
    { name: 'whisper-bin-ubuntu-x64.tar.gz', browser_download_url: 'u2' },
    { name: 'whisper-bin-Win32.zip', browser_download_url: 'win32' },
    { name: 'whisper-bin-x64.zip', browser_download_url: 'cpu-x64' },
    { name: 'whisper-blas-bin-Win32.zip', browser_download_url: 'blas-win32' },
    { name: 'whisper-blas-bin-x64.zip', browser_download_url: 'blas-x64' },
    { name: 'whisper-cublas-11.8.0-bin-x64.zip', browser_download_url: 'cuda118' },
    { name: 'whisper-cublas-12.4.0-bin-x64.zip', browser_download_url: 'cuda124' },
    { name: 'whisper-v1.9.2-xcframework.zip', browser_download_url: 'mac' }
  ]

  it('выбирает BLAS x64-сборку (быстрее на CPU за счёт OpenBLAS), не cublas/cuda', () => {
    const picked = pickWindowsAsset(realAssets)
    expect(picked?.name).toBe('whisper-blas-bin-x64.zip')
  })

  it('нет BLAS-сборки в релизе -> откатывается на обычную CPU x64-сборку', () => {
    const noBlas = realAssets.filter((a) => !/blas/i.test(a.name))
    const picked = pickWindowsAsset(noBlas)
    expect(picked?.name).toBe('whisper-bin-x64.zip')
  })

  it('пустой список -> null', () => {
    expect(pickWindowsAsset([])).toBeNull()
  })

  it('нет .zip кандидатов -> null', () => {
    expect(pickWindowsAsset([{ name: 'whisper-bin-ubuntu-x64.tar.gz', browser_download_url: 'u' }])).toBeNull()
  })
})

describe('pickGpuAsset', () => {
  // тот же реальный список ассетов релиза whisper.cpp v1.9.2 (проверено GitHub API при реализации)
  const realAssets = [
    { name: 'whisper-bin-ubuntu-arm64.tar.gz', browser_download_url: 'u1' },
    { name: 'whisper-bin-ubuntu-x64.tar.gz', browser_download_url: 'u2' },
    { name: 'whisper-bin-Win32.zip', browser_download_url: 'win32' },
    { name: 'whisper-bin-x64.zip', browser_download_url: 'cpu-x64' },
    { name: 'whisper-blas-bin-Win32.zip', browser_download_url: 'blas-win32' },
    { name: 'whisper-blas-bin-x64.zip', browser_download_url: 'blas-x64' },
    { name: 'whisper-cublas-11.8.0-bin-x64.zip', browser_download_url: 'cuda118' },
    { name: 'whisper-cublas-12.4.0-bin-x64.zip', browser_download_url: 'cuda124' },
    { name: 'whisper-v1.9.2-xcframework.zip', browser_download_url: 'mac' }
  ]

  it('выбирает cublas x64-сборку с более новой CUDA (12.4, не 11.8)', () => {
    const picked = pickGpuAsset(realAssets)
    expect(picked?.name).toBe('whisper-cublas-12.4.0-bin-x64.zip')
  })

  it('только старая версия CUDA в релизе -> берёт её', () => {
    const onlyOld = realAssets.filter((a) => a.name !== 'whisper-cublas-12.4.0-bin-x64.zip')
    const picked = pickGpuAsset(onlyOld)
    expect(picked?.name).toBe('whisper-cublas-11.8.0-bin-x64.zip')
  })

  it('нет GPU-сборок в релизе -> null (не путает с CPU/BLAS-сборками)', () => {
    const noGpuAssets = realAssets.filter((a) => !/cublas/i.test(a.name))
    expect(pickGpuAsset(noGpuAssets)).toBeNull()
  })

  it('пустой список -> null', () => {
    expect(pickGpuAsset([])).toBeNull()
  })
})

describe('pickCudartAsset', () => {
  it('в реальном релизе v1.9.2 отдельного cudart-zip нет -> null (DLL уже внутри cublas-zip)', () => {
    const realAssets = [
      { name: 'whisper-bin-x64.zip', browser_download_url: 'cpu-x64' },
      { name: 'whisper-cublas-12.4.0-bin-x64.zip', browser_download_url: 'cuda124' }
    ]
    expect(pickCudartAsset(realAssets)).toBeNull()
  })

  it('если релиз положит отдельный cudart-*.zip — находит его', () => {
    const assets = [
      { name: 'whisper-cublas-12.4.0-bin-x64.zip', browser_download_url: 'cuda124' },
      { name: 'cudart-llvm-bin-x64.zip', browser_download_url: 'cudart' }
    ]
    expect(pickCudartAsset(assets)?.name).toBe('cudart-llvm-bin-x64.zip')
  })
})

describe('localStatus — кандидаты модели и апгрейд движка', () => {
  let baseDir: string
  let whisperDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'vf-wl-status-'))
    whisperDir = localPaths(baseDir).dir
    mkdirSync(whisperDir, { recursive: true })
  })

  // делает файл нужного размера без реальной записи мегабайт на диск
  function fakeFile(path: string, bytes: number): void {
    writeFileSync(path, '')
    truncateSync(path, bytes)
  }

  it('движок не скачан -> installed: false, upgradable: false, gpuReady: false', async () => {
    expect(await localStatus(baseDir, noGpu)).toEqual({
      installed: false,
      upgradable: false,
      gpuReady: false,
      gpuAvailable: false
    })
  })

  it('установлена только старая полная модель (small.bin), движок без blas-dll -> installed, upgradable', async () => {
    const { binPath, modelPaths } = localPaths(baseDir)
    fakeFile(binPath, 1024)
    fakeFile(modelPaths[1], 150 * 1024 * 1024) // ggml-small.bin — второй кандидат
    expect(await localStatus(baseDir, noGpu)).toEqual({
      installed: true,
      upgradable: true,
      gpuReady: false,
      gpuAvailable: false
    })
  })

  it('квантованная q8_0 + blas-dll рядом с движком -> installed, НЕ upgradable (уже быстрый вариант)', async () => {
    const { binPath, modelPaths } = localPaths(baseDir)
    fakeFile(binPath, 1024)
    fakeFile(modelPaths[0], 150 * 1024 * 1024) // ggml-small-q8_0.bin — первый (приоритетный) кандидат
    fakeFile(join(whisperDir, 'ggml-blas.dll'), 1024)
    expect(await localStatus(baseDir, noGpu)).toEqual({
      installed: true,
      upgradable: false,
      gpuReady: false,
      gpuAvailable: false
    })
  })

  it('gpuAvailable пробрасывается из переданной detectGpuFn независимо от установки движка', async () => {
    expect(await localStatus(baseDir, withGpu)).toMatchObject({ installed: false, gpuAvailable: true })
  })

  it('gpu-ok.json + gpu-бинарь на месте -> gpuReady: true', async () => {
    const { binPath, modelPaths, gpuDir, gpuBinPath, gpuMarkerPath } = localPaths(baseDir)
    fakeFile(binPath, 1024)
    fakeFile(modelPaths[0], 150 * 1024 * 1024)
    fakeFile(join(whisperDir, 'ggml-blas.dll'), 1024)
    mkdirSync(gpuDir, { recursive: true })
    fakeFile(gpuBinPath, 2048)
    writeFileSync(gpuMarkerPath, JSON.stringify({ verifiedAt: '2026-08-08T00:00:00.000Z', asset: 'whisper-cublas-12.4.0-bin-x64.zip' }))
    expect(await localStatus(baseDir, noGpu)).toEqual({
      installed: true,
      upgradable: false,
      gpuReady: true,
      gpuAvailable: false
    })
  })

  it('есть gpu-бинарь, но нет gpu-ok.json (smoke не пройден/не завершён) -> gpuReady: false', async () => {
    const { gpuDir, gpuBinPath } = localPaths(baseDir)
    mkdirSync(gpuDir, { recursive: true })
    fakeFile(gpuBinPath, 2048)
    expect(await localStatus(baseDir, noGpu)).toMatchObject({ gpuReady: false })
  })

  it('есть gpu-ok.json, но gpu-бинарь удалён -> gpuReady: false', async () => {
    const { gpuDir, gpuMarkerPath } = localPaths(baseDir)
    mkdirSync(gpuDir, { recursive: true })
    writeFileSync(gpuMarkerPath, JSON.stringify({ verifiedAt: 'x', asset: 'a' }))
    expect(await localStatus(baseDir, noGpu)).toMatchObject({ gpuReady: false })
  })
})

describe('downloadLocal: движок из установщика', () => {
  it('копирует exe и dll из встроенной папки, модель качает по сети', async () => {
    const { mkdtempSync, writeFileSync, existsSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const base = mkdtempSync(join(tmpdir(), 'vf-dl-'))
    const engineSrc = mkdtempSync(join(tmpdir(), 'vf-eng-'))
    writeFileSync(join(engineSrc, 'whisper-cli.exe'), 'exe')
    writeFileSync(join(engineSrc, 'whisper.dll'), 'dll')
    writeFileSync(join(engineSrc, 'readme.txt'), 'не dll — не копируется')
    const body = new Blob([new Uint8Array(2048)])
    const fetchMock = (async () =>
      new Response(body.stream(), {
        status: 200,
        headers: { 'content-length': '2048' }
      })) as unknown as typeof fetch
    const phases: string[] = []
    const { downloadLocal, localPaths } = await import('../src/main/services/whisper-local')
    await downloadLocal(base, (_pct, phase) => phases.push(phase), fetchMock, engineSrc)
    const { binPath, modelPath, dir } = localPaths(base)
    expect(existsSync(binPath)).toBe(true)
    expect(existsSync(join(dir, 'whisper.dll'))).toBe(true)
    expect(existsSync(join(dir, 'readme.txt'))).toBe(false)
    expect(existsSync(modelPath)).toBe(true)
    expect(phases).toContain('engine')
    expect(phases).toContain('model')
  })
  it('без встроенной папки движка — понятная ошибка про переустановку', async () => {
    const { mkdtempSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const { downloadLocal } = await import('../src/main/services/whisper-local')
    const base = mkdtempSync(join(tmpdir(), 'vf-dl2-'))
    const missing = join(base, 'нет-такой-папки')
    const { APP_NAME } = await import('../src/shared/app')
    await expect(downloadLocal(base, () => {}, undefined, missing)).rejects.toThrow(
      `переустановите ${APP_NAME}`
    )
  })
})
