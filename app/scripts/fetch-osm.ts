// 2026-11-10 期間内に書き直し。
// 対象エリアの OpenStreetMap データを Overpass API から取り、アプリに同梱するスナップショットを書き出す。
//
//   npm run data:osm   →  public/data/area-osm.json
//
// データは ODbL 1.0。アプリの画面に「© OpenStreetMap contributors」を出す。
// アプリ内のライブ取得も、同じクエリと同じ縮め方（src/domain/osmQuery.ts）を使う。

import { mkdir, writeFile } from 'node:fs/promises'
import { AREA_BOUNDS } from '../src/domain/area.ts'
import { buildOverpassQuery, slimOverpass } from '../src/domain/osmQuery.ts'

const OVERPASS = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter'
const OUT_DIR = new URL('../public/data/', import.meta.url)
const OUT_FILE = new URL('area-osm.json', OUT_DIR)

async function fetchOverpass(query: string): Promise<unknown> {
  const response = await fetch(OVERPASS, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      // User-Agent がないと断られることがある
      'user-agent': 'epoku-hackathon-prototype/0.1 (OSM snapshot script)',
    },
    body: new URLSearchParams({ data: query }),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`取得に失敗しました: HTTP ${response.status}\n${detail}`)
  }
  return response.json()
}

/** 要素の種類（n / w / r）ごとの件数 */
function countByType(elements: { t: string }[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const { t } of elements) counts[t] = (counts[t] ?? 0) + 1
  return counts
}

try {
  console.log(`Overpass に問い合わせ中: ${OVERPASS}`)
  const snapshot = slimOverpass(await fetchOverpass(buildOverpassQuery(AREA_BOUNDS)), new Date().toISOString())
  const json = JSON.stringify(snapshot)
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_FILE, json)
  const sizeKb = Math.round(json.length / 1024)
  console.log(`保存しました: ${OUT_FILE.pathname}（${sizeKb} KB）`, countByType(snapshot.elements), `OSM 基準時刻 ${snapshot.osmBase}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
