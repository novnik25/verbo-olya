import { describe, it, expect } from 'vitest'
import { packKeyFile, unpackKeyFile, MIN_PASSPHRASE, DEFAULT_ITERATIONS } from '../src/main/core/key-file'

const KEY = 'gsk_очень_секретный_ключ_12345'
const PASS = 'верный конь батарейка скоба'
// в тестах считаем медленную функцию по-быстрому: стойкость проверяется отдельно
const FAST = 1000

describe('файл переноса ключа', () => {
  it('ключа не видно в получившемся файле', () => {
    const file = packKeyFile(KEY, PASS, FAST)
    expect(file).not.toContain(KEY)
    expect(Buffer.from(file.split(':')[1], 'base64').toString('utf8')).not.toContain(KEY)
  })

  it('верная фраза возвращает ключ', () => {
    const r = unpackKeyFile(packKeyFile(KEY, PASS, FAST), PASS)
    expect(r).toEqual({ ok: true, key: KEY })
  })

  it('неверная фраза ключ не отдаёт', () => {
    const r = unpackKeyFile(packKeyFile(KEY, PASS, FAST), 'фраза не та')
    expect(r).toEqual({ ok: false, reason: 'wrong-passphrase' })
  })

  it('два экспорта одного ключа дают разные файлы', () => {
    expect(packKeyFile(KEY, PASS, FAST)).not.toBe(packKeyFile(KEY, PASS, FAST))
  })

  it('подделанный файл не принимается даже с верной фразой', () => {
    const file = packKeyFile(KEY, PASS, FAST)
    const body = Buffer.from(file.slice('VFKEY2:'.length), 'base64')
    body[body.length - 1] ^= 0xff // портим последний байт шифротекста
    const r = unpackKeyFile('VFKEY2:' + body.toString('base64'), PASS)
    expect(r).toEqual({ ok: false, reason: 'wrong-passphrase' })
  })

  it('обрезанный файл распознаётся как повреждённый', () => {
    expect(unpackKeyFile('VFKEY2:' + Buffer.from('коротко').toString('base64'), PASS)).toEqual({
      ok: false,
      reason: 'damaged'
    })
  })

  it('посторонний текст распознаётся как повреждённый', () => {
    expect(unpackKeyFile('просто какой-то текст', PASS)).toEqual({ ok: false, reason: 'damaged' })
  })

  it('файлы старого формата ещё читаются — иначе перенос сломается', () => {
    const старый = 'VFKEY1:' + Buffer.from(KEY).toString('base64')
    expect(unpackKeyFile(старый, '')).toEqual({ ok: true, key: KEY })
  })

  it('слишком короткая фраза не принимается', () => {
    expect(() => packKeyFile(KEY, 'abc', FAST)).toThrow(/фраз/i)
  })

  it('по умолчанию перебор фразы стоит дорого', () => {
    expect(DEFAULT_ITERATIONS).toBeGreaterThanOrEqual(600_000)
    expect(MIN_PASSPHRASE).toBeGreaterThanOrEqual(8)
  })

  it('число итераций хранится в файле, поэтому его можно поднять позже', () => {
    // файл, упакованный с одними итерациями, читается без подсказки извне
    const r = unpackKeyFile(packKeyFile(KEY, PASS, 2048), PASS)
    expect(r).toEqual({ ok: true, key: KEY })
  })
})
