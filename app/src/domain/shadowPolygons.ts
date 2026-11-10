import { LocalProjection } from './geo.ts'
import { treeCrownBase } from './osm.ts'
import { LOW_SUN_DEG, MAX_SHADOW_M } from './shade.ts'
import type { Building, SunPosition, Tree, XY } from './types.ts'

// 2026-11-10 期間内に書き直し。
// 地図に重ねる影の多角形（平面座標 m）を作る。日陰判定（shade.ts）と同じ影の長さの式を使う。
//
// 建物の影は「輪郭を、下端の影の位置から上端の影の位置まで平行移動したときに通る範囲」。
// 建物どうしの和集合は取らない（1,000 棟を超えると数秒かかり、まれに計算も破綻する）。
// 重なりが濃くならないよう、描く側で「不透明に塗ってからレイヤー全体を半透明にする」。

export interface ShadowShapes {
  /** 建物の影。1 要素が 1 つの多角形 */
  buildings: XY[][]
  /** 樹木の影（推定値） */
  trees: XY[][]
}

export interface ViewBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** o→a と o→b の外積。正なら左回り */
const turn = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** 並べた点から凸包の片側（下側または上側）を作る */
function halfHull(sorted: XY[]): XY[] {
  const chain: XY[] = []
  for (const p of sorted) {
    while (chain.length >= 2 && turn(chain[chain.length - 2], chain[chain.length - 1], p) <= 0) chain.pop()
    chain.push(p)
  }
  chain.pop() // 終点は反対側の始点と同じなので落とす
  return chain
}

/** 凸包（左回り、一直線上の点は省く） */
export function convexHull(points: XY[]): XY[] {
  const sorted = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  return [...halfHull(sorted), ...halfHull(sorted.slice().reverse())]
}

/** 角の向きがすべて同じ（または一直線）なら凸 */
function isConvex(ring: XY[]): boolean {
  const n = ring.length
  let direction = 0
  for (let i = 0; i < n; i++) {
    const z = turn(ring[i], ring[(i + 1) % n], ring[(i + 2) % n])
    if (Math.abs(z) < 1e-9) continue
    if (direction === 0) direction = Math.sign(z)
    else if (Math.sign(z) !== direction) return false
  }
  return true
}

/** 始点と終点が同じ点なら終点を外す */
function withoutClosingPoint(ring: XY[]): XY[] {
  if (ring.length < 2) return ring
  const [head, tail] = [ring[0], ring[ring.length - 1]]
  return head.x === tail.x && head.y === tail.y ? ring.slice(0, -1) : ring
}

/** 高さ h の点の影が、根元からどれだけずれるか（m、上限あり） */
function shadowReach(h: number, sun: SunPosition): number {
  return Math.min(h / Math.tan((sun.altitude * Math.PI) / 180), MAX_SHADOW_M)
}

/** 影の伸びる向き（太陽の反対側）の単位ベクトル。y は北向き */
function shadowHeading(sun: SunPosition): XY {
  const az = (sun.azimuth * Math.PI) / 180
  return { x: -Math.sin(az), y: -Math.cos(az) }
}

const shifted = (p: XY, dir: XY, len: number): XY => ({ x: p.x + dir.x * len, y: p.y + dir.y * len })

/**
 * 1 棟の影。凸形なら 1 つの多角形、凹形なら部品の集まりを返す（重ねて塗ると正しい形になる）。
 * @param h 上端の高さ（m）
 * @param hb 下端の高さ（m）。屋根や宙に浮いた部分では 0 より大きい
 */
export function buildingShadowXY(ring: XY[], h: number, hb: number, sun: SunPosition): XY[][] {
  const outline = withoutClosingPoint(ring)
  if (outline.length < 3 || sun.altitude <= LOW_SUN_DEG) return []

  const dir = shadowHeading(sun)
  const bottom = outline.map((p) => shifted(p, dir, shadowReach(hb, sun)))
  const top = outline.map((p) => shifted(p, dir, shadowReach(h, sun)))
  if (isConvex(outline)) return [convexHull([...bottom, ...top])]

  // 凹形: 下端と上端の輪郭に、各辺が動いた跡の四角形を足す
  const sweeps = outline.map((_, i) => {
    const j = (i + 1) % outline.length
    return [bottom[i], bottom[j], top[j], top[i]]
  })
  return [bottom, top, ...sweeps]
}

/** 1 本の木の影（樹冠を円柱とみなす）。segments は円の分割数 */
export function treeShadowXY(c: XY, r: number, h: number, hb: number, sun: SunPosition, segments = 10): XY[] {
  if (sun.altitude <= LOW_SUN_DEG) return []
  const dir = shadowHeading(sun)
  const low = shifted(c, dir, shadowReach(hb, sun))
  const high = shifted(c, dir, shadowReach(h, sun))
  const rim: XY[] = []
  for (let k = 0; k < segments; k++) {
    const angle = (2 * Math.PI * k) / segments
    const dx = r * Math.cos(angle)
    const dy = r * Math.sin(angle)
    rim.push({ x: low.x + dx, y: low.y + dy }, { x: high.x + dx, y: high.y + dy })
  }
  return convexHull(rim)
}

/** 樹木の影が view の外からはみ出してくる最大の距離（m） */
const TREE_MARGIN_M = 60

/** 平面座標の点の外接矩形 */
function boxOf(points: XY[]): ViewBox {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

const outsideView = (box: ViewBox, view: ViewBox, margin: number) =>
  box.maxX + margin < view.minX || box.minX - margin > view.maxX || box.maxY + margin < view.minY || box.minY - margin > view.maxY

/** 影の形をまとめて作る。view を渡すと、その範囲に影が届かない建物・木は省く */
export function buildShadowShapes(
  buildings: Building[],
  trees: Tree[],
  sun: SunPosition,
  proj: LocalProjection,
  view?: ViewBox,
): ShadowShapes {
  const shapes: ShadowShapes = { buildings: [], trees: [] }
  if (sun.altitude <= LOW_SUN_DEG) return shapes

  for (const b of buildings) {
    const ring = b.footprint.map((p) => proj.toXY(p))
    if (view && outsideView(boxOf(ring), view, shadowReach(b.height, sun))) continue
    shapes.buildings.push(...buildingShadowXY(ring, b.height, b.minHeight, sun).filter((part) => part.length >= 3))
  }

  for (const t of trees) {
    const c = proj.toXY(t.position)
    if (view && outsideView({ minX: c.x, minY: c.y, maxX: c.x, maxY: c.y }, view, TREE_MARGIN_M)) continue
    const shadow = treeShadowXY(c, t.crownRadius, t.height, treeCrownBase(t.height), sun)
    if (shadow.length >= 3) shapes.trees.push(shadow)
  }
  return shapes
}
