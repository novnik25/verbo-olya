import { describe, it, expect } from 'vitest'
import { makeKeyCrypto, type KeyCryptoDeps } from '../src/main/core/key-crypto'

/** Подделка Windows: шифрование либо есть, либо Windows в нём отказала. */
function deps(available: boolean): KeyCryptoDeps & { warnings: string[] } {
  const warnings: string[] = []
  return {
    warnings,
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('DPAPI|' + s),
    decryptString: (b) => b.toString().slice(6),
    warn: (m) => warnings.push(m)
  }
}

describe('makeKeyCrypto', () => {
  it('шифрование доступно: ключ уходит зашифрованным и молча', () => {
    const d = deps(true)
    const stored = makeKeyCrypto(d).encrypt('gsk_123')
    expect(stored.startsWith('plain:')).toBe(false)
    expect(d.warnings).toEqual([])
  })

  it('шифрование доступно: зашифрованное читается обратно', () => {
    const d = deps(true)
    const c = makeKeyCrypto(d)
    expect(c.decrypt(c.encrypt('gsk_123'))).toBe('gsk_123')
  })

  it('Windows отказала: ключ помечается как открытый', () => {
    const d = deps(false)
    expect(makeKeyCrypto(d).encrypt('gsk_123').startsWith('plain:')).toBe(true)
  })

  it('Windows отказала: в журнал попадает предупреждение', () => {
    const d = deps(false)
    makeKeyCrypto(d).encrypt('gsk_123')
    expect(d.warnings).toHaveLength(1)
    expect(d.warnings[0]).toMatch(/шифров/i)
  })

  it('Windows отказала: сам ключ в журнал не попадает', () => {
    const d = deps(false)
    makeKeyCrypto(d).encrypt('gsk_секрет')
    expect(d.warnings.join(' ')).not.toContain('gsk_секрет')
  })

  it('открыто сохранённый ключ читается обратно', () => {
    const d = deps(false)
    const c = makeKeyCrypto(d)
    expect(c.decrypt(c.encrypt('gsk_123'))).toBe('gsk_123')
  })

  it('ключ, сохранённый до отказа шифрования, читается и после него', () => {
    const было = makeKeyCrypto(deps(true)).encrypt('gsk_123')
    // Windows отказала уже после сохранения — старое значение обязано открываться
    expect(makeKeyCrypto(deps(false)).decrypt(было)).toBe('gsk_123')
  })
})
