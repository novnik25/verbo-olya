// SVG -> PNG (sharp) -> ICO (png-to-ico). Результаты в resources/icons/.
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icons')
const svg = readFileSync(join(dir, 'icon.svg'))

const sizes = [16, 24, 32, 48, 64, 128, 256]
const files = []
for (const s of sizes) {
  const out = join(dir, `icon-${s}.png`)
  await sharp(svg).resize(s, s).png().toFile(out)
  files.push(out)
}
writeFileSync(join(dir, 'icon.ico'), await pngToIco(files))
await sharp(svg).resize(32, 32).png().toFile(join(dir, 'tray.png'))
console.log('Иконки собраны')
