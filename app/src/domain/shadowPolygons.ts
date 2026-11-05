import { LocalProjection } from './geo.ts'
import { treeCrownBase } from './osm.ts'
import { LOW_SUN_DEG, MAX_SHADOW_M } from './shade.ts'
import type { Building, SunPosition, Tree, XY } from './types.ts'

/**
 * 地図に描く影の形（平面座標 m）。判定（ShadeEngine）と同じ式で作る。
 * 建物の影 = 輪郭を「下端の影の位置」から「上端の影の位置」まで平行移動させて通った範囲。
 *
 * 和集合は取らない（1,000 棟以上だと数秒かかるうえ、まれに計算が破綻するため）。
 * 描く側で「不透明に塗ってから全体を半透明にする」ことで、重なりが濃くならないようにする。
 */

export interface ShadowShapes {
  /** 建物の影。各要素は 1 つの多角形 */
  buildings: XY[][]
  /** 樹木の影（推定） */
  trees: XY[][]
}


function isConvex(ring: XY[]): boolean {
  let sign = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const c = ring[(i + 2) % n]
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(z) < 1e-9) continue
    const s = Math.sign(z)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

export function convexHull(points: XY[]): XY[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: XY[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: XY[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

function openRing(ring: XY[]): XY[] {
  const a = ring[0]
  const b = ring[ring.length - 1]
  return ring.length > 1 && a.x === b.x && a.y === b.y ? ring.slice(0, -1) : ring
}

function shadowDir(sun: SunPosition) {
  const tan = Math.tan((sun.altitude * Math.PI) / 180)
  const az = (sun.azimuth * Math.PI) / 180
  // 影は太陽と反対向きに伸びる
  return { tan, ux: -Math.sin(az), uy: -Math.cos(az) }
}

/** 1 つの建物の影。凸形なら 1 つの多角形、凹形なら部品の集まり（重ねて塗れば正しい形になる） */
export function buildingShadowXY(ring0: XY[], h: number, hb: number, sun: SunPosition): XY[][] {
  const ring = openRing(ring0)
  if (ring.length < 3 || sun.altitude <= LOW_SUN_DEG) return []
  const { tan, ux, uy } = shadowDir(sun)
  const l1 = Math.min(hb / tan, MAX_SHADOW_M)
  const l2 = Math.min(h / tan, MAX_SHADOW_M)
  const r1 = ring.map((p) => ({ x: p.x + ux * l1, y: p.y + uy * l1 }))
  const r2 = ring.map((p) => ({ x: p.x + ux * l2, y: p.y + uy * l2 }))
  if (isConvex(ring)) return [convexHull([...r1, ...r2])]
  const parts: XY[][] = [r1, r2]
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length
    parts.push([r1[i], r1[j], r2[j], r2[i]])
  }
  return parts
}

export function treeShadowXY(c: XY, r: number, h: number, hb: number, sun: SunPosition, segments = 10): XY[] {
  if (sun.altitude <= LOW_SUN_DEG) return []
  const { tan, ux, uy } = shadowDir(sun)
  const l1 = Math.min(hb / tan, MAX_SHADOW_M)
  const l2 = Math.min(h / tan, MAX_SHADOW_M)
  const pts: XY[] = []
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    const dx = Math.cos(t) * r
    const dy = Math.sin(t) * r
    pts.push({ x: c.x + ux * l1 + dx, y: c.y + uy * l1 + dy }, { x: c.x + ux * l2 + dx, y: c.y + uy * l2 + dy })
  }
  return convexHull(pts)
}

export interface ViewBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 影の形をまとめて作る。view を渡すと、その範囲に影がかからないものは省く */
export function buildShadowShapes(buildings: Building[], trees: Tree[], sun: SunPosition, proj: LocalProjection, view?: ViewBox): ShadowShapes {
  if (sun.altitude <= LOW_SUN_DEG) return { buildings: [], trees: [] }
  const { tan } = shadowDir(sun)
  const out: ShadowShapes = { buildings: [], trees: [] }
  for (const b of buildings) {
    const ring = b.footprint.map((p) => proj.toXY(p))
    if (view) {
      const reach = Math.min(b.height / tan, MAX_SHADOW_M)
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of ring) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
      if (maxX + reach < view.minX || minX - reach > view.maxX || maxY + reach < view.minY || minY - reach > view.maxY) continue
    }
    for (const part of buildingShadowXY(ring, b.height, b.minHeight, sun)) if (part.length >= 3) out.buildings.push(part)
  }
  for (const t of trees) {
    const c = proj.toXY(t.position)
    if (view && (c.x < view.minX - 60 || c.x > view.maxX + 60 || c.y < view.minY - 60 || c.y > view.maxY + 60)) continue
    const s = treeShadowXY(c, t.crownRadius, t.height, treeCrownBase(t.height), sun)
    if (s.length >= 3) out.trees.push(s)
  }
  return out
}
