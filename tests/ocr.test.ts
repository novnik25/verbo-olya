import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { recognizeImage, recognizeImageBuffer, tidyOcrText } from '../src/main/services/ocr'
import type { OcrRunner } from '../src/main/services/ocr'

function runner(steps: Array<{ code: number; stdout?: string; stderr?: string }>): {
  run: OcrRunner
  calls: string[][]
} {
  const calls: string[][] = []
  let i = 0
  const run: OcrRunner = async (args) => {
    calls.push(args)
    const step = steps[Math.min(i++, steps.length - 1)]
    return { code: step.code, stdout: step.stdout ?? '', stderr: step.stderr ?? '' }
  }
  return { run, calls }
}

describe('tidyOcrText', () => {
  it('склеивает строки, разорванные макетом', () => {
    expect(tidyOcrText('Это длинное предложение\nразорванное переносом')).toBe(
      'Это длинное предложение разорванное переносом'
    )
  })

  it('сохраняет отдельные предложения и заголовки', () => {
    expect(tidyOcrText('Заголовок\nПервое предложение.\nВторое предложение.')).toBe(
      'Заголовок\nПервое предложение.\nВторое предложение.'
    )
  })

  it('выбрасывает пустые строки и пробелы', () => {
    expect(tidyOcrText('  Текст  \n\n\n   \nЕщё текст')).toBe('Текст\nЕщё текст')
  })
})

describe('recognizeImage', () => {
  it('возвращает распознанный русский текст с первой попытки', async () => {
    const { run, calls } = runner([{ code: 0, stdout: 'Проверка распознавания текста' }])
    const res = await recognizeImage({ imagePath: 'a.png', run })
    expect(res).toMatchObject({ ok: true, text: 'Проверка распознавания текста' })
    expect(calls).toHaveLength(1) // повтор с английским движком не нужен
  })

  it('латиницу перечитывает английским движком', async () => {
    const { run, calls } = runner([
      { code: 0, stdout: 'Непо from the picture' },
      { code: 0, stdout: 'Hello from the picture' }
    ])
    const res = await recognizeImage({ imagePath: 'a.png', run })
    expect(res.text).toBe('Hello from the picture')
    expect(calls[1]).toContain('-Lang')
  })

  it('путь приводится к обратным слэшам — WinRT не принимает «/»', async () => {
    const { run, calls } = runner([{ code: 0, stdout: 'Текст' }])
    await recognizeImage({ imagePath: 'C:/tmp/a b/ocr.png', run })
    expect(calls[0]).toEqual(['-Path', 'C:\\tmp\\a b\\ocr.png'])
  })

  it('движок недоступен -> понятное сообщение', async () => {
    const { run } = runner([{ code: 2 }])
    const res = await recognizeImage({ imagePath: 'a.png', run })
    expect(res.ok).toBe(false)
    expect(res.message).toContain('недоступно')
  })

  it('пустой результат -> сообщение, а не пустой успех', async () => {
    const { run } = runner([{ code: 0, stdout: '   \n' }])
    const res = await recognizeImage({ imagePath: 'a.png', run })
    expect(res).toMatchObject({ ok: false, message: 'На изображении не найдено текста' })
  })

  it('движок недоступен -> помечаем это отдельно, чтобы окно могло помочь', async () => {
    const { run } = runner([{ code: 2 }])
    const res = await recognizeImage({ imagePath: 'a.png', run })
    expect(res.engineMissing).toBe(true)
  })

  it('прочая ошибка движком недоступным не считается', async () => {
    const { run } = runner([{ code: 1, stderr: 'что-то пошло не так' }])
    const res = await recognizeImage({ imagePath: 'a.png', run })
    expect(res.ok).toBe(false)
    expect(res.engineMissing).toBeFalsy()
  })
})

describe('запасной путь распознавания, когда движка Windows нет', () => {
  const tmp = (): string => mkdtempSync(join(tmpdir(), 'vf-ocr-'))
  const картинка = Buffer.from([0x89, 0x50, 0x4e, 0x47])

  it('движка нет, облако справилось -> берём текст из облака', async () => {
    const { run } = runner([{ code: 2 }])
    const res = await recognizeImageBuffer({
      data: картинка,
      tmpDir: tmp(),
      run,
      cloud: async () => ({ ok: true, text: 'Текст, прочитанный в облаке' })
    })
    expect(res).toMatchObject({ ok: true, text: 'Текст, прочитанный в облаке' })
  })

  it('облако получает ровно ту картинку, что прислали', async () => {
    const { run } = runner([{ code: 2 }])
    let увидело: Buffer | null = null
    await recognizeImageBuffer({
      data: картинка,
      tmpDir: tmp(),
      run,
      cloud: async (img) => {
        увидело = img
        return { ok: true, text: 'ок' }
      }
    })
    expect(увидело!.equals(картинка)).toBe(true)
  })

  it('движка нет и резерва нет -> объясняем, чего не хватает системе', async () => {
    const { run } = runner([{ code: 2 }])
    const res = await recognizeImageBuffer({ data: картинка, tmpDir: tmp(), run })
    expect(res.ok).toBe(false)
    expect(res.engineMissing).toBe(true)
    expect(res.message).toMatch(/язык/i) // подсказка про языковой пакет распознавания
  })

  it('движка нет, облако тоже не смогло -> остаётся объяснение про систему', async () => {
    const { run } = runner([{ code: 2 }])
    const res = await recognizeImageBuffer({
      data: картинка,
      tmpDir: tmp(),
      run,
      cloud: async () => ({ ok: false, message: 'нет соединения' })
    })
    expect(res.ok).toBe(false)
    expect(res.engineMissing).toBe(true)
  })

  it('движок работает -> в облако не ходим вовсе', async () => {
    const { run } = runner([{ code: 0, stdout: 'Местное распознавание' }])
    let ходили = false
    const res = await recognizeImageBuffer({
      data: картинка,
      tmpDir: tmp(),
      run,
      cloud: async () => {
        ходили = true
        return { ok: true, text: 'из облака' }
      }
    })
    expect(res).toMatchObject({ ok: true, text: 'Местное распознавание' })
    expect(ходили).toBe(false)
  })

  it('движок работает, но текста нет -> тоже не ходим в облако', async () => {
    const { run } = runner([{ code: 0, stdout: '  \n' }])
    let ходили = false
    await recognizeImageBuffer({
      data: картинка,
      tmpDir: tmp(),
      run,
      cloud: async () => {
        ходили = true
        return { ok: true, text: 'из облака' }
      }
    })
    expect(ходили).toBe(false)
  })
})
