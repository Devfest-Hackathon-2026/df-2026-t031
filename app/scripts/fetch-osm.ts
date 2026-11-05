/**
 * OpenStreetMap（Overpass API）から対象エリアのデータを取得し、アプリ同梱のスナップショットを作る。
 *   npm run data:osm
 * 出力: public/data/area-osm.json（ODbL。アプリ内に「© OpenStreetMap contributors」を表示する）
 *
 * アプリの「OSM ライブ取得」も同じクエリ（src/domain/osmQuery.ts）と同じ変換（src/domain/osm.ts）を使う。
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { AREA_BOUNDS } from '../src/domain/area.ts'
import { buildOverpassQuery, slimOverpass } from '../src/domain/osmQuery.ts'

const endpoint = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter'
const query = buildOverpassQuery(AREA_BOUNDS)

console.log(`Overpass に問い合わせ中: ${endpoint}`)
const res = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    // Overpass は User-Agent のないリクエストを拒否することがある
    'user-agent': 'epoku-hackathon-prototype/0.1 (OSM snapshot script)',
    accept: 'application/json',
  },
  body: new URLSearchParams({ data: query }),
})
if (!res.ok) {
  console.error(`取得に失敗しました: HTTP ${res.status}`)
  console.error((await res.text()).slice(0, 500))
  process.exit(1)
}
const raw = await res.json()
const slim = slimOverpass(raw, new Date().toISOString())
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true })
const out = new URL('../public/data/area-osm.json', import.meta.url)
const text = JSON.stringify(slim)
await writeFile(out, text)
const counts: Record<string, number> = {}
for (const e of slim.elements) counts[e.t] = (counts[e.t] ?? 0) + 1
console.log(`保存しました: ${out.pathname}（${(text.length / 1024).toFixed(0)} KB）`, counts, `OSM 基準時刻 ${slim.osmBase}`)
