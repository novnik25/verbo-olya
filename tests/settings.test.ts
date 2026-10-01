import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SettingsService, type SettingsCrypto } from '../src/main/core/settings'

const fakeCrypto: SettingsCrypto = {
  encrypt: (s) => 'enc:' + s,
  decrypt: (s) => s.slice(4)
}

// как ведёт себя приложение, когда Windows отказала в шифровании (DPAPI недоступен):
// ключ уходит на диск в открытом виде под меткой 'plain:'
const plainCrypto: SettingsCrypto = {
  encrypt: (s) => 'plain:' + Buffer.from(s).toString('base64'),
  decrypt: (s) => Buffer.from(s.slice(6), 'base64').toString()
}

const freshPath = (): string => join(mkdtempSync(join(tmpdir(), 'vf-')), 's.json')
let svc: SettingsService
beforeEach(() => {
  svc = new SettingsService(freshPath(), fakeCrypto)
})

describe('SettingsService', () => {
  it('дефолты: hotkey Ctrl+Win, стиль clean, без ключа', () => {
    const s = svc.getPublic()
    expect(s.hotkey.label).toBe('Ctrl + Win')
    expect(s.defaultStyleId).toBe('verbatim')
    expect(s.sttEngine).toBe('auto')
    expect(s.autoDictionary).toBe(true)
    expect(s.outputLang).toBe('none')
    expect(s.language).toBe('ru')
    expect(s.settingsRev).toBe(4)
    expect(s.showDock).toBe(true)
    expect(s.hasApiKey).toBe(false)
    expect((s as any).apiKeyEncrypted).toBeUndefined()
  })
  it('update мержит и сохраняет', () => {
    svc.update({ language: 'ru', sounds: false })
    expect(svc.get().language).toBe('ru')
    expect(svc.get().sounds).toBe(false)
  })
  it('ключ шифруется и расшифровывается', () => {
    svc.setApiKey('gsk_123')
    expect(svc.get().apiKeyEncrypted).toBe('enc:gsk_123')
    expect(svc.getApiKey()).toBe('gsk_123')
    expect(svc.getPublic().hasApiKey).toBe(true)
  })
  it('без ключа предупреждать не о чем', () => {
    expect(svc.getPublic().keyUnprotected).toBe(false)
  })
  it('зашифрованный ключ не помечается как незащищённый', () => {
    svc.setApiKey('gsk_123')
    expect(svc.getPublic().keyUnprotected).toBe(false)
  })
  it('ключ, записанный в открытом виде, помечается как незащищённый и остаётся читаемым', () => {
    const plain = new SettingsService(freshPath(), plainCrypto)
    plain.setApiKey('gsk_123')
    expect(plain.getPublic().keyUnprotected).toBe(true)
    expect(plain.getApiKey()).toBe('gsk_123')
  })
  it('update не может перезаписать ключ', () => {
    svc.setApiKey('gsk_123')
    svc.update({ hasApiKey: false } as any)
    svc.update({ apiKeyEncrypted: 'enc:evil' } as any)
    expect(svc.getApiKey()).toBe('gsk_123')
  })
})
