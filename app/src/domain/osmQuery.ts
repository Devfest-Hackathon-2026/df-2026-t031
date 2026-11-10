import type { Bounds } from './types.ts'

// 2026-11-10 期間内に書き直し。
// Overpass API に投げるクエリと、返ってきた JSON をアプリで使う分だけに縮める処理。
// scripts/fetch-osm.ts（同梱スナップショットの作成）とアプリのライブ取得の両方から使う。

/** 取得する要素。[要素の種類, タグの条件] */
const SELECTORS: ReadonlyArray<[kind: 'nwr' | 'node' | 'way' | 'relation', filter: string]> = [
  // 休憩スポット
  ['nwr', '["amenity"~"^(bench|toilets|waste_basket|recycling|drinking_water|shelter)$"]'],
  ['nwr', '["leisure"="picnic_table"]'],
  // 影を落とすもの
  ['way', '["building"]'],
  ['way', '["building:part"]'],
  ['relation', '["building"]'],
  ['node', '["natural"="tree"]'],
  // 人が集まる場所
  ['nwr', '["railway"="station"]'],
  ['node', '["railway"="subway_entrance"]'],
  ['nwr', '["tourism"~"^(attraction|museum|viewpoint|gallery)$"]'],
  ['nwr', '["shop"~"^(mall|department_store)$"]'],
  ['nwr', '["leisure"="park"]'],
]

export function buildOverpassQuery(b: Bounds, timeoutSec = 90): string {
  const bbox = `(${[b.south, b.west, b.north, b.east].join(',')})`
  const body = SELECTORS.map(([kind, filter]) => `  ${kind}${filter}${bbox};`)
  return [`[out:json][timeout:${timeoutSec}];`, '(', ...body, ');', 'out geom qt;'].join('\n')
}

/** 残すタグ。これ以外は捨ててファイルを小さくする */
const KEPT_TAG_KEYS: ReadonlySet<string> = new Set([
  // 種類
  'amenity', 'leisure', 'natural', 'railway', 'public_transport', 'tourism', 'shop', 'type',
  // 名前
  'name', 'name:ja',
  // 建物の形
  'building', 'building:part', 'height', 'min_height', 'building:levels', 'building:min_level', 'layer', 'level', 'indoor', 'location',
  // スポットの属性
  'covered', 'backrest', 'seats', 'capacity', 'wheelchair', 'fee', 'access', 'diameter_crown',
  // ごみ箱・回収ボックス
  'waste', 'bin', 'recycling:plastic_bottles', 'recycling:cans', 'recycling:glass_bottles', 'recycling:paper',
])

/** [緯度, 経度] */
export type Coord = [number, number]

export type SlimElement =
  | { t: 'n'; id: number; p: Coord; tags: Record<string, string> }
  | { t: 'w'; id: number; g: Coord[]; tags: Record<string, string> }
  | { t: 'r'; id: number; outer: Coord[][]; tags: Record<string, string> }

export interface SlimOsm {
  version: 1
  source: string
  fetchedAt: string
  osmBase: string | null
  elements: SlimElement[]
}

/** Overpass の `out geom` が返す形（使う項目だけ） */
interface OverpassPoint {
  lat: number
  lon: number
}
interface OverpassMember {
  type: string
  role?: string
  geometry?: OverpassPoint[]
}
interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: (OverpassPoint | null)[]
  members?: OverpassMember[]
}
interface OverpassResponse {
  elements?: OverpassElement[]
  osm3s?: { timestamp_osm_base?: string }
}

/** 小数 6 桁（約 10 cm）に丸める */
const to6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000

function keptTags(tags: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(Object.entries(tags).filter(([key]) => KEPT_TAG_KEYS.has(key)))
}

function isPoint(p: OverpassPoint | null | undefined): p is OverpassPoint {
  return p != null && Number.isFinite(p.lat) && Number.isFinite(p.lon)
}

function coordsOf(points: (OverpassPoint | null)[] = []): Coord[] {
  return points.filter(isPoint).map(({ lat, lon }) => [to6(lat), to6(lon)])
}

const sameCoord = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1]
const first = (line: Coord[]) => line[0]
const last = (line: Coord[]) => line[line.length - 1]
const isClosed = (line: Coord[]) => sameCoord(first(line), last(line))

/** 外周をつなぐときの、1 つの輪あたりの最大接続回数（壊れたデータで止まらないための上限） */
const MAX_JOINS = 1000

/**
 * リレーションの外周は複数の way に分かれて届くので、端点どうしをつないで閉じた輪にする。
 * 向きが逆の way は反転してつなぐ。閉じなかった輪は捨てる。
 */
export function assembleRings(parts: Coord[][]): Coord[][] {
  const remaining = parts.filter((line) => line.length >= 2).map((line) => line.slice())
  const rings: Coord[][] = []

  while (remaining.length > 0) {
    let ring = remaining.shift() as Coord[]
    for (let joins = 0; !isClosed(ring) && joins < MAX_JOINS; joins++) {
      const tail = last(ring)
      const index = remaining.findIndex((line) => sameCoord(first(line), tail) || sameCoord(last(line), tail))
      if (index === -1) break
      const [line] = remaining.splice(index, 1)
      const oriented = sameCoord(first(line), tail) ? line : line.slice().reverse()
      ring = [...ring, ...oriented.slice(1)]
    }
    if (ring.length >= 4 && isClosed(ring)) rings.push(ring)
  }
  return rings
}

function slimElement(e: OverpassElement): SlimElement | null {
  const tags = keptTags(e.tags)
  if (Object.keys(tags).length === 0) return null

  switch (e.type) {
    case 'node': {
      if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) return null
      return { t: 'n', id: e.id, p: [to6(e.lat as number), to6(e.lon as number)], tags }
    }
    case 'way': {
      const g = coordsOf(e.geometry)
      return g.length >= 2 ? { t: 'w', id: e.id, g, tags } : null
    }
    case 'relation': {
      const outerWays = (e.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner')
      const outer = assembleRings(outerWays.map((m) => coordsOf(m.geometry)))
      return outer.length > 0 ? { t: 'r', id: e.id, outer, tags } : null
    }
    default:
      return null
  }
}

/** Overpass の JSON を、アプリで使う項目だけの SlimOsm にする */
export function slimOverpass(raw: unknown, fetchedAt: string): SlimOsm {
  const response = (raw ?? {}) as OverpassResponse
  const elements = (response.elements ?? []).map(slimElement).filter((e): e is SlimElement => e !== null)
  return {
    version: 1,
    source: 'OpenStreetMap contributors (ODbL 1.0)',
    fetchedAt,
    osmBase: response.osm3s?.timestamp_osm_base ?? null,
    elements,
  }
}
