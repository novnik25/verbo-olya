import { describe, it, expect } from 'vitest'
import { runSpeechLoop } from '../src/main/core/speech-loop'

/** Стенд: подделывает синтез и воспроизведение, записывает порядок событий. */
function стенд(opts: {
  chunks: string[]
  /** сколько байт вернёт синтез для данного фрагмента и попытки */
  bytes?: (index: number, попытка: number) => number
  /** что сделать во время воспроизведения фрагмента */
  наИгре?: (index: number, ctx: { стоп: () => void; переиграть: () => void }) => void
}) {
  const события: string[] = []
  const попытки = new Map<number, number>()
  let активно = true
  let перезапуск = false

  const ctx = {
    стоп: () => {
      активно = false
    },
    переиграть: () => {
      перезапуск = true
    }
  }

  return {
    события,
    итог: runSpeechLoop({
      chunks: opts.chunks,
      minBytes: 10,
      synth: async (i) => {
        const n = (попытки.get(i) ?? 0) + 1
        попытки.set(i, n)
        события.push(`синтез:${i}#${n}`)
        // номер фрагмента кладём прямо в буфер: так воспроизведение точно знает,
        // что именно ему дали, и перечитывание не путает индексы
        const buf = Buffer.alloc(opts.bytes ? opts.bytes(i, n) : 100)
        buf[0] = i
        return buf
      },
      play: async (buf) => {
        const i = buf[0]
        события.push(`игра:${i}`)
        opts.наИгре?.(i, ctx)
      },
      active: () => активно,
      restarted: () => перезапуск,
      clearRestart: () => {
        перезапуск = false
      }
    })
  }
}

describe('цикл чтения вслух', () => {
  it('дочитывает все фрагменты и сообщает их число', async () => {
    const s = стенд({ chunks: ['раз', 'два', 'три'] })
    expect(await s.итог).toBe(3)
    expect(s.события.filter((e) => e.startsWith('игра')).length).toBe(3)
  })

  it('следующий фрагмент синтезируется, пока звучит текущий', async () => {
    const s = стенд({ chunks: ['раз', 'два'] })
    await s.итог
    // синтез второго обязан начаться ДО того, как отыграет первый
    expect(s.события.indexOf('синтез:1#1')).toBeLessThan(s.события.indexOf('игра:0'))
  })

  it('каждый фрагмент синтезируется по одному разу, если всё в порядке', async () => {
    const s = стенд({ chunks: ['раз', 'два', 'три'] })
    await s.итог
    expect(s.события.filter((e) => e.startsWith('синтез')).length).toBe(3)
  })

  it('«Стоп» на первом фрагменте: дальше не читаем, засчитан один', async () => {
    const s = стенд({
      chunks: ['раз', 'два', 'три'],
      наИгре: (i, ctx) => {
        if (i === 0) ctx.стоп()
      }
    })
    expect(await s.итог).toBe(1)
    expect(s.события.filter((e) => e.startsWith('игра')).length).toBe(1)
  })

  it('пустой ответ синтеза переспрашивается', async () => {
    const s = стенд({
      chunks: ['раз'],
      bytes: (_i, попытка) => (попытка === 1 ? 2 : 100) // первый раз пришло почти пусто
    })
    expect(await s.итог).toBe(1)
    expect(s.события).toContain('синтез:0#2')
  })

  it('пустой ответ не переспрашивается, если чтение уже остановили', async () => {
    const s = стенд({
      chunks: ['раз', 'два'],
      bytes: (i, попытка) => (i === 1 && попытка === 1 ? 2 : 100),
      наИгре: (i, ctx) => {
        if (i === 0) ctx.стоп() // остановили, пока звучал первый
      }
    })
    await s.итог
    expect(s.события).not.toContain('синтез:1#2')
  })

  it('смена голоса на ходу заставляет перечитать тот же фрагмент', async () => {
    let разПереиграли = false
    const s = стенд({
      chunks: ['раз', 'два'],
      наИгре: (i, ctx) => {
        if (i === 0 && !разПереиграли) {
          разПереиграли = true
          ctx.переиграть()
        }
      }
    })
    expect(await s.итог).toBe(2)
    // первый фрагмент прозвучал дважды, но в счёт вошёл один раз
    expect(s.события.filter((e) => e.startsWith('игра')).length).toBe(3)
  })

  it('пустой список фрагментов — ничего не делаем', async () => {
    const s = стенд({ chunks: [] })
    expect(await s.итог).toBe(0)
    expect(s.события).toEqual([])
  })

  it('о каждом дочитанном фрагменте сообщается сразу', async () => {
    const ход: number[] = []
    await runSpeechLoop({
      chunks: ['раз', 'два', 'три'],
      minBytes: 10,
      synth: async () => Buffer.alloc(100),
      play: async () => {},
      active: () => true,
      restarted: () => false,
      clearRestart: () => {},
      onProgress: (n) => ход.push(n)
    })
    expect(ход).toEqual([1, 2, 3])
  })

  it('сбой на середине: прочитанное до него уже сосчитано', async () => {
    // счётчик минут не должен обнуляться из-за того, что голос отвалился на третьем
    const ход: number[] = []
    await expect(
      runSpeechLoop({
        chunks: ['раз', 'два', 'три'],
        minBytes: 10,
        synth: async (i) => {
          if (i === 2) throw new Error('голос отвалился')
          return Buffer.alloc(100)
        },
        play: async () => {},
        active: () => true,
        restarted: () => false,
        clearRestart: () => {},
        onProgress: (n) => ход.push(n)
      })
    ).rejects.toThrow('голос отвалился')
    // первые два успели отыграть: падает предзагрузка третьего, а не сам второй
    expect(ход).toEqual([1, 2])
  })

  it('ошибка синтеза выбрасывается наружу, а не глотается', async () => {
    await expect(
      runSpeechLoop({
        chunks: ['раз'],
        minBytes: 10,
        synth: async () => {
          throw new Error('голос не дали')
        },
        play: async () => {},
        active: () => true,
        restarted: () => false,
        clearRestart: () => {}
      })
    ).rejects.toThrow('голос не дали')
  })
})
