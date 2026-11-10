// 2026-11-10 期間内に書き直し。
// Android のデバッグ用 APK を作る。
//   型検査 → Vite ビルド → sw.js 生成 → Capacitor で android/ に同期 → Gradle で assembleDebug
// 署名鍵は使わない（デバッグ署名のみ）。途中で失敗したらその終了コードで止める。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const node = process.execPath
const CAP = 'node_modules/@capacitor/cli/bin/capacitor'

function step(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status || 1)
}

step(node, ['node_modules/typescript/bin/tsc', '-b'])
step(node, ['node_modules/vite/bin/vite.js', 'build'])
step(node, ['scripts/generate-sw.mjs'])
if (!existsSync('android')) step(node, [CAP, 'add', 'android'])
step(node, [CAP, 'sync', 'android'])

if (process.platform === 'win32') {
  step('cmd.exe', ['/d', '/s', '/c', 'gradlew.bat assembleDebug'], { cwd: 'android' })
} else {
  step('./gradlew', ['assembleDebug'], { cwd: 'android' })
}
console.log('APK: android/app/build/outputs/apk/debug/app-debug.apk')
