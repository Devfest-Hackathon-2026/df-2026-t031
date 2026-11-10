// 2026-11-10 期間内に書き直し。
// 起動中の API サーバー（npm run dev:api）に、Gemini と Google Weather の設定があるかを尋ねる。
// キーが「設定されているか」だけを見る。実際に API 呼び出しが通るかは確かめない。

const HEALTH_URL = 'http://127.0.0.1:8787/api/health'

const res = await fetch(HEALTH_URL)
if (!res.ok) throw new Error(`API サーバーが HTTP ${res.status} を返しました。`)
const health = (await res.json()) as { gemini?: boolean; weather?: boolean }

console.log({ server: 'ready', geminiConfigured: !!health.gemini, weatherConfigured: !!health.weather })
console.log('設定の有無だけを確認しました。実際の API 呼び出しが成功するかは確かめていません。')

export {}
