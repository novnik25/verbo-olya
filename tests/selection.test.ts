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
