import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { JsonFileStore } from '../src/main/core/json-store'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'voxflow-')) })

describe('JsonFileStore', () => {
  it('возвращает дефолты, если файла нет', () => {
    const s = new JsonFileStore(join(dir, 'x.json'), { a: 1, b: 'x' })
    expect(s.read()).toEqual({ a: 1, b: 'x' })
  })
  it('пишет и читает, дополняя новыми дефолтами', () => {
    const p = join(dir, 'x.json')
    new JsonFileStore(p, { a: 1 }).write({ a: 5 })
    expect(new JsonFileStore(p, { a: 1, b: 2 } as any).read()).toEqual({ a: 5, b: 2 })
  })
  it('пишет атомарно (нет .tmp после записи)', () => {
    const p = join(dir, 'x.json')
    const s = new JsonFileStore(p, { a: 1 })
    s.write({ a: 2 })
    expect(existsSync(p + '.tmp')).toBe(false)
    expect(JSON.parse(readFileSync(p, 'utf-8'))).toEqual({ a: 2 })
  })
  it('битый JSON -> дефолты', () => {
    const p = join(dir, 'x.json')
    const s = new JsonFileStore(p, { a: 1 })
    require('fs').writeFileSync(p, '{oops', 'utf-8')
    expect(s.read()).toEqual({ a: 1 })
  })
  it('ошибка чтения (не ENOENT/битый JSON) пробрасывается, а не стирает данные', () => {
    const dirAsFile = join(dir, 'iam-dir')
    require('fs').mkdirSync(dirAsFile)
    const s = new JsonFileStore(dirAsFile, { a: 1 })
    expect(() => s.read()).toThrow()
  })
})

describe('JsonFileStore не перечитывает файл без нужды', () => {
  const fs = require('fs') as typeof import('fs')

  it('повторное чтение берёт разобранное значение, а не файл', () => {
    const p = join(dir, 'x.json')
    const s = new JsonFileStore(p, { a: 0 })
    s.write({ a: 1 })

    // время правки задаём ЯВНО с обеих сторон: NTFS хранит доли миллисекунды,
    // а utimesSync выставляет ровно то, что дали, — иначе метки не совпадут
    const метка = new Date(Date.now() - 10_000)
    fs.utimesSync(p, метка, метка)
    expect(s.read()).toEqual({ a: 1 })
    const размер = fs.statSync(p).size

    // подменяем содержимое ТЕМ ЖЕ числом байт и возвращаем ту же метку времени:
    // для хранилища файл выглядит нетронутым, значит ответ обязан прийти из памяти
    fs.writeFileSync(p, JSON.stringify({ a: 9 }, null, 2), 'utf-8')
    fs.utimesSync(p, метка, метка)
    expect(fs.statSync(p).size).toBe(размер) // подмена и правда незаметна по метаданным

    expect(s.read()).toEqual({ a: 1 })
  })

  it('правку файла снаружи подхватывает', () => {
    const p = join(dir, 'x.json')
    const s = new JsonFileStore(p, { a: 0 })
    s.write({ a: 1 })
    expect(s.read()).toEqual({ a: 1 })

    fs.writeFileSync(p, JSON.stringify({ a: 7 }, null, 2), 'utf-8')
    const t = new Date(Date.now() + 5000)
    fs.utimesSync(p, t, t)

    expect(s.read()).toEqual({ a: 7 })
  })

  it('своя запись сразу видна следующему чтению', () => {
    const p = join(dir, 'x.json')
    const s = new JsonFileStore(p, { a: 0 })
    s.write({ a: 1 })
    expect(s.read()).toEqual({ a: 1 })
    s.write({ a: 2 })
    expect(s.read()).toEqual({ a: 2 })
  })

  it('файл, появившийся после первого чтения, всё равно читается', () => {
    const p = join(dir, 'x.json')
    const s = new JsonFileStore(p, { a: 0 })
    expect(s.read()).toEqual({ a: 0 }) // файла ещё нет — дефолты
    fs.writeFileSync(p, JSON.stringify({ a: 3 }, null, 2), 'utf-8')
    expect(s.read()).toEqual({ a: 3 })
  })

  it('исчезнувший файл возвращает дефолты, а не последнее значение из памяти', () => {
    const p = join(dir, 'x.json')
    const s = new JsonFileStore(p, { a: 0 })
    s.write({ a: 5 })
    expect(s.read()).toEqual({ a: 5 })
    fs.rmSync(p)
    expect(s.read()).toEqual({ a: 0 })
  })
})
