// Скрытое окно записи: MediaRecorder -> чанки в main по IPC + уровень звука + бипы.
const api = (window as unknown as { voxflow: import('../../preload/index').VoxflowApi }).voxflow

let rec: MediaRecorder | null = null
let stream: MediaStream | null = null
let audioCtx: AudioContext | null = null
let levelTimer: number | null = null
let startedAt = 0
let pending: Promise<void> = Promise.resolve()

/**
 * Куда играть звук: 'default' — системное устройство, иначе deviceId колонок или
 * наушников из настроек. Значение приходит с каждой командой воспроизведения, так
 * что выбор в настройках подхватывается без перезапуска приложения.
 */
let outputDeviceId = 'default'

function rememberOutput(deviceId?: string): void {
  if (deviceId) outputDeviceId = deviceId
}

/** Мягкий короткий сигнал: синус с плавной огибающей и лёгким глиссандо, без резкого писка. */
function chime(fromHz: number, toHz: number): void {
  // выбранное устройство просим прямо у контекста; не вышло (устройство отключили,
  // браузер не поддержал) — играем в системное, сигнал важнее точности адреса
  let ctx: AudioContext
  try {
    ctx =
      outputDeviceId && outputDeviceId !== 'default'
        ? new AudioContext({ sinkId: outputDeviceId } as AudioContextOptions)
        : new AudioContext()
  } catch {
    ctx = new AudioContext()
  }
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const t = ctx.currentTime
  osc.type = 'sine'
  osc.frequency.setValueAtTime(fromHz, t)
  osc.frequency.exponentialRampToValueAtTime(toHz, t + 0.12)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.035, t + 0.03)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.2)
  osc.onended = () => void ctx.close()
}

// стоп мог прийти, пока микрофон ещё открывается (короткое нажатие на холодном старте)
let stopRequested = false

api.on('rec:start', async (payload) => {
  const { deviceId, sounds, playbackDeviceId } = payload as {
    deviceId: string
    sounds: boolean
    playbackDeviceId?: string
  }
  rememberOutput(playbackDeviceId)
  stopRequested = false
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    })
  } catch {
    api.recStopped({ durationMs: -1 }) // сигнал «нет микрофона»
    return
  }
  audioCtx = new AudioContext()
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 512
  audioCtx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Uint8Array(analyser.frequencyBinCount)
  const sendLevel = (): void => {
    analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += (v - 128) ** 2
    api.recLevel(Math.min(1, Math.sqrt(sum / buf.length) / 40))
  }
  sendLevel() // первый замер сразу, не дожидаясь тика — анимация оживает мгновенно
  levelTimer = window.setInterval(sendLevel, 80)

  rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
  rec.ondataavailable = (e) => {
    pending = pending.then(async () => {
      if (e.data.size > 0) api.recChunk(await e.data.arrayBuffer())
    })
  }
  rec.onstop = async () => {
    await pending
    api.recStopped({ durationMs: Math.round(performance.now() - startedAt) })
    if (sounds) chime(523, 392)
    cleanup()
  }
  startedAt = performance.now()
  rec.start(250)
  if (sounds) chime(392, 523)
  if (stopRequested) {
    // клавишу отпустили, пока открывался микрофон — останавливаем сразу,
    // MediaRecorder успеет выдать короткий, но валидный файл
    stopRequested = false
    rec.stop()
  }
})

api.on('rec:stop', () => {
  if (rec && rec.state !== 'inactive') rec.stop()
  else stopRequested = true
})

function cleanup(): void {
  if (levelTimer) clearInterval(levelTimer)
  levelTimer = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  void audioCtx?.close()
  audioCtx = null
  rec = null
  pending = Promise.resolve()
}

// Конвертация webm -> wav 16 кГц моно PCM16 для локального распознавания (whisper.cpp).
const LOCAL_SAMPLE_RATE = 16000

function writeAsciiString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

