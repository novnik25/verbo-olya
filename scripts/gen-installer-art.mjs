// Оформление мастера установки: шапка и боковая панель в теме приложения.
// NSIS принимает только BMP, поэтому рисуем SVG → PNG (sharp) → 24-битный BMP.
import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'build')
mkdirSync(outDir, { recursive: true })

const BG = '#15181b'
const BG2 = '#1d2126'
const INK = '#edeff1'
const MUTED = '#98a2ac'
const ACCENT = '#4fbf9b'

/**
 * Фирменный знак Verbo: «V» из двух штрихов с точкой над вершиной. Знак
 * двухцветный: левый штрих и точка — акцентом, правый — цветом текста.
 *
 * Раньше здесь была своя система координат с формулами по scale, и пропорции
 * разошлись с иконкой приложения. Теперь знак вставляется ВЛОЖЕННЫМ svg со
 * своей viewBox: браузер (и sharp) сам впишет канон 0..256 в нужный квадрат,
 * никаких пересчётов, а значит и негде разойтись. Значения канона продублированы
 * здесь числами (обычный node не умеет импортировать TypeScript) и держатся
 * тестом tests/mark.test.ts.
 */
const MARK_BOX = 256
function waveMark(x, y, size, accent = ACCENT, ink = INK) {
  return (
    `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 ${MARK_BOX} ${MARK_BOX}">` +
    `<path d="M74 84 L128 178" stroke="${accent}" stroke-width="26" stroke-linecap="round" fill="none"/>` +
    `<path d="M182 84 L128 178" stroke="${ink}" stroke-width="26" stroke-linecap="round" fill="none"/>` +
    `<circle cx="128" cy="62" r="13" fill="${accent}"/>` +
    `</svg>`
  )
}

const header = `
<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57">
  <rect width="150" height="57" fill="${BG}"/>
  ${waveMark(4, 3, 40)}
  <text x="46" y="34" font-family="Segoe UI, sans-serif" font-size="15" font-weight="600" fill="${INK}">Verbo</text>
</svg>`

const sidebar = `
<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BG}"/>
      <stop offset="1" stop-color="${BG2}"/>
    </linearGradient>
  </defs>
  <rect width="164" height="314" fill="url(#g)"/>
  <circle cx="140" cy="40" r="110" fill="${ACCENT}" opacity="0.05"/>
  ${waveMark(11, 72, 72)}
  <text x="30" y="176" font-family="Segoe UI, sans-serif" font-size="22" font-weight="600" fill="${INK}">Verbo</text>
  <text x="30" y="200" font-family="Segoe UI, sans-serif" font-size="11" fill="${MUTED}">Голос · Перевод</text>
  <text x="30" y="216" font-family="Segoe UI, sans-serif" font-size="11" fill="${MUTED}">Озвучивание</text>
  <rect x="30" y="240" width="42" height="2" rx="1" fill="${ACCENT}"/>
</svg>`

/** Пишет 24-битный BMP (BI_RGB): строки снизу вверх, выравнивание по 4 байта. */
function writeBmp(path, width, height, rgb) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixels = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 3 // BMP хранит строки снизу вверх
    for (let x = 0; x < width; x++) {
      const o = y * rowSize + x * 3
      pixels[o] = rgb[src + x * 3 + 2] // B
      pixels[o + 1] = rgb[src + x * 3 + 1] // G
      pixels[o + 2] = rgb[src + x * 3] // R
    }
  }
  const header = Buffer.alloc(54)
  header.write('BM', 0)
  header.writeUInt32LE(54 + pixels.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(width, 18)
  header.writeInt32LE(height, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(pixels.length, 34)
  writeFileSync(path, Buffer.concat([header, pixels]))
}

async function render(svg, width, height, name) {
  const { data } = await sharp(Buffer.from(svg))
    .flatten({ background: BG })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  writeBmp(join(outDir, name), width, height, data)
  console.log(name + ' готов')
}

await render(header, 150, 57, 'installer-header.bmp')
await render(sidebar, 164, 314, 'installer-sidebar.bmp')
