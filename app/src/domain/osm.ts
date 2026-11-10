import { centroidLatLng, LocalProjection, pointInRing, ringArea } from './geo.ts'
import type { Coord, SlimElement, SlimOsm } from './osmQuery.ts'
import type { AreaDataset, Attractor, Building, LatLng, ParkArea, Spot, SpotKind, Tree, TriState, XY } from './types.ts'

// 2026-11-10 期間内に書き直し。
// 軽量化した OSM データ（osmQuery の slimOverpass の出力）を、アプリで使う AreaDataset に変換する。
// 同梱のスナップショットも、ライブ取得したデータも、どちらもここを通る。

/** 階数タグから高さを出すときの 1 階分（m） */
export const LEVEL_HEIGHT_M = 3.2
/** 樹木のタグが無いときに使う値（m） */
export const TREE_DEFAULTS = { height: 8, crownRadius: 3, crownBase: 2.5 }

/** 樹冠の下端（m）。背の低い木は高さの 40% までにする */
export function treeCrownBase(height: number): number {
  return Math.min(height * 0.4, TREE_DEFAULTS.crownBase)
}

type Tags = Record<string, string>

const latLngOf = ([lat, lng]: Coord): LatLng => ({ lat, lng })
const round1 = (n: number) => Math.round(n * 10) / 10
const nameOf = (tags: Tags): string | null => tags['name:ja'] ?? tags.name ?? null

const FEET_TO_M = 0.3048
const LENGTH_RE = /^(-?\d+(?:[.,]\d+)?)\s*(m|ft|')?/i

/** "12" / "12 m" / "12.5m" / "40 ft" / "12;15" などを m に直す。読めなければ null */
export function parseLength(raw: string | undefined): number | null {
  const match = raw ? LENGTH_RE.exec(raw.trim()) : null
  if (!match) return null
  const value = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(value)) return null
  const isFeet = /^(ft|')$/i.test(match[2] ?? '')
  return isFeet ? value * FEET_TO_M : value
}

const nonNegative = (n: number | null) => (n !== null && n >= 0 ? n : null)

const triState = (v: string | undefined): TriState => (v === 'yes' || v === 'no' ? v : 'unknown')

/** amenity / leisure タグから休憩スポットの種類を決める */
const SPOT_BY_AMENITY: Record<string, SpotKind> = {
  bench: 'bench',
  shelter: 'shelter',
  toilets: 'toilet',
  waste_basket: 'trash',
  recycling: 'trash',
  drinking_water: 'water',
}

function spotKindOf(tags: Tags): SpotKind | null {
  const byAmenity = tags.amenity ? SPOT_BY_AMENITY[tags.amenity] : undefined
  if (byAmenity) return byAmenity
  return tags.leisure === 'picnic_table' ? 'picnic' : null
}

const RECYCLING_LABELS: ReadonlyArray<[tag: string, label: string]> = [
  ['recycling:plastic_bottles', 'ペットボトル'],
  ['recycling:cans', '缶'],
  ['recycling:glass_bottles', 'びん'],
  ['recycling:paper', '紙'],
]

function recyclingNote(tags: Tags): string | undefined {
  if (tags.amenity !== 'recycling') return undefined
  const accepted = RECYCLING_LABELS.filter(([tag]) => tags[tag] === 'yes').map(([, label]) => label)
  return accepted.length > 0 ? `回収ボックス（${accepted.join('・')}）` : '回収ボックス'
}

const LOW_RISE = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'residential'])
const TINY = new Set(['garage', 'garages', 'shed', 'hut', 'kiosk', 'toilets', 'service', 'cabin'])
const MID_RISE = new Set(['apartments', 'commercial', 'office', 'retail', 'hotel'])

/** 高さも階数も無い建物の仮の高さ（m）。用途と床面積で決め、画面では「仮定」と出す */
export function assumedBuildingHeight(tags: Tags, areaM2: number): number {
  const use = tags.building ?? tags['building:part'] ?? 'yes'
  if (LOW_RISE.has(use)) return 7
  if (TINY.has(use)) return 3.5
  if (MID_RISE.has(use)) return areaM2 > 1500 ? 30 : 18
  if (areaM2 >= 1500) return 18
  return areaM2 >= 200 ? 12 : 6
}

interface BuildingDraft {
  building: Building
  ring: XY[]
  isPart: boolean
}

/** 屋根の厚みとみなす値（m）。下端が分からない屋根に使う */
const ROOF_THICKNESS_M = 1.5
const MIN_FOOTPRINT_M2 = 4

