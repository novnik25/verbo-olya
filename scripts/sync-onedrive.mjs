// Зеркалит исходники проекта в OneDrive (Projects\VoxFlow\код) — без node_modules и сборок.
// Запуск: npm run sync (выполняется после каждой сборки установщика).
import { spawnSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = 'C:\\Users\\novos\\OneDrive\\Документы\\Claude\\Projects\\VoxFlow\\код'

const excludeDirs = ['node_modules', 'out', 'dist-installer', '.superpowers']
const result = spawnSync(
  'robocopy',
  [root, dest, '/MIR', '/NFL', '/NDL', '/NJH', '/NP', '/XD', ...excludeDirs],
  { stdio: 'inherit' }
)
// robocopy: коды 0–7 = успех (0 — без изменений, 1 — скопировано), ≥8 — ошибка
if (result.status !== null && result.status >= 8) {
  console.error('robocopy завершился с ошибкой, код', result.status)
  process.exit(1)
}
console.log('Код синхронизирован в OneDrive:', dest)
