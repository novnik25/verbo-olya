import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../src/shared/types'
import { configureServiceFetch } from '../src/main/services/http'

const { handlers, readFile, dialog } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  readFile: vi.fn(),
  dialog: { showOpenDialog: vi.fn() }
}))
vi.mock('electron', () => ({
  app: {}, clipboard: {}, shell: {}, dialog,
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) }
}))
vi.mock('fs', () => ({ promises: { readFile } }))
vi.mock('../src/main/core/logger', () => ({ log: vi.fn() }))
vi.mock('../src/main/services/whisper-local', () => ({}))
import { registerIpc } from '../src/main/ipc'

afterEach(() => {
  handlers.clear()
  vi.clearAllMocks()
  configureServiceFetch((...args) => fetch(...args))
})

function setup() {
  const settings = { getApiKey: () => 'gsk_SAVED', setApiKey: vi.fn() }
  // Остальные зависимости не нужны этим каналам: они не вызываются при регистрации.
  registerIpc({ settings } as unknown as Parameters<typeof registerIpc>[0])
  return settings
}

describe('проверка и импорт ключа через IPC', () => {
  it('пустой введённый ключ не подменяется ранее сохранённым', async () => {
    setup()
    const transport = vi.fn(async () => new Response(JSON.stringify({ data: [] })))
    configureServiceFetch(transport)
    expect(await handlers.get(IPC.settingsVerifyKey)!(null, '   ')).toBe('malformed')
    expect(transport).not.toHaveBeenCalled()
    expect(await handlers.get(IPC.settingsVerifyKey)!(null)).toBe('ok')
    expect(transport.mock.calls).toHaveLength(1)
  })

  it('ключ из старого файла сохраняется очищенным после проверки', async () => {
    const settings = setup()
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['test.vfk'] })
    readFile.mockResolvedValue('VFKEY1:' + Buffer.from('"Bearer gsk_TEST"').toString('base64'))
    const transport = vi.fn(async () => new Response(JSON.stringify({ data: [] })))
    configureServiceFetch(transport)
    expect(await handlers.get(IPC.keyImport)!(null, '')).toBe('ok')
    expect(settings.setApiKey).toHaveBeenCalledWith('gsk_TEST')
  })

  it.each([
    ['Country not supported', 'blocked'],
    ['Access denied', 'forbidden']
  ])('импорт сохраняет причину запрета: %s', async (message, reason) => {
    const settings = setup()
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['test.vfk'] })
    readFile.mockResolvedValue('VFKEY1:' + Buffer.from('gsk_TEST').toString('base64'))
    configureServiceFetch(async () => new Response(JSON.stringify({ error: { message } }), { status: 403 }))
    expect(await handlers.get(IPC.keyImport)!(null, '')).toBe(reason)
    expect(settings.setApiKey).not.toHaveBeenCalled()
  })
})