function resolveHeight(tags: Tags, isRoof: boolean, area: number): Pick<Building, 'height' | 'heightSource'> {
  const tagged = parseLength(tags.height)
  if (tagged !== null && tagged > 0) return { height: tagged, heightSource: 'measured' }
  const levels = nonNegative(parseLength(tags['building:levels']))
  if (levels !== null && levels > 0) return { height: levels * LEVEL_HEIGHT_M, heightSource: 'levels' }
  return { height: isRoof ? 4 : assumedBuildingHeight(tags, area), heightSource: 'assumed' }
}

function draftBuilding(id: string, coords: Coord[], tags: Tags, proj: LocalProjection): BuildingDraft | null {
  const use = tags.building ?? tags['building:part']
  if (coords.length < 4 || !use || use === 'no') return null

  const footprint = coords.map(latLngOf)
  const ring = footprint.map((p) => proj.toXY(p))
  const area = ringArea(ring)
  if (area < MIN_FOOTPRINT_M2) return null

  const isPart = Boolean(tags['building:part']) && !tags.building
  const isRoof = use === 'roof' || use === 'carport'
  const { height, heightSource } = resolveHeight(tags, isRoof, area)

  const minTagged = parseLength(tags.min_height)
  const minLevels = nonNegative(parseLength(tags['building:min_level']))
  let bottom: number
  if (minTagged !== null) bottom = minTagged
  else if (minLevels !== null) bottom = minLevels * LEVEL_HEIGHT_M
  else bottom = isRoof ? Math.max(0, height - ROOF_THICKNESS_M) // 下は日陰だが人が通れる
  : 0
  bottom = Math.min(bottom, height - 0.5)

  return {
    building: {
      id,
      kind: isRoof ? 'roof' : isPart ? 'part' : 'building',
      footprint,
      height: round1(height),
      minHeight: Math.max(0, round1(bottom)),
      heightSource,
      name: tags['name:ja'] ?? tags.name,
    },
    ring,
    isPart,
  }
}

function ringsOf(e: SlimElement): Coord[][] {
  switch (e.t) {
    case 'w':
      return [e.g]
    case 'r':
      return e.outer
    default:
      return []
  }
}

function centerOf(e: SlimElement): LatLng {
  if (e.t === 'n') return latLngOf(e.p)
  const outer = ringsOf(e)[0] ?? []
  return centroidLatLng(outer.map(latLngOf))
}

const OSM_TYPE = { n: 'node', w: 'way', r: 'relation' } as const
const osmRef = (e: SlimElement) => `${OSM_TYPE[e.t]}/${e.id}`
const appId = (e: SlimElement) => `osm:${e.t}${e.id}`

const TOURISM = new Set(['attraction', 'museum', 'viewpoint', 'gallery', 'theme_park'])

/** 人が集まる場所（駅・観光地・商業施設・公園）の種類 */
function attractorKind(tags: Tags): Attractor['kind'] | null {
  if (tags.railway === 'station' || tags.railway === 'subway_entrance') return 'station'
  if (tags.tourism !== undefined && TOURISM.has(tags.tourism)) return 'tourism'
  if (tags.shop === 'mall' || tags.shop === 'department_store') return 'mall'
  return tags.leisure === 'park' ? 'park' : null
}

const WHEELCHAIR = new Set(['yes', 'limited', 'no'])

function toSpot(e: SlimElement, kind: SpotKind): Spot {
  const tags = e.tags
  const seats = parseLength(tags.seats ?? tags.capacity)
  const isShelter = kind === 'shelter'
  const coveredTagged = tags.covered === 'yes' || tags.covered === 'no'
  return {
    id: appId(e),
    kind,
    name: nameOf(tags),
    position: centerOf(e),
    origin: 'osm',
    seats: seats !== null && seats > 0 && seats < 100 ? Math.round(seats) : null,
    roof: isShelter ? 'yes' : triState(tags.covered),
    roofSource: isShelter ? 'kind' : coveredTagged ? 'tag' : null,
    backrest: triState(tags.backrest),
    wheelchair: WHEELCHAIR.has(tags.wheelchair) ? (tags.wheelchair as Spot['wheelchair']) : 'unknown',
    note: recyclingNote(tags),
    ref: osmRef(e),
  }
}

function toTree(e: Extract<SlimElement, { t: 'n' }>): Tree {
  const height = parseLength(e.tags.height)
  const crownDiameter = parseLength(e.tags.diameter_crown)
  const heightOk = height !== null && height > 1 && height < 60
  const crownOk = crownDiameter !== null && crownDiameter > 0.5 && crownDiameter < 40
  return {
    id: appId(e),
    position: latLngOf(e.p),
    height: heightOk ? height : TREE_DEFAULTS.height,
    crownRadius: crownOk ? crownDiameter / 2 : TREE_DEFAULTS.crownRadius,
    heightSource: height ? 'measured' : 'assumed',
  }
}

