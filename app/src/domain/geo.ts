import type { Bounds, LatLng, XY } from './types.ts'

/** 地球の平均半径（m） */
const R = 6_371_008.8
const RAD = Math.PI / 180

/**
 * 緯度経度 ↔ 平面（m）の変換。エリアが数 km なので、基準点まわりの正距円筒図法で十分な精度になる
 * （2 km 先で誤差は数 cm 程度）。
 */
export class LocalProjection {
  readonly origin: LatLng
  private readonly kx: number
  private readonly ky: number

  constructor(origin: LatLng) {
    this.origin = origin
    this.kx = R * RAD * Math.cos(origin.lat * RAD)
    this.ky = R * RAD
  }

  toXY(p: LatLng): XY {
    return { x: (p.lng - this.origin.lng) * this.kx, y: (p.lat - this.origin.lat) * this.ky }
  }

  toLatLng(p: XY): LatLng {
    return { lat: this.origin.lat + p.y / this.ky, lng: this.origin.lng + p.x / this.kx }
  }
}

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLng = (b.lng - a.lng) * RAD
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** 徒歩の分数（80 m/分） */
export function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.round(distanceM / 80))
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(1)} km`
}

/** 点が多角形の内側か（偶奇判定）。ring は閉じていてもいなくてもよい */
export function pointInRing(p: XY, ring: XY[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx
}

/** 線分 ab と線分 cd が交わるか（端点で接する場合も含む） */
export function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const d1 = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y)
  const d2 = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y)
  const d3 = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y)
  const d4 = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  const onSeg = (p: XY, q: XY, r: XY) =>
    Math.min(p.x, q.x) - 1e-9 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-9 && Math.min(p.y, q.y) - 1e-9 <= r.y && r.y <= Math.max(p.y, q.y) + 1e-9
  if (d1 === 0 && onSeg(c, d, a)) return true
  if (d2 === 0 && onSeg(c, d, b)) return true
  if (d3 === 0 && onSeg(a, b, c)) return true
  if (d4 === 0 && onSeg(a, b, d)) return true
  return false
}

/** 線分 ab が多角形（内部を含む）と重なるか */
export function segmentHitsRing(a: XY, b: XY, ring: XY[]): boolean {
  if (pointInRing(a, ring) || pointInRing(b, ring)) return true
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (segmentsIntersect(a, b, ring[j], ring[i])) return true
  }
  return false
}

/** 点 p から線分 ab までの距離 */
export function distanceToSegment(p: XY, a: XY, b: XY): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
}

export function ringArea(ring: XY[]): number {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y)
  return Math.abs(s) / 2
}

export function centroidLatLng(points: LatLng[]): LatLng {
  // 閉じた輪の最後の点（最初と同じ）は数えない
  const pts = points.length > 1 && points[0].lat === points[points.length - 1].lat && points[0].lng === points[points.length - 1].lng ? points.slice(0, -1) : points
  let lat = 0
  let lng = 0
  for (const p of pts) {
    lat += p.lat
    lng += p.lng
  }
  return { lat: lat / pts.length, lng: lng / pts.length }
}

export function boundsOf(points: LatLng[]): Bounds {
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  for (const p of points) {
    south = Math.min(south, p.lat)
    north = Math.max(north, p.lat)
    west = Math.min(west, p.lng)
    east = Math.max(east, p.lng)
  }
  return { south, west, north, east }
}
