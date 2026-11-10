// 2026-11-10 期間内に書き直し。
// 開発用に API サーバー（server/index.ts、変更で再起動）と Vite を同時に起動する。
// どちらかが終わったら、もう片方も止める。
import { spawn } from 'node:child_process'

const node = process.execPath
const children = [
  spawn(node, ['--watch', 'server/index.ts'], { stdio: 'inherit' }),
  spawn(node, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
]

function stopAll() {
  for (const child of children) if (child.exitCode === null) child.kill()
}

for (const child of children) child.on('exit', stopAll)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stopAll)
