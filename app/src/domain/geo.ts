import type { Bounds, LatLng, XY } from './types.ts'

// 2026-11-10 期間内に書き直し。座標計算の小道具をまとめたモジュール。

const EARTH_RADIUS_M = 6_371_008.8
const DEG = Math.PI / 180
const WALK_M_PER_MIN = 80

/**
 * ある地点を原点にした平面座標（メートル、x=東、y=北）との相互変換。
 * 対象は数 km 四方なので、原点の緯度で経度方向を縮める簡易投影で十分。
 */
export class LocalProjection {
  readonly origin: LatLng
  private readonly metersPerLng: number
  private readonly metersPerLat: number

  constructor(origin: LatLng) {
    this.origin = origin
    this.metersPerLat = EARTH_RADIUS_M * DEG
    this.metersPerLng = this.metersPerLat * Math.cos(origin.lat * DEG)
  }

  toXY({ lat, lng }: LatLng): XY {
    return {
      x: (lng - this.origin.lng) * this.metersPerLng,
      y: (lat - this.origin.lat) * this.metersPerLat,
    }
  }

  toLatLng({ x, y }: XY): LatLng {
    return {
      lat: this.origin.lat + y / this.metersPerLat,
      lng: this.origin.lng + x / this.metersPerLng,
    }
  }
}

/** 大円距離（m） */
export function haversineM(from: LatLng, to: LatLng): number {
  const φ1 = from.lat * DEG
  const φ2 = to.lat * DEG
  const halfDφ = (φ2 - φ1) / 2
  const halfDλ = ((to.lng - from.lng) * DEG) / 2
  const h = Math.sin(halfDφ) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(halfDλ) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(h, 1)))
}

/** 歩いて何分か（分速 80 m、最低 1 分） */
export function walkMinutes(distanceM: number): number {
  const min = Math.round(distanceM / WALK_M_PER_MIN)
  return min < 1 ? 1 : min
}

/** 1 km 未満は 10 m 単位、それ以上は 0.1 km 単位 */
export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`
}

/** 各辺の両端を順に渡す */
function forEachEdge(ring: XY[], fn: (from: XY, to: XY) => boolean | void): boolean {
  const n = ring.length
  for (let k = 0; k < n; k++) {
    if (fn(ring[(k + n - 1) % n], ring[k]) === true) return true
  }
  return false
}

/** 点が多角形の内側か（右向きの半直線と辺の交差回数で判定）。輪は閉じていなくてもよい */
export function pointInRing(p: XY, ring: XY[]): boolean {
  let crossings = 0
  forEachEdge(ring, (u, v) => {
    if ((u.y <= p.y) === (v.y <= p.y)) return
    const xAtY = u.x + ((p.y - u.y) / (v.y - u.y)) * (v.x - u.x)
    if (xAtY > p.x) crossings++
  })
  return crossings % 2 === 1
}

const EPS = 1e-9

/** o→a と o→b の外積の符号（-1, 0, 1） */
function turn(o: XY, a: XY, b: XY): number {
  const v = (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  return v > 0 ? 1 : v < 0 ? -1 : 0
}

function withinBox(p: XY, a: XY, b: XY): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS
  )
}

/** 線分 ab と cd が交わるか。端点が触れるだけの場合も交わるとみなす */
export function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const t1 = turn(c, d, a)
  const t2 = turn(c, d, b)
  const t3 = turn(a, b, c)
  const t4 = turn(a, b, d)
  if (t1 * t2 < 0 && t3 * t4 < 0) return true
  return (
    (t1 === 0 && withinBox(a, c, d)) ||
    (t2 === 0 && withinBox(b, c, d)) ||
    (t3 === 0 && withinBox(c, a, b)) ||
    (t4 === 0 && withinBox(d, a, b))
  )
}

/** 線分 ab が多角形の内部か辺にかかるか */
export function segmentHitsRing(a: XY, b: XY, ring: XY[]): boolean {
  return pointInRing(a, ring) || pointInRing(b, ring) || forEachEdge(ring, (u, v) => segmentsIntersect(a, b, u, v))
}

/** 点から線分までの最短距離 */
export function distanceToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  let t = lenSq > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq : 0
  t = Math.min(1, Math.max(0, t))
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y)
}

/** 多角形の面積（向きによらず正） */
export function ringArea(ring: XY[]): number {
  let twice = 0
  forEachEdge(ring, (u, v) => {
    twice += u.x * v.y - v.x * u.y
  })
  return Math.abs(twice) / 2
}

/** 頂点の平均。閉じた輪（先頭と末尾が同じ点）なら末尾を数えない */
export function centroidLatLng(points: LatLng[]): LatLng {
  const first = points[0]
  const last = points[points.length - 1]
  const closed = points.length > 1 && first.lat === last.lat && first.lng === last.lng
  const used = closed ? points.length - 1 : points.length
  let sumLat = 0
  let sumLng = 0
  for (let i = 0; i < used; i++) {
    sumLat += points[i].lat
    sumLng += points[i].lng
  }
  return { lat: sumLat / used, lng: sumLng / used }
}

export function boundsOf(points: LatLng[]): Bounds {
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lngs),
    east: Math.max(...lngs),
  }
}
