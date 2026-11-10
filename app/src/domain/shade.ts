import { distanceToSegment, LocalProjection, pointInRing, segmentHitsRing } from './geo.ts'
import { treeCrownBase } from './osm.ts'
import { sunPosition } from './sun.ts'
import { jstDate } from './time.ts'
import type { Building, LatLng, ShadeState, ShadeTimeline, SunPosition, Tree, WeatherCondition, XY } from './types.ts'

// 2026-11-10 期間内に書き直し。
//
// 日陰の判定（建物の高さと太陽の位置から幾何で求める）。
//
// 地点 P から太陽の方向へ水平に距離 t 進んだ真上では、P に届く光線の高さは t·tan(太陽高度)。
// 下端 hb・上端 h の障害物は、t が [hb/tan, h/tan] の区間で光線をさえぎる可能性がある。
// この区間の水平な線分が障害物の輪郭（木は樹冠の円）と交われば、P は日陰。
// 平らな屋根の建物なら厳密、木は樹冠を円柱とみなした推定。

/** 太陽高度がこの値（度）以下なら「日差しなし」。影が長すぎて判定する意味が薄い */
export const LOW_SUN_DEG = 2
/** 影を探す最大の距離（m） */
export const MAX_SHADOW_M = 1500

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type Obstacle = Box & {
  id: string
  /** 上端・下端の高さ（m） */
  top: number
  bottom: number
  /** 同じ線分で二度数えないための印 */
  visit: number
} & ({ kind: 'building'; ring: XY[] } | { kind: 'tree'; center: XY; radius: number })

function ringBox(ring: XY[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const { x, y } of ring) {
    if (x < box.minX) box.minX = x
    if (y < box.minY) box.minY = y
    if (x > box.maxX) box.maxX = x
    if (y > box.maxY) box.maxY = y
  }
  return box
}

const segmentMissesBox = (a: XY, b: XY, o: Box) =>
  Math.max(a.x, b.x) < o.minX || Math.min(a.x, b.x) > o.maxX || Math.max(a.y, b.y) < o.minY || Math.min(a.y, b.y) > o.maxY

/** 格子 1 マスを 1 つの数にする（±50,000 マスまで） */
const cellKey = (cx: number, cy: number) => (cx + 50_000) * 100_000 + (cy + 50_000)

/** 線分に沿ってたどるマスの上限（暴走防止） */
const MAX_CELL_STEPS = 4000

export class ShadeEngine {
  readonly proj: LocalProjection
  readonly obstacleCount: number
  private readonly cellSize: number
  private readonly cells = new Map<number, Obstacle[]>()
  /** 一番高い障害物（m）。光線をたどる距離の上限を決める */
  private readonly tallest: number
  private visitCounter = 0

  constructor(buildings: Building[], trees: Tree[], origin: LatLng, cellSize = 40) {
    this.proj = new LocalProjection(origin)
    this.cellSize = cellSize

    const obstacles: Obstacle[] = []
    for (const b of buildings) {
      const ring = b.footprint.map((p) => this.proj.toXY(p))
      obstacles.push({ kind: 'building', id: b.id, ring, top: b.height, bottom: b.minHeight, visit: 0, ...ringBox(ring) })
    }
    for (const t of trees) {
      const center = this.proj.toXY(t.position)
      const radius = t.crownRadius
      obstacles.push({
        kind: 'tree',
        id: t.id,
        center,
        radius,
        top: t.height,
        bottom: treeCrownBase(t.height),
        visit: 0,
        minX: center.x - radius,
        minY: center.y - radius,
        maxX: center.x + radius,
        maxY: center.y + radius,
      })
    }

    for (const o of obstacles) this.index(o)
    this.tallest = obstacles.reduce((max, o) => Math.max(max, o.top), 0)
    this.obstacleCount = obstacles.length
  }

  private cellOf(v: number): number {
    return Math.floor(v / this.cellSize)
  }

  /** 障害物の外接矩形が重なるマスすべてに登録する */
  private index(o: Obstacle): void {
    for (let cx = this.cellOf(o.minX); cx <= this.cellOf(o.maxX); cx++) {
      for (let cy = this.cellOf(o.minY); cy <= this.cellOf(o.maxY); cy++) {
        const key = cellKey(cx, cy)
        const bucket = this.cells.get(key)
        if (bucket) bucket.push(o)
        else this.cells.set(key, [o])
      }
    }
  }