/** Собирает WAV-файл (44-байтный RIFF-заголовок + PCM16 данные) из моно AudioBuffer. */
function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const channel = buffer.getChannelData(0)
  const dataSize = channel.length * 2 // 16 бит = 2 байта на семпл
  const out = new ArrayBuffer(44 + dataSize)
  const view = new DataView(out)

  writeAsciiString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAsciiString(view, 8, 'WAVE')
  writeAsciiString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // размер fmt-чанка
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 1 канал
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * 2, true) // byte rate (моно, 16 бит)
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // бит на семпл
  writeAsciiString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < channel.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, channel[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out
}

// Озвучивание (Stage 2): main шлёт готовый MP3, здесь просто проигрываем через <audio>.
let ttsAudio: HTMLAudioElement | null = null
let ttsId: string | null = null
let ttsUrl: string | null = null
// «Пауза» может прийти, пока фрагмент выбирает устройство воспроизведения: без
// этого флага он всё равно зазвучал бы — кнопка паузы срабатывала бы через раз
let ttsPaused = false

function ttsCleanup(): void {
  if (ttsAudio) {
    ttsAudio.onended = null
    ttsAudio.onerror = null
    ttsAudio.pause()
    ttsAudio.src = ''
  }
  if (ttsUrl) URL.revokeObjectURL(ttsUrl)
  ttsAudio = null
  ttsUrl = null
  ttsId = null
  ttsPaused = false
}

/**
 * Направляет звук в выбранное устройство. Отказ не считаем сбоем чтения: колонки
 * могли отключить, а deviceId — протухнуть после смены оборудования. Тогда фрагмент
 * прозвучит в устройстве по умолчанию, но прозвучит — молчание было бы хуже.
 */
async function routeTo(audio: HTMLAudioElement, deviceId: string): Promise<void> {
  if (!deviceId || deviceId === 'default') return
  const el = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  if (!el.setSinkId) return
  try {
    await el.setSinkId(deviceId)
  } catch {
    /* играем в устройство по умолчанию */
  }
}

api.on('tts:play', async (payload) => {
  const { id, mp3, deviceId } = payload as { id: string; mp3: ArrayBuffer; deviceId?: string }
  rememberOutput(deviceId)
  ttsCleanup()
  ttsId = id
  ttsUrl = URL.createObjectURL(new Blob([mp3], { type: 'audio/mpeg' }))
  const audio = new Audio(ttsUrl)
  ttsAudio = audio
  const finish = (): void => {
    const finishedId = ttsId
    ttsCleanup()
    if (finishedId) api.ttsEnded({ id: finishedId })
  }
  audio.onended = finish
  audio.onerror = finish
  await routeTo(audio, outputDeviceId)
  // пока выбиралось устройство, фрагмент могли остановить, сменить или поставить
  // на паузу: играть старый было бы наложением двух голосов, а на паузе — побегом
  if (ttsAudio !== audio || ttsPaused) return
  void audio.play()
})

api.on('tts:control', (payload) => {
  const { action } = payload as { action: 'pause' | 'resume' | 'stop' }
  if (!ttsAudio) return
  if (action === 'pause') {
    ttsPaused = true
    ttsAudio.pause()
  } else if (action === 'resume') {
    ttsPaused = false
    void ttsAudio.play()
  } else if (action === 'stop') {
    const stoppedId = ttsId
    ttsCleanup()
    if (stoppedId) api.ttsEnded({ id: stoppedId })
  }
})

api.on('rec:convert', async (payload) => {
  const { id, data } = payload as { id: string; data: ArrayBuffer }
  try {
    const ctx = new AudioContext()
    const decoded = await ctx.decodeAudioData(data)
    void ctx.close()
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * LOCAL_SAMPLE_RATE),
      LOCAL_SAMPLE_RATE
    )
    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start()
    const rendered = await offline.startRendering()
    api.recConverted({ id, wav: encodeWav(rendered) })
  } catch {
    api.recConverted({ id, wav: null })
  }
})
