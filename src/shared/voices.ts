import { cyrShare } from './lang'

/**
 * Голоса озвучивания (Stage 2). Вынесено в shared, а не в main/services/tts.ts,
 * чтобы список могли использовать и main (синтез), и renderer (селекты в настройках)
 * без затягивания msedge-tts (Node-only, ws/axios) в бандл рендерера.
 * src/main/services/tts.ts реэкспортирует всё отсюда.
 */
export interface VoiceInfo {
  id: string
  label: string
  lang: 'ru' | 'en'
  gender: 'f' | 'm'
}

export const RU_VOICES: VoiceInfo[] = [
  { id: 'ru-RU-SvetlanaNeural', label: 'Светлана (женский)', lang: 'ru', gender: 'f' },
  { id: 'ru-RU-DmitryNeural', label: 'Дмитрий (мужской)', lang: 'ru', gender: 'm' }
]

export const EN_VOICES: VoiceInfo[] = [
  { id: 'en-US-AriaNeural', label: 'Aria (женский)', lang: 'en', gender: 'f' },
  { id: 'en-US-GuyNeural', label: 'Guy (мужской)', lang: 'en', gender: 'm' }
]

export const VOICES: VoiceInfo[] = [...RU_VOICES, ...EN_VOICES]

export function voiceLabel(id: string): string {
  return VOICES.find((v) => v.id === id)?.label ?? id
}

/**
 * Выбирает голос по доле кириллицы в тексте: кириллица > 0.3 -> русский голос,
 * иначе английский. Чистая функция, без обращения к сети.
 */
export function pickVoice(text: string, preferredRu: string, preferredEn: string): string {
  return cyrShare(text) > 0.3 ? preferredRu : preferredEn
}
