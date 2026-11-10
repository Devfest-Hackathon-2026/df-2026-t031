// 2026-11-10 期間内に書き直し。
// ビルド済みの画面をブラウザーで開き、主な操作が通るかを確かめる簡易 E2E。
//   npm run build のあとに node e2e/smoke.mjs
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const PORT = 5197
const URL_ROOT = `http://127.0.0.1:${PORT}/`

/** vite preview を起動し、応答が返るまで最大 10 秒待つ */
async function startPreview() {
  const server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore' },
  )
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(URL_ROOT)).ok) return server
    } catch {
      // まだ起動中
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  server.kill()
  throw new Error('vite preview が起動しませんでした')
}

function check(ok, message) {
  if (!ok) throw new Error(message)
}

const server = await startPreview()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  const openSpots = () => page.locator('.view-nav').getByRole('button', { name: '休憩スポット' }).click()
  await page.goto(URL_ROOT)

  // 1. 「座れた」を投稿すると、その場で表示に出る
  await openSpots()
  await page.getByRole('button', { name: '座れた' }).first().click()
  await page.locator('.actual-report').filter({ hasText: '座れた' }).first().waitFor()

  // 2. 保存した地点と投稿は、再読み込みしても残る
  await page.getByRole('button', { name: 'この場所を保存' }).first().click()
  await page.reload()
  await openSpots()
  await page.getByRole('button', { name: '保存を解除' }).first().waitFor()
  await page.locator('.actual-report').filter({ hasText: '座れた' }).first().waitFor()

  // 3. 見つからない検索では空の案内が出て、条件を戻せる
  await page.getByLabel('スポットを検索').fill('存在しないスポット')
  await page.locator('.empty-state').first().waitFor()
  await page.getByRole('button', { name: '条件をリセット' }).first().click()

  // 4. スマホ幅でも横にはみ出さない
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  check(!overflow, 'スマホ幅で横スクロールが発生しています')
  check(errors.length === 0, `ページでエラー: ${errors.join(' / ')}`)

  console.log('Browser smoke checks passed')
} finally {
  await browser.close()
  server.kill()
}
