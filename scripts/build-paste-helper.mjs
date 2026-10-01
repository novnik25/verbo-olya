// Компилирует PasteHelper.cs встроенным в Windows csc.exe (.NET Framework 4.x).
import { execFileSync } from 'child_process'
import { existsSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'resources', 'paste-helper', 'PasteHelper.cs')
const out = join(root, 'resources', 'paste-helper', 'PasteHelper.exe')

const cscCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
]
const csc = cscCandidates.find((p) => existsSync(p))
if (!csc) {
  console.error('csc.exe не найден — нужен .NET Framework 4.x (есть на всех Windows 10/11)')
  process.exit(1)
}
if (existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs) {
  console.log('PasteHelper.exe актуален')
  process.exit(0)
}
// UI Automation живёт в WPF-подпапке .NET Framework
const wpf = join(dirname(csc), 'WPF')
execFileSync(
  csc,
  [
    '/nologo',
    '/target:winexe',
    `/r:${join(wpf, 'UIAutomationClient.dll')}`,
    `/r:${join(wpf, 'UIAutomationTypes.dll')}`,
    `/r:${join(wpf, 'WindowsBase.dll')}`,
    `/out:${out}`,
    src
  ],
  { stdio: 'inherit' }
)
console.log('PasteHelper.exe собран')
