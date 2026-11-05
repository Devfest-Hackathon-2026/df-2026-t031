import { centroidLatLng, LocalProjection, pointInRing, ringArea } from './geo.ts'
import type { Coord, SlimElement, SlimOsm } from './osmQuery.ts'
import type { AreaDataset, Attractor, Building, LatLng, ParkArea, Spot, SpotKind, Tree, TriState } from './types.ts'

/**
 * OpenStreetMap のデータ（slimOverpass の出力）を、アプリのデータに変換する。
 * 同梱スナップショットとライブ取得の両方がここを通る。
 */

/** 1 階あたりの高さ（m）。階数タグからの推定に使う */
export const LEVEL_HEIGHT_M = 3.2
/** 樹木の高さ・樹冠の半径・枝下の高さ（タグがないときの仮定値） */
export const TREE_DEFAULTS = { height: 8, crownRadius: 3, crownBase: 2.5 }

/** 樹冠の下端の高さ（m）。低い木は高さの 4 割 */
export const treeCrownBase = (height: number) => Math.min(TREE_DEFAULTS.crownBase, height * 0.4)

const toLatLng = (c: Coord): LatLng => ({ lat: c[0], lng: c[1] })

/** "12", "12 m", "12.5m", "40 ft", "12;15" → m。読めなければ null */
export function parseLength(v: string | undefined): number | null {
  if (!v) return null
  const m = v.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*(m|ft|')?/i)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  if (!Number.isFinite(n)) return null
  const unit = (m[2] ?? 'm').toLowerCase()
  return unit === 'ft' || unit === "'" ? n * 0.3048 : n
}

function parseLevels(v: string | undefined): number | null {
  const n = parseLength(v)
  return n !== null && n >= 0 ? n : null
}

function tri(v: string | undefined): TriState {
  if (v === 'yes') return 'yes'
  if (v === 'no') return 'no'
  return 'unknown'
}

function spotKindOf(tags: Record<string, string>): SpotKind | null {
  switch (tags.amenity) {
    case 'bench':
      return 'bench'
    case 'shelter':
      return 'shelter'
    case 'toilets':
      return 'toilet'
    case 'waste_basket':
    case 'recycling':
      return 'trash'
    case 'drinking_water':
      return 'water'
  }
  if (tags.leisure === 'picnic_table') return 'picnic'
  return null
}

function recyclingNote(tags: Record<string, string>): string | undefined {
  if (tags.amenity !== 'recycling') return undefined
  const kinds: string[] = []
  if (tags['recycling:plastic_bottles'] === 'yes') kinds.push('ペットボトル')
  if (tags['recycling:cans'] === 'yes') kinds.push('缶')
  if (tags['recycling:glass_bottles'] === 'yes') kinds.push('びん')
  if (tags['recycling:paper'] === 'yes') kinds.push('紙')
  return kinds.length ? `回収ボックス（${kinds.join('・')}）` : '回収ボックス'
}

/** 高さタグのない建物の仮定値（m）。種類と大きさから決める。画面には「仮定」と表示する */
export function assumedBuildingHeight(tags: Record<string, string>, areaM2: number): number {
  const b = tags.building ?? tags['building:part'] ?? 'yes'
  if (['house', 'detached', 'semidetached_house', 'terrace', 'residential'].includes(b)) return 7
  if (['garage', 'garages', 'shed', 'hut', 'kiosk', 'toilets', 'service', 'cabin'].includes(b)) return 3.5
  if (['apartments', 'commercial', 'office', 'retail', 'hotel'].includes(b)) return areaM2 > 1500 ? 30 : 18
  if (areaM2 < 200) return 6
  if (areaM2 < 1500) return 12
  return 18
}

interface RawBuilding {
  b: Building
  ringXY: { x: number; y: number }[]
  isPart: boolean
  hasExplicitHeight: boolean
}

function buildingFrom(id: string, ring: Coord[], tags: Record<string, string>, proj: LocalProjection): RawBuilding | null {
  if (ring.length < 4) return null
  const isPart = !!tags['building:part'] && !tags.building
  const value = tags.building ?? tags['building:part']
  if (!value || value === 'no') return null
  const footprint = ring.map(toLatLng)
  const ringXY = footprint.map((p) => proj.toXY(p))
  const area = ringArea(ringXY)
  if (area < 4) return null

  const isRoof = value === 'roof' || value === 'carport'
  const h = parseLength(tags.height)
  const lv = parseLevels(tags['building:levels'])
  const minH = parseLength(tags.min_height)
  const minLv = parseLevels(tags['building:min_level'])

  let height: number
  let heightSource: Building['heightSource']
  if (h !== null && h > 0) {
    height = h
    heightSource = 'measured'
  } else if (lv !== null && lv > 0) {
    height = lv * LEVEL_HEIGHT_M
    heightSource = 'levels'
  } else if (isRoof) {
    height = 4
    heightSource = 'assumed'
  } else {
    height = assumedBuildingHeight(tags, area)
    heightSource = 'assumed'
  }
  let minHeight = minH ?? (minLv !== null ? minLv * LEVEL_HEIGHT_M : 0)
  // 屋根だけの構造物は、下端の高さがなければ「屋根の厚み 1.5m」とみなす（下は日陰だが人は通れる）
  if (isRoof && minH === null && minLv === null) minHeight = Math.max(0, height - 1.5)
  minHeight = Math.min(minHeight, height - 0.5)

  return {
    b: {
      id,
      kind: isRoof ? 'roof' : isPart ? 'part' : 'building',
      footprint,
      height: Math.round(height * 10) / 10,
      minHeight: Math.max(0, Math.round(minHeight * 10) / 10),
      heightSource,
      name: tags['name:ja'] ?? tags.name,
    },
    ringXY,
    isPart,
    hasExplicitHeight: heightSource !== 'assumed',
  }
}

function elementRings(e: SlimElement): Coord[][] {
  if (e.t === 'w') return [e.g]
  if (e.t === 'r') return e.outer
  return []
}

function elementCenter(e: SlimElement): LatLng {
  if (e.t === 'n') return toLatLng(e.p)
  const rings = elementRings(e)
  return centroidLatLng((rings[0] ?? []).map(toLatLng))
}

const refOf = (e: SlimElement) => `${e.t === 'n' ? 'node' : e.t === 'w' ? 'way' : 'relation'}/${e.id}`
const idOf = (e: SlimElement) => `osm:${e.t}${e.id}`

function attractorKind(tags: Record<string, string>): Attractor['kind'] | null {
  if (tags.railway === 'station' || tags.railway === 'subway_entrance') return 'station'
  if (tags.tourism && ['attraction', 'museum', 'viewpoint', 'gallery', 'theme_park'].includes(tags.tourism)) return 'tourism'
  if (tags.shop === 'mall' || tags.shop === 'department_store') return 'mall'
  if (tags.leisure === 'park') return 'park'
  return null
}

export interface ParseOptions {
  /** 投影の基準点（エリアの中心） */
  origin: LatLng
  live: boolean
}

export function parseOsm(data: SlimOsm, opts: ParseOptions): AreaDataset {
  const proj = new LocalProjection(opts.origin)
  const spots: Spot[] = []
  const trees: Tree[] = []
  const attractors: Attractor[] = []
  const parks: ParkArea[] = []
  const rawBuildings: RawBuilding[] = []

  for (const e of data.elements) {
    const tags = e.tags
    const kind = spotKindOf(tags)
    if (kind) {
      const seats = parseLength(tags.seats ?? tags.capacity)
      spots.push({
        id: idOf(e),
        kind,
        name: tags['name:ja'] ?? tags.name ?? null,
        position: elementCenter(e),
        origin: 'osm',
        seats: seats !== null && seats > 0 && seats < 100 ? Math.round(seats) : null,
        roof: kind === 'shelter' ? 'yes' : tri(tags.covered),
        roofSource: kind === 'shelter' ? 'kind' : tags.covered === 'yes' || tags.covered === 'no' ? 'tag' : null,
        backrest: tri(tags.backrest),
        wheelchair: tags.wheelchair === 'yes' || tags.wheelchair === 'limited' || tags.wheelchair === 'no' ? tags.wheelchair : 'unknown',
        note: recyclingNote(tags),
        ref: refOf(e),
      })
    }

    if (tags.natural === 'tree' && e.t === 'n') {
      const h = parseLength(tags.height)
      const crown = parseLength(tags.diameter_crown)
      trees.push({
        id: idOf(e),
        position: toLatLng(e.p),
        height: h && h > 1 && h < 60 ? h : TREE_DEFAULTS.height,
        crownRadius: crown && crown > 0.5 && crown < 40 ? crown / 2 : TREE_DEFAULTS.crownRadius,
        heightSource: h ? 'measured' : 'assumed',
      })
    }

    const ak = attractorKind(tags)
    if (ak) attractors.push({ id: idOf(e), kind: ak, name: tags['name:ja'] ?? tags.name ?? null, position: elementCenter(e) })

    if (tags.leisure === 'park') {
      for (const ring of elementRings(e)) parks.push({ id: `${idOf(e)}-${parks.length}`, name: tags['name:ja'] ?? tags.name ?? null, ring: ring.map(toLatLng) })
    }

    if ((tags.building || tags['building:part']) && e.t !== 'n') {
      elementRings(e).forEach((ring, i) => {
        const rb = buildingFrom(i === 0 ? idOf(e) : `${idOf(e)}-${i}`, ring, tags, proj)
        if (rb) rawBuildings.push(rb)
      })
    }
  }

  // 建物の外形に高さがなく、中に高さ付きの「建物の一部」があるときは、外形は使わない（一部のほうが正確）
  const parts = rawBuildings.filter((r) => r.isPart)
  const partCenters = parts.map((p) => {
    const c = centroidLatLng(p.b.footprint)
    return proj.toXY(c)
  })
  const buildings: Building[] = []
  for (const r of rawBuildings) {
    if (!r.isPart && !r.hasExplicitHeight && r.b.kind === 'building') {
      if (partCenters.some((c) => pointInRing(c, r.ringXY))) continue
    }
    buildings.push(r.b)
  }

  // ベンチなどが屋根・建物の中にあれば「屋根あり（推定）」にする
  const roofLike = rawBuildings.filter((r) => r.b.kind === 'roof' || (r.b.kind === 'part' && r.b.minHeight > 0))
  const solid = rawBuildings.filter((r) => r.b.kind !== 'roof' && r.b.minHeight === 0)
  for (const s of spots) {
    if (s.roofSource === 'tag' || s.roofSource === 'kind') continue
    const p = proj.toXY(s.position)
    if (roofLike.some((r) => pointInRing(p, r.ringXY))) {
      s.roof = 'yes'
      s.roofSource = 'roof-polygon'
    } else if (solid.some((r) => pointInRing(p, r.ringXY))) {
      s.roof = 'yes'
      s.roofSource = 'inside-building'
    } else {
      // OSM では屋根がなければタグを付けないことが多い。「屋根なし（推定）」として扱う
      s.roof = 'no'
      s.roofSource = null
    }
  }

  return {
    spots,
    buildings,
    trees,
    attractors,
    parks,
    meta: {
      sourceLabel: opts.live ? 'OpenStreetMap（Overpass API でライブ取得）' : 'OpenStreetMap（アプリ同梱のスナップショット）',
      attribution: '© OpenStreetMap contributors (ODbL)',
      asOf: data.osmBase ?? data.fetchedAt,
      live: opts.live,
    },
  }
}

export function heightStats(buildings: Building[]): Record<Building['heightSource'], number> {
  const s = { measured: 0, levels: 0, assumed: 0 }
  for (const b of buildings) s[b.heightSource]++
  return s
}
