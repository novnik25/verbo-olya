import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: { build: { rollupOptions: { external: ['uiohook-napi', 'msedge-tts'] } } },
  preload: {},
  renderer: {
    plugins: [react()],
    // localhost на некоторых машинах резолвится в ::1 или уходит в системный прокси —
    // привязываемся к 127.0.0.1 явно, чтобы окна Electron гарантированно грузились
    server: { host: '127.0.0.1' },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          recorder: resolve(__dirname, 'src/renderer/recorder.html'),
          region: resolve(__dirname, 'src/renderer/region.html')
        }
      }
    }
  }
})