  /**
   * 線分 from→to が通るマスの障害物を重複なしで集める。
   * マスの境界を越える順にたどる（Amanatides & Woo の方法）。
   * nextX / nextY は「次に縦・横のマス境界を越える位置」を線分上の割合（0〜1）で表したもの。
   */
  private obstaclesAlong(from: XY, to: XY): Obstacle[] {
    const visit = ++this.visitCounter
    const found: Obstacle[] = []
    const size = this.cellSize
    const dx = to.x - from.x
    const dy = to.y - from.y

    let cx = this.cellOf(from.x)
    let cy = this.cellOf(from.y)
    const stepX = dx > 0 ? 1 : -1
    const stepY = dy > 0 ? 1 : -1
    const spanX = dx === 0 ? Infinity : Math.abs(size / dx)
    const spanY = dy === 0 ? Infinity : Math.abs(size / dy)
    let nextX = dx === 0 ? Infinity : ((dx > 0 ? cx + 1 : cx) * size - from.x) / dx
    let nextY = dy === 0 ? Infinity : ((dy > 0 ? cy + 1 : cy) * size - from.y) / dy

    for (let steps = 0; steps < MAX_CELL_STEPS; steps++) {
      for (const o of this.cells.get(cellKey(cx, cy)) ?? []) {
        if (o.visit === visit) continue
        o.visit = visit
        found.push(o)
      }
      if (nextX > 1 && nextY > 1) break // 線分の終わりがこのマスの中
      if (nextX < nextY) {
        nextX += spanX
        cx += stepX
      } else {
        nextY += spanY
        cy += stepY
      }
    }
    return found
  }

  /** 平面座標の点 p の状態。roof=true は屋根の下 */
  stateAtXY(p: XY, sun: SunPosition, roof = false): ShadeState {
    if (sun.altitude <= LOW_SUN_DEG) return 'night'
    if (roof) return 'roof'

    const tan = Math.tan((sun.altitude * Math.PI) / 180)
    const az = (sun.azimuth * Math.PI) / 180
    const toSun = { x: Math.sin(az), y: Math.cos(az) }
    const along = (t: number): XY => ({ x: p.x + toSun.x * t, y: p.y + toSun.y * t })

    const reach = Math.min(MAX_SHADOW_M, this.tallest / tan)
    let underTree = false
    for (const o of this.obstaclesAlong(p, along(reach))) {
      const near = o.bottom / tan
      const far = Math.min(o.top / tan, MAX_SHADOW_M)
      if (near > far) continue
      const a = along(near)
      const b = along(far)
      if (segmentMissesBox(a, b, o)) continue
      if (o.kind === 'building') {
        // 建物の影は木陰より優先するので、見つかった時点で決まり
        if (segmentHitsRing(a, b, o.ring)) return 'building'
      } else if (!underTree && distanceToSegment(o.center, a, b) <= o.radius) {
        underTree = true
      }
    }
    return underTree ? 'tree' : 'sun'
  }

  /**
   * ベンチなど広さのある場所の日陰の度合い。中心と前後左右 spread m の 5 点を調べ、
   * 日陰だった点の割合で「日陰の可能性高 / 一部日陰 / 日なた」に分ける。
   */
  coverageAtXY(p: XY, sun: SunPosition, roof = false, spread = 1.5): ShadeCoverage {
    const center = this.stateAtXY(p, sun, roof)
    if (center === 'roof') return { level: 'roof', ratio: 1, state: center }
    if (center === 'night') return { level: 'night', ratio: 0, state: center }

    const around: XY[] = [
      { x: p.x + spread, y: p.y },
      { x: p.x - spread, y: p.y },
      { x: p.x, y: p.y + spread },
      { x: p.x, y: p.y - spread },
    ]
    const states = [center, ...around.map((q) => this.stateAtXY(q, sun, false))]
    const ratio = states.filter(isShaded).length / states.length
    const level = ratio >= 0.8 ? 'high' : ratio >= 0.2 ? 'partial' : 'sun'
    return { level, ratio, state: center }
  }

  stateAt(p: LatLng, time: Date, roof = false): ShadeState {
    return this.stateAtXY(this.proj.toXY(p), sunPosition(time, this.proj.origin), roof)
  }

  /** 1 日の移り変わり。日本時間の startMin〜endMin を stepMin 分ごとに判定する */
  timeline(spotId: string, p: LatLng, roof: boolean, dateKey: string, startMin = 300, endMin = 1140, stepMin = 10): ShadeTimeline {
    const xy = this.proj.toXY(p)
    const states: ShadeState[] = []
    for (let minute = startMin; minute <= endMin; minute += stepMin) {
      const sun = sunPosition(jstDate(dateKey, minute), this.proj.origin)
      states.push(this.stateAtXY(xy, sun, roof))
    }
    return { spotId, dateKey, startMin, stepMin, states }
  }

