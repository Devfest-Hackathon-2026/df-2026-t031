// 2026-11-10 期間内に書き直し。
// 画面の入口。App を描き、本番ビルドではオフライン用の Service Worker を登録する。

import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './style.css'
import './immersive.css'
import './mobile.css'

/** 描画中の例外で真っ白にならないよう、再読み込みの案内を出す */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="fatal">
        <h1>画面を開けませんでした</h1>
        <p>保存データはこの端末に残っています。再読み込みしてお試しください。</p>
        <button onClick={() => location.reload()}>再読み込み</button>
      </main>
    )
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('#root が見つかりません。')
createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)

// sw.js は scripts/generate-sw.mjs がビルド後に作る。開発中は登録しない
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // 登録できなくても通常どおり使える
    })
  })
}
