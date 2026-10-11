import { describe, it, expect } from 'vitest'
import { captureSelection } from '../src/main/services/selection'

function fakeClipboard(initial: string) {
  let clip = initial
  return {
    clipboard: {
      readText: () => clip,
      writeText: (t: string) => {
        clip = t
      }
    },
    setClip: (t: string) => {
      clip = t
    },
    getClip: () => clip
  }
}

describe('captureSelection', () => {
  it('Windows обрезает NUL, а копирование приходит позже первого опроса', async () => {
    let clip = 'старое'
    let ticks = 0
    const result = await captureSelection({
      clipboard: { readText: () => clip, writeText: (text) => { clip = text.split('\0')[0] } },
      sendCopy: async () => {},
      delay: async () => { if (++ticks === 5) clip = 'выделено в Windows' }
    })
    expect(result).toBe('выделено в Windows')
    expect(clip).toBe('старое')
  })

  it('промежуточное очищение буфера не считается завершением копирования', async () => {
    const f = fakeClipboard('старое')
    let ticks = 0
    const result = await captureSelection({
      clipboard: f.clipboard,
      sendCopy: async () => f.setClip(''),
      delay: async () => { if (++ticks === 3) f.setClip('выделено') }
    })
    expect(result).toBe('выделено')
  })

  it('ошибка нажатия не оставляет служебную метку в буфере', async () => {
    const f = fakeClipboard('старое')
    await expect(captureSelection({
      clipboard: f.clipboard,
      sendCopy: async () => { throw new Error('ошибка клавиатуры') }
    })).rejects.toThrow('ошибка клавиатуры')
    expect(f.getClip()).toBe('старое')
  })

  it('одновременные захваты не подменяют метку и прежний буфер друг друга', async () => {
    const f = fakeClipboard('старое')
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const order: number[] = []
    const first = captureSelection({
      clipboard: f.clipboard,
      sendCopy: async () => { order.push(1); await gate; f.setClip('первое') },
      delay: async () => {}
    })
    const second = captureSelection({
      clipboard: f.clipboard,
      sendCopy: async () => { order.push(2); f.setClip('второе') },
      delay: async () => {}
    })
    await Promise.resolve()
    expect(order).toEqual([1])
    release()
    expect(await Promise.all([first, second])).toEqual(['первое', 'второе'])
    expect(f.getClip()).toBe('старое')
  })

  it('копирование сработало -> возвращает текст и восстанавливает прежний буфер', async () => {
    const f = fakeClipboard('старое')
    const r = await captureSelection({
      clipboard: f.clipboard,
      sendCopy: async () => f.setClip('выделенный текст'),
      delay: async () => {}
    })
    expect(r).toBe('выделенный текст')
    expect(f.getClip()).toBe('старое')
  })

  it('выделения не было (метка осталась) -> пустая строка, буфер цел', async () => {
    const f = fakeClipboard('старое')
    const r = await captureSelection({
      clipboard: f.clipboard,
      sendCopy: async () => {},
      delay: async () => {}
    })
    expect(r).toBe('')
    expect(f.getClip()).toBe('старое')
  })

  it('выделённый текст совпадает с содержимым буфера (Ctrl+C ×2) -> всё равно возвращается', async () => {
    // ключевой случай: пользователь сам скопировал этот текст первым нажатием
    const f = fakeClipboard('привет мир')
    const r = await captureSelection({
      clipboard: f.clipboard,
      sendCopy: async () => f.setClip('привет мир'),
      delay: async () => {}
    })
    expect(r).toBe('привет мир')
    expect(f.getClip()).toBe('привет мир')
  })

  it('медленное приложение: текст появляется через несколько тиков ожидания', async () => {
    const f = fakeClipboard('старое')
    let ticks = 0
    const r = await captureSelection({
      clipboard: f.clipboard,
      sendCopy: async () => {},
      delay: async () => {
        ticks++
        if (ticks === 5) f.setClip('поздний текст')
      }
    })
    expect(r).toBe('поздний текст')
    expect(f.getClip()).toBe('старое')
  })

  it('ждёт между попытками чтения буфера', async () => {
    const f = fakeClipboard('старое')
    let waited = 0
    await captureSelection({
      clipboard: f.clipboard,
      sendCopy: async () => f.setClip('новое'),
      delay: async (ms) => {
        waited = ms
      }
    })
    expect(waited).toBeGreaterThan(0)
  })
})
