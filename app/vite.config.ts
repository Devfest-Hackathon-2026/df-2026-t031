// 画面の開発サーバーとビルドの設定。/api はローカル API（server/index.ts, :8787）へ転送する。2026-11-10 作成
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
 plugins: [react()],
 base: './',
 server: {host: '127.0.0.1', port: 5188, strictPort: true, proxy: {'/api': 'http://127.0.0.1:8787'}},
 preview: {host: '127.0.0.1', port: 5189},
 build: {target: 'es2022', chunkSizeWarningLimit: 1600},
 test: {environment: 'node'},
} as Parameters<typeof defineConfig>[0])
