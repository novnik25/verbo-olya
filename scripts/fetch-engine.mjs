// Восстанавливает resources/whisper-engine (движок whisper.cpp v1.9.2 BLAS),
// если папки нет: качает релизный zip и распаковывает. Папка в .gitignore —
// на машине сборки скрипт выполняется один раз. Запуск: npm run engine
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'resources', 'whisper-engine')

if (existsSync(join(dest, 'whisper-cli.exe'))) {
  console.log('Движок на месте:', dest)
  process.exit(0)
}

const ZIP_URL =
  'https://github.com/ggerganov/whisper.cpp/releases/download/v1.9.2/whisper-blas-bin-x64.zip'
console.log('Скачиваю движок:', ZIP_URL)
const res = await fetch(ZIP_URL, { headers: { 'User-Agent': 'VoxFlow-build' } })
if (!res.ok) {
  console.error(`HTTP ${res.status} — движок не скачан. Нужен интернет (возможно, VPN).`)
  process.exit(1)
}
mkdirSync(dest, { recursive: true })
const zipPath = join(dest, 'engine.zip')
writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))
const extractDir = join(dest, 'extract')
execFileSync('powershell.exe', [
  '-NoProfile',
  '-Command',
  `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`
])

function findCli(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const found = findCli(p)
      if (found) return found
    } else if (e.name.toLowerCase() === 'whisper-cli.exe') {
      return p
    }
  }
  return null
}
const cli = findCli(extractDir)
if (!cli) {
  console.error('whisper-cli.exe не найден в архиве — проверьте структуру релиза')
  process.exit(1)
}
const srcDir = dirname(cli)
copyFileSync(cli, join(dest, 'whisper-cli.exe'))
for (const name of readdirSync(srcDir)) {
  if (name.toLowerCase().endsWith('.dll')) copyFileSync(join(srcDir, name), join(dest, name))
}
rmSync(zipPath, { force: true })
rmSync(extractDir, { recursive: true, force: true })
console.log('Движок распакован в', dest)
