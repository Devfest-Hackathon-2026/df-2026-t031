// 2026-11-10 期間内に書き直し。
// vite build の後に dist/sw.js を作る。
// ビルド成果物（画面・地図データ）を先読みしてオフラインでも開けるようにする。
//   画面遷移 … ネットワーク優先、つながらなければ保存済みの index.html
//   それ以外 … 保存済みがあればそれを使う
//   /api/ と他サイト、GET 以外 … Service Worker は触らない
import { readdir, writeFile } from 'node:fs/promises'

const listDir = async (dir, prefix) => (await readdir(dir)).map((name) => `${prefix}/${name}`)

const precache = [
  './',
  './index.html',
  './icon.svg',
  './manifest.webmanifest',
  ...(await listDir('dist/data', './data')),
  ...(await listDir('dist/assets', './assets')),
]
// ビルドごとに名前を変え、古いキャッシュは activate で消す
const cacheName = `epoku-${Date.now()}`

function serviceWorker(CACHE, FILES) {
  self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)))
  })

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then((names) =>
        Promise.all(names.filter((n) => n.startsWith('epoku-') && n !== CACHE).map((n) => caches.delete(n))),
      ),
    )
  })

  self.addEventListener('fetch', (event) => {
    const { request } = event
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return
    if (request.mode === 'navigate') {
      event.respondWith(fetch(request).catch(() => caches.match('./index.html')))
      return
    }
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)))
  })
}

const source = `(${serviceWorker.toString()})(${JSON.stringify(cacheName)}, ${JSON.stringify(precache)});\n`
await writeFile('dist/sw.js', source)
console.log(`dist/sw.js を書き出しました（${precache.length} 件を先読み）`)
