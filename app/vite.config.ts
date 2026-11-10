// 2026-11-10 期間内に書き直し。
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 開発時は 5188 番で画面を出し、/api は API サーバー（8787 番）へ回す
const API_SERVER = 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  // APK（file://）でも読めるよう相対パスで出力する
  base: './',
  server: { host: '127.0.0.1', port: 5188, strictPort: true, proxy: { '/api': API_SERVER } },
  preview: { host: '127.0.0.1', port: 5189 },
  build: { target: 'es2022' },
  test: { environment: 'node' },
} as Parameters<typeof defineConfig>[0])
