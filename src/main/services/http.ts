// В приложении транспорт задаётся через Electron: обычный fetch из Node
// обходит системный прокси, поэтому ключ работает в браузере, но не здесь.
let transport: typeof fetch = (...args) => fetch(...args)

export function configureServiceFetch(fetchFn: typeof fetch): void {
  transport = fetchFn
}

export const serviceFetch: typeof fetch = (...args) => transport(...args)
