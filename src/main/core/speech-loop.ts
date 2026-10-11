export interface SpeechLoopDeps {
  /** Текст, разбитый на фрагменты для синтеза. */
  chunks: string[]
  /** Синтез фрагмента по номеру. Может быть вызван для одного номера дважды. */
  synth: (index: number) => Promise<Buffer>
  /** Воспроизведение готового фрагмента; завершается, когда он отзвучал. */
  play: (audio: Buffer) => Promise<void>
  /** Идёт ли чтение. «Стоп» гасит его снаружи, прямо посреди фрагмента. */
  active: () => boolean
  /** Просили перечитать текущий фрагмент — сменили голос или темп на ходу. */
  restarted: () => boolean
  clearRestart: () => void
  /** Короче этого ответ считается пустым и переспрашивается. */
  minBytes: number
  /** Отметка о первом зазвучавшем фрагменте — для журнала. */
  onFirst?: () => void
  /**
   * Сколько фрагментов дочитано — сообщается сразу после каждого. Нужно, чтобы
   * прочитанное было сосчитано даже если голос отвалится на середине: возврата
   * из функции в этом случае не будет.
   */
  onProgress?: (done: number) => void
  log?: (message: string) => void
}

/**
 * Цикл чтения вслух: синтезирует фрагменты, играет их по очереди и умеет
 * останавливаться на полуслове. Жил внутри speakText в главном процессе, где
 * его нечем было проверить, — а логика тут нетривиальная:
 *
 * - следующий фрагмент синтезируется, ПОКА звучит текущий, иначе между
 *   фрагментами слышны паузы;
 * - пустой ответ сервиса звучал как проглоченная строка, поэтому его
 *   переспрашивают один раз (но не после «Стоп» — результат некуда девать);
 * - смена голоса или темпа на ходу заставляет перечитать тот же фрагмент
 *   заново и выбросить уже начатую предзагрузку следующего.
 *
 * Возвращает число ДОЧИТАННЫХ фрагментов: по нему считается, сколько текста
 * действительно прозвучало. Ошибку синтеза пробрасывает наружу.
 */
export async function runSpeechLoop(deps: SpeechLoopDeps): Promise<number> {
  let done = 0
  const ready = new Map<number, Promise<Buffer>>()
  const prepare = (index: number): Promise<Buffer> => {
    let result = ready.get(index)
    if (!result) {
      result = deps.synth(index)
      result.catch(() => {})
      ready.set(index, result)
    }
    return result
  }

  while (done < deps.chunks.length && deps.active()) {
    deps.clearRestart()
    const current = prepare(done)
    if (done + 1 < deps.chunks.length) prepare(done + 1)
    let part: Buffer
    try {
      part = await current
      if (part.length < deps.minBytes && deps.active() && !deps.restarted()) {
        deps.log?.(`озвучка: фрагмент ${done} пришёл пустым (${part.length} б) — повтор`)
        part = await deps.synth(done)
      }
    } catch (err) {
      if (!deps.active()) break
      if (!deps.restarted()) throw err
      ready.clear()
      continue
    }
    if (!deps.active()) break
    if (deps.restarted()) { ready.clear(); continue }
    // Первый короткий кусок уже готов: освобождённое соединение заранее готовит
    // ещё один. Так сетевой скачок не оставляет паузу после следующей точки.
    if (done + 2 < deps.chunks.length) prepare(done + 2)

    if (done === 0) deps.onFirst?.()
    await deps.play(part)

    if (deps.restarted()) {
      // этот же фрагмент читаем заново; уже начатая предзагрузка не годится —
      // она синтезирована прежним голосом
      ready.clear()
      continue
    }
    ready.delete(done)
    done++
    deps.onProgress?.(done)
  }
  return done
}
