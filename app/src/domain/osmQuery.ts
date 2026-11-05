import type { Bounds } from './types.ts'

/**
 * Overpass API のクエリと、レスポンスを小さくまとめる処理。
 * スナップショット作成スクリプトとアプリのライブ取得で共通に使う。
 */

export function buildOverpassQuery(b: Bounds, timeoutSec = 90): string {
  const bb = `(${b.south},${b.west},${b.north},${b.east})`
  return `[out:json][timeout:${timeoutSec}];
(
  nwr["amenity"~"^(bench|toilets|waste_basket|recycling|drinking_water|shelter)$"]${bb};
  nwr["leisure"="picnic_table"]${bb};
  way["building"]${bb};
  way["building:part"]${bb};
  relation["building"]${bb};
  node["natural"="tree"]${bb};
  nwr["railway"="station"]${bb};
  node["railway"="subway_entrance"]${bb};
  nwr["tourism"~"^(attraction|museum|viewpoint|gallery)$"]${bb};
  nwr["shop"~"^(mall|department_store)$"]${bb};
  nwr["leisure"="park"]${bb};
);
out geom qt;`
}

const KEEP_TAGS = new Set([
  'amenity',
  'leisure',
  'building',
  'building:part',
  'height',
  'min_height',
  'building:levels',
  'building:min_level',
  'name',
  'name:ja',
  'covered',
  'backrest',
  'seats',
  'capacity',
  'natural',
  'diameter_crown',
  'railway',
  'public_transport',
  'tourism',
  'shop',
  'wheelchair',
  'fee',
  'access',
  'location',
  'indoor',
  'level',
  'layer',
  'recycling:plastic_bottles',
  'recycling:cans',
  'recycling:glass_bottles',
  'recycling:paper',
  'waste',
  'bin',
  'type',
])

export type Coord = [number, number] // [lat, lon]

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

interface RawGeom {
  lat: number
  lon: number
}
interface RawMember {
  type: string
  role?: string
  geometry?: RawGeom[]
}
interface RawElement {
  type: string
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: (RawGeom | null)[]
  members?: RawMember[]
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6

function pickTags(tags: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!tags) return out
  for (const [k, v] of Object.entries(tags)) if (KEEP_TAGS.has(k)) out[k] = v
  return out
}

function toCoords(g: (RawGeom | null)[] | undefined): Coord[] {
  if (!g) return []
  return g.filter((p): p is RawGeom => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p) => [r6(p.lat), r6(p.lon)])
}

const same = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1]

/** 複数の way に分かれた外周をつなげて閉じた輪にする（つながらない部分は捨てる） */
export function assembleRings(parts: Coord[][]): Coord[][] {
  const pool = parts.filter((p) => p.length >= 2).map((p) => [...p])
  const rings: Coord[][] = []
  while (pool.length > 0) {
    let ring = pool.shift()!
    let guard = 0
    while (!same(ring[0], ring[ring.length - 1]) && guard++ < 1000) {
      const end = ring[ring.length - 1]
      const i = pool.findIndex((p) => same(p[0], end) || same(p[p.length - 1], end))
      if (i < 0) break
      const next = pool.splice(i, 1)[0]
      ring = ring.concat((same(next[0], end) ? next : [...next].reverse()).slice(1))
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring)
  }
  return rings
}

/** Overpass の JSON を、アプリで使う項目だけに絞る */
export function slimOverpass(raw: unknown, fetchedAt: string): SlimOsm {
  const r = raw as { elements?: RawElement[]; osm3s?: { timestamp_osm_base?: string } }
  const elements: SlimElement[] = []
  for (const e of r.elements ?? []) {
    const tags = pickTags(e.tags)
    if (Object.keys(tags).length === 0) continue
    if (e.type === 'node' && Number.isFinite(e.lat) && Number.isFinite(e.lon)) {
      elements.push({ t: 'n', id: e.id, p: [r6(e.lat!), r6(e.lon!)], tags })
    } else if (e.type === 'way') {
      const g = toCoords(e.geometry)
      if (g.length >= 2) elements.push({ t: 'w', id: e.id, g, tags })
    } else if (e.type === 'relation') {
      const outer = assembleRings((e.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => toCoords(m.geometry)))
      if (outer.length > 0) elements.push({ t: 'r', id: e.id, outer, tags })
    }
  }
  return {
    version: 1,
    source: 'OpenStreetMap contributors (ODbL 1.0)',
    fetchedAt,
    osmBase: r.osm3s?.timestamp_osm_base ?? null,
    elements,
  }
}
