import { PLAIN_PREFIX, type SettingsCrypto } from './settings'

export interface KeyCryptoDeps {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(stored: Buffer): string
  warn(message: string): void
}

/**
 * Хранение ключа доступа: обычно его шифрует сама Windows (DPAPI, привязка к
 * учётной записи). Если Windows в шифровании отказала, ключ всё равно надо
 * сохранить — иначе приложение просто перестанет работать. Но тогда он лежит
 * на диске открытым, и об этом обязаны узнать оба: журнал и пользователь.
 * Раньше подмена происходила молча — отсюда эта обёртка.
 */
export function makeKeyCrypto(deps: KeyCryptoDeps): SettingsCrypto {
  return {
    encrypt: (plain) => {
      if (deps.isEncryptionAvailable()) return deps.encryptString(plain).toString('base64')
      // в журнал уходит только факт, никогда сам ключ
      deps.warn(
        'Windows отказала в шифровании: ключ доступа сохранён на диске в открытом виде'
      )
      return PLAIN_PREFIX + Buffer.from(plain).toString('base64')
    },
    // читаем обе формы: ключ мог быть сохранён, когда шифрование ещё работало
    decrypt: (stored) =>
      stored.startsWith(PLAIN_PREFIX)
        ? Buffer.from(stored.slice(PLAIN_PREFIX.length), 'base64').toString()
        : deps.decryptString(Buffer.from(stored, 'base64'))
  }
}