  /** 点 p が建物（屋根を含む）の輪郭の中か。投稿された地点の屋根の推定に使う */
  insideBuilding(p: LatLng): boolean {
    const xy = this.proj.toXY(p)
    const bucket = this.cells.get(cellKey(this.cellOf(xy.x), this.cellOf(xy.y))) ?? []
    return bucket.some((o) => o.kind === 'building' && pointInRing(xy, o.ring))
  }
}

// ───────── 状態の扱い・時間帯のまとめ ─────────

const SHADED_STATES: ReadonlySet<ShadeState> = new Set<ShadeState>(['building', 'tree', 'roof', 'cloud'])
export const isShaded = (s: ShadeState) => SHADED_STATES.has(s)

/** 直射日光が届かない天気。「晴れ時々くもり」は日が差すので入れない */
export const OVERCAST: ReadonlySet<WeatherCondition> = new Set<WeatherCondition>(['cloudy', 'fog', 'rain', 'heavy-rain', 'snow'])

/**
 * 幾何で求めた状態に天気を重ねる。くもりの日は影ができず街全体が日陰なので、
 * 屋外（日なた・建物の影・木陰）は「くもり」にする。屋根の下と夜はそのまま。
 */
export function weatherShade(s: ShadeState, condition: WeatherCondition | null | undefined): ShadeState {
  const outdoor = s === 'sun' || s === 'building' || s === 'tree'
  return outdoor && condition != null && OVERCAST.has(condition) ? 'cloud' : s
}

export interface ShadeWindow {
  startMin: number
  endMin: number
  kind: 'building' | 'tree' | 'roof'
}

const WINDOW_KINDS: ReadonlyArray<ShadeWindow['kind']> = ['building', 'tree', 'roof']

/** 日陰が minLengthMin 分以上続く時間帯。種類はその間で一番多かったもの（同数なら建物 > 木 > 屋根） */
export function shadeWindows(tl: ShadeTimeline, minLengthMin = 20): ShadeWindow[] {
  const windows: ShadeWindow[] = []
  const minuteAt = (index: number) => tl.startMin + index * tl.stepMin

  let i = 0
  while (i < tl.states.length) {
    if (!isShaded(tl.states[i])) {
      i++
      continue
    }
    const begin = i
    const tally = { building: 0, tree: 0, roof: 0 }
    for (; i < tl.states.length && isShaded(tl.states[i]); i++) {
      const s = tl.states[i]
      if (s in tally) tally[s as ShadeWindow['kind']]++
    }
    const startMin = minuteAt(begin)
    const endMin = minuteAt(i)
    if (endMin - startMin >= minLengthMin) {
      const kind = WINDOW_KINDS.reduce((best, k) => (tally[k] > tally[best] ? k : best))
      windows.push({ startMin, endMin, kind })
    }
  }
  return windows
}

export interface ShadeOutlook {
  state: ShadeState
  /** いま日陰なら日なたになるまで、日なたなら日陰になるまでの分。分からなければ null */
  minutesToChange: number | null
}

export function shadeOutlook(tl: ShadeTimeline, minutesOfDay: number, current: ShadeState): ShadeOutlook {
  const unknown = { state: current, minutesToChange: null }
  if (current === 'night' || current === 'roof') return unknown

  const shadedNow = isShaded(current)
  const firstIndex = Math.max(0, Math.ceil((minutesOfDay - tl.startMin) / tl.stepMin))
  for (let i = firstIndex; i < tl.states.length; i++) {
    const s = tl.states[i]
    if (s === 'night') return unknown
    if (isShaded(s) !== shadedNow) {
      return { state: current, minutesToChange: Math.max(0, tl.startMin + i * tl.stepMin - minutesOfDay) }
    }
  }
  return unknown
}

export const SHADE_LABEL: Record<ShadeState, string> = {
  sun: '日なた',
  building: '日陰（建物）',
  tree: '木陰（推定）',
  roof: '屋根の下',
  night: '日差しなし',
  cloud: 'くもり（日差しなし）',
}

export interface ShadeCoverage {
  level: 'high' | 'partial' | 'sun' | 'night' | 'roof'
  /** 調べた点のうち日陰だった割合（0〜1） */
  ratio: number
  /** 中心の点の状態（一覧の「日陰／日なた」と同じ） */
  state: ShadeState
}

export const COVERAGE_LABEL: Record<ShadeCoverage['level'], string> = {
  high: '日陰の可能性高',
  partial: '一部日陰',
  sun: '日なた',
  night: '日差しなし',
  roof: '屋根の下',
}
