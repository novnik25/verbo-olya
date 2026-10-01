import { JsonFileStore } from './json-store'
import { DEFAULT_SETTINGS } from '../../shared/styles-presets'
import type { Settings, SettingsPublic } from '../../shared/types'

export interface SettingsCrypto {
  encrypt(plain: string): string
  decrypt(stored: string): string
}

/**
 * Метка ключа, записанного без шифрования: Windows отказала в DPAPI.
 * Формат хранения на диске — читают и пишут его И шифровальщик, и getPublic.
 */
export const PLAIN_PREFIX = 'plain:'

export class SettingsService {
  private store: JsonFileStore<Settings>

  constructor(filePath: string, private crypto: SettingsCrypto) {
    this.store = new JsonFileStore<Settings>(filePath, DEFAULT_SETTINGS)
  }

  get(): Settings {
    return this.store.read()
  }

  getPublic(): SettingsPublic {
    const { apiKeyEncrypted, ...rest } = this.get()
    return {
      ...rest,
      hasApiKey: apiKeyEncrypted !== null,
      keyUnprotected: apiKeyEncrypted !== null && apiKeyEncrypted.startsWith(PLAIN_PREFIX)
    }
  }

  update(patch: Partial<SettingsPublic>): SettingsPublic {
    // hasApiKey и keyUnprotected — производные флаги, apiKeyEncrypted меняется только
    // через setApiKey: патч приходит по IPC нетипизированным, все три вырезаем на рантайме
    const { hasApiKey, keyUnprotected, apiKeyEncrypted, ...safePatch } =
      patch as Partial<Settings> & { hasApiKey?: boolean; keyUnprotected?: boolean }
    this.store.write({ ...this.get(), ...safePatch })
    return this.getPublic()
  }

  setApiKey(key: string): void {
    this.store.write({ ...this.get(), apiKeyEncrypted: this.crypto.encrypt(key) })
  }

  getApiKey(): string | null {
    const enc = this.get().apiKeyEncrypted
    if (enc === null) return null
    try {
      return this.crypto.decrypt(enc)
    } catch {
      return null
    }
  }
}
