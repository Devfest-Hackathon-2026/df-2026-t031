// 2026-11-10 期間内に書き直し。
// 地点データの読み込み。同梱の OSM スナップショット（あれば PLATEAU の建物高さを重ねる）と、Overpass からのライブ取得。
import { AREA_BOUNDS, AREA_CENTER } from '../domain/area.ts'
import { parseOsm } from '../domain/osm.ts'
import { buildOverpassQuery, slimOverpass, type SlimOsm } from '../domain/osmQuery.ts'
import { withPlateau, type PlateauSubset } from '../domain/plateau.ts'
import type { AreaDataset } from '../domain/types.ts'

const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${file}`

/** PLATEAU の部分データ。なくても動くので、読めなければ null */
async function loadPlateau(signal: AbortSignal): Promise<PlateauSubset | null> {
  try {
    const response = await fetch(dataUrl('plateau-nishi.json'), { signal })
    if (!response.ok) return null
    return (await response.json()) as PlateauSubset
  } catch {
    return null
  }
}

export async function loadAreaDataset(signal: AbortSignal): Promise<AreaDataset> {
  const response = await fetch(dataUrl('area-osm.json'), { signal })
  if (!response.ok) throw new Error('地点データを読めませんでした。')
  const snapshot = (await response.json()) as SlimOsm
  const dataset = parseOsm(snapshot, { origin: AREA_CENTER, live: false })
  const plateau = await loadPlateau(signal)
  return plateau ? withPlateau(dataset, plateau) : dataset
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const LIVE_TIMEOUT_MS = 35_000

/**
 * Overpass から今の OSM を取り直す（設定画面の「OSMをライブ取得」）。
 * 同梱データと同じクエリ・同じ縮め方を使う。地点が 0 件なら失敗扱い。
 */
export async function fetchLiveDataset(): Promise<AreaDataset> {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: new URLSearchParams({ data: buildOverpassQuery(AREA_BOUNDS, 25) }),
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error('OSMの取得に失敗しました。')
  const snapshot = slimOverpass(await response.json(), new Date().toISOString())
  const dataset = parseOsm(snapshot, { origin: AREA_CENTER, live: true })
  if (dataset.spots.length === 0) throw new Error('地点が返りませんでした。同梱データを維持します。')
  return dataset
}
