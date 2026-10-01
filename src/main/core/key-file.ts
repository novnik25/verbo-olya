import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto'
import { MIN_PASSPHRASE as MIN } from '../../shared/types'

/**
 * Файл переноса ключа (.vfk). Раньше это был обычный base64: файл ложился в
 * «Документы», которые синхронизируются с облаком, и ключ уезжал туда открытым.
 * Теперь содержимое зашифровано парольной фразой.
 *
 * Раскладка после метки VFKEY2:
 *   соль 16 | вектор 12 | число итераций 4 (big-endian) | метка целостности 16 | шифротекст
 * Число итераций лежит В ФАЙЛЕ: подняв его в новых версиях, мы не сломаем
 * ранее сохранённые файлы — они расшифруются со своим прежним значением.
 */
const MAGIC = 'VFKEY2:'
const LEGACY_MAGIC = 'VFKEY1:'
const SALT = 16
const IV = 12
const ITER = 4
const TAG = 16
const HEADER = SALT + IV + ITER + TAG

export { MIN_PASSPHRASE } from '../../shared/types'
/** Стоимость перебора одной фразы; хранится в файле, можно поднимать. */
export const DEFAULT_ITERATIONS = 600_000

export type UnpackResult =
  | { ok: true; key: string }
  | { ok: false; reason: 'wrong-passphrase' | 'damaged' }

function derive(passphrase: string, salt: Buffer, iterations: number): Buffer {
  return pbkdf2Sync(passphrase.normalize('NFKC'), salt, iterations, 32, 'sha256')
}

export function packKeyFile(
  key: string,
  passphrase: string,
  iterations: number = DEFAULT_ITERATIONS
): string {
  if (passphrase.length < MIN) {
    throw new Error(`Парольная фраза короче ${MIN} знаков`)
  }
  const salt = randomBytes(SALT)
  const iv = randomBytes(IV)
  const cipher = createCipheriv('aes-256-gcm', derive(passphrase, salt, iterations), iv)
  const body = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()])
  const iterBuf = Buffer.alloc(ITER)
  iterBuf.writeUInt32BE(iterations)
  return MAGIC + Buffer.concat([salt, iv, iterBuf, cipher.getAuthTag(), body]).toString('base64')
}

export function unpackKeyFile(contents: string, passphrase: string): UnpackResult {
  const raw = contents.trim()

  // файлы, сохранённые до появления шифрования, всё ещё надо уметь открывать:
  // отказ не сделал бы их безопаснее, а перенос ключа сломал бы
  if (raw.startsWith(LEGACY_MAGIC)) {
    const key = Buffer.from(raw.slice(LEGACY_MAGIC.length), 'base64').toString('utf8').trim()
    return key ? { ok: true, key } : { ok: false, reason: 'damaged' }
  }

  if (!raw.startsWith(MAGIC)) return { ok: false, reason: 'damaged' }
  const blob = Buffer.from(raw.slice(MAGIC.length), 'base64')
  if (blob.length <= HEADER) return { ok: false, reason: 'damaged' }

  const salt = blob.subarray(0, SALT)
  const iv = blob.subarray(SALT, SALT + IV)
  const iterations = blob.readUInt32BE(SALT + IV)
  const tag = blob.subarray(SALT + IV + ITER, HEADER)
  const body = blob.subarray(HEADER)
  if (iterations < 1) return { ok: false, reason: 'damaged' }

  try {
    const decipher = createDecipheriv('aes-256-gcm', derive(passphrase, salt, iterations), iv)
    decipher.setAuthTag(tag)
    const key = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8').trim()
    return key ? { ok: true, key } : { ok: false, reason: 'damaged' }
  } catch {
    // метка целостности не сошлась: либо фраза не та, либо файл правили
    return { ok: false, reason: 'wrong-passphrase' }
  }
}

/** Сравнение фраз при подтверждении — без утечки по времени. */
export function samePassphrase(a: string, b: string): boolean {
  const x = Buffer.from(a.normalize('NFKC'))
  const y = Buffer.from(b.normalize('NFKC'))
  return x.length === y.length && timingSafeEqual(x, y)
}