/**
 * 高さの分からない建物の外形の中に「建物の一部（building:part）」があるなら、
 * 外形のほうは捨てて一部のほうを使う（一部のほうが形も高さも正確）。
 */
function dropShellsWithParts(drafts: BuildingDraft[], proj: LocalProjection): Building[] {
  const partCenters = drafts.filter((d) => d.isPart).map((d) => proj.toXY(centroidLatLng(d.building.footprint)))
  const isRedundantShell = (d: BuildingDraft) =>
    !d.isPart &&
    d.building.kind === 'building' &&
    d.building.heightSource === 'assumed' &&
    partCenters.some((c) => pointInRing(c, d.ring))
  return drafts.filter((d) => !isRedundantShell(d)).map((d) => d.building)
}

/**
 * タグで屋根の有無が分からないスポットを、建物の形から推定する。
 * 屋根・宙に浮いた建物の一部の下 → 屋根あり、建物の中 → 屋根あり、それ以外 → 屋根なし。
 */
function inferRoofs(spots: Spot[], drafts: BuildingDraft[], proj: LocalProjection): void {
  const overhead = drafts.filter(({ building: b }) => b.kind === 'roof' || (b.kind === 'part' && b.minHeight > 0))
  const enclosed = drafts.filter(({ building: b }) => b.kind !== 'roof' && b.minHeight === 0)
  for (const spot of spots) {
    if (spot.roofSource === 'tag' || spot.roofSource === 'kind') continue
    const p = proj.toXY(spot.position)
    const under = (d: BuildingDraft) => pointInRing(p, d.ring)
    if (overhead.some(under)) {
      spot.roof = 'yes'
      spot.roofSource = 'roof-polygon'
    } else if (enclosed.some(under)) {
      spot.roof = 'yes'
      spot.roofSource = 'inside-building'
    } else {
      // OSM は「屋根なし」をわざわざタグにしないことが多いので、なしと推定する
      spot.roof = 'no'
      spot.roofSource = null
    }
  }
}

export interface ParseOptions {
  /** 平面座標の原点（エリアの中心） */
  origin: LatLng
  live: boolean
}

export function parseOsm(data: SlimOsm, opts: ParseOptions): AreaDataset {
  const proj = new LocalProjection(opts.origin)
  const spots: Spot[] = []
  const trees: Tree[] = []
  const attractors: Attractor[] = []
  const parks: ParkArea[] = []
  const drafts: BuildingDraft[] = []

  for (const e of data.elements) {
    const { tags } = e

    const spotKind = spotKindOf(tags)
    if (spotKind) spots.push(toSpot(e, spotKind))

    if (e.t === 'n' && tags.natural === 'tree') trees.push(toTree(e))

    const crowd = attractorKind(tags)
    if (crowd) attractors.push({ id: appId(e), kind: crowd, name: nameOf(tags), position: centerOf(e) })

    if (tags.leisure === 'park') {
      for (const ring of ringsOf(e)) {
        parks.push({ id: `${appId(e)}-${parks.length}`, name: nameOf(tags), ring: ring.map(latLngOf) })
      }
    }

    if (e.t !== 'n' && (tags.building || tags['building:part'])) {
      ringsOf(e).forEach((ring, index) => {
        const id = index === 0 ? appId(e) : `${appId(e)}-${index}`
        const draft = draftBuilding(id, ring, tags, proj)
        if (draft) drafts.push(draft)
      })
    }
  }

  inferRoofs(spots, drafts, proj)

  return {
    spots,
    buildings: dropShellsWithParts(drafts, proj),
    trees,
    attractors,
    parks,
    meta: {
      sourceLabel: `OpenStreetMap（${opts.live ? 'Overpass API でライブ取得' : 'アプリ同梱のスナップショット'}）`,
      attribution: '© OpenStreetMap contributors (ODbL)',
      asOf: data.osmBase ?? data.fetchedAt,
      live: opts.live,
    },
  }
}

/** 建物の高さの出どころ別の件数 */
export function heightStats(buildings: Building[]): Record<Building['heightSource'], number> {
  const counts: Record<Building['heightSource'], number> = { measured: 0, levels: 0, assumed: 0, plateau: 0 }
  buildings.forEach((b) => counts[b.heightSource]++)
  return counts
}
