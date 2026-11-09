import { distanceToSegment, LocalProjection, pointInRing, segmentHitsRing } from './geo.ts'
import { treeCrownBase } from './osm.ts'
import { sunPosition } from './sun.ts'
import { jstDate } from './time.ts'
import type { Building, LatLng, ShadeState, ShadeTimeline, SunPosition, Tree, XY } from './types.ts'

/**
 * 日陰の計算（方式 A：建物の高さ + 太陽の位置）。
 *
 * 地点 P が日陰になる条件：P から太陽の方向へ水平に t 進んだ点で、光線の高さは t·tan(高度)。
 * 障害物の下端 hb〜上端 h の間を光線が通る区間 t ∈ [hb/tanα, h/tanα] の水平線分が、
 * 障害物の輪郭（樹木は樹冠の円）と重なれば、光はさえぎられる。
 * 角柱（平らな屋根の建物）なら厳密。樹木は円柱で近似した推定。
 */

/** 太陽の高度がこれ以下なら「日差しなし」とみなす（度）。低い太陽の影は長すぎて計算しても意味が薄い */
export const LOW_SUN_DEG = 2
/** 影を探す最大の距離（m） */
export const MAX_SHADOW_M = 1500

interface Obstacle {
  kind: 'building' | 'tree'
  id: string
  ring: XY[] | null
  c: XY | null
  r: number
  h: number
  hb: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  stamp: number
}

export class ShadeEngine {
  readonly proj: LocalProjection
  private readonly cell: number
  private readonly grid = new Map<number, Obstacle[]>()
  private readonly maxHeight: number
  private stamp = 0
  readonly obstacleCount: number

  constructor(buildings: Building[], trees: Tree[], origin: LatLng, cellSize = 40) {
    this.proj = new LocalProjection(origin)
    this.cell = cellSize
    let maxH = 0
    const obstacles: Obstacle[] = []
    for (const b of buildings) {
      const ring = b.footprint.map((p) => this.proj.toXY(p))
      const o = withBox({ kind: 'building', id: b.id, ring, c: null, r: 0, h: b.height, hb: b.minHeight, stamp: 0 }, ring)
      obstacles.push(o)
      maxH = Math.max(maxH, b.height)
    }
    for (const t of trees) {
      const c = this.proj.toXY(t.position)
      const r = t.crownRadius
      const hb = treeCrownBase(t.height)
      obstacles.push({ kind: 'tree', id: t.id, ring: null, c, r, h: t.height, hb, minX: c.x - r, minY: c.y - r, maxX: c.x + r, maxY: c.y + r, stamp: 0 })
      maxH = Math.max(maxH, t.height)
    }
    for (const o of obstacles) {
      for (let ix = this.ix(o.minX); ix <= this.ix(o.maxX); ix++) {
        for (let iy = this.ix(o.minY); iy <= this.ix(o.maxY); iy++) {
          const k = key(ix, iy)
          const list = this.grid.get(k)
          if (list) list.push(o)
          else this.grid.set(k, [o])
        }
      }
    }
    this.maxHeight = maxH
    this.obstacleCount = obstacles.length
  }

  private ix(v: number): number {
    return Math.floor(v / this.cell)
  }

  /** P から太陽の方向へ伸ばした線分が通るセルの障害物（重複なし） */
  private candidates(p: XY, end: XY, out: Obstacle[]): void {
    this.stamp++
    // 格子の上を線分に沿って進む（Amanatides & Woo）
    // tMaxX / tMaxY は「次の縦／横の格子線を越えるときの、線分上の位置（0〜1）」
    let ix = this.ix(p.x)
    let iy = this.ix(p.y)
    const dx = end.x - p.x
    const dy = end.y - p.y
    const stepX = dx > 0 ? 1 : -1
    const stepY = dy > 0 ? 1 : -1
    const tDeltaX = dx === 0 ? Infinity : Math.abs(this.cell / dx)
    const tDeltaY = dy === 0 ? Infinity : Math.abs(this.cell / dy)
    let tMaxX = dx === 0 ? Infinity : ((dx > 0 ? (ix + 1) * this.cell : ix * this.cell) - p.x) / dx
    let tMaxY = dy === 0 ? Infinity : ((dy > 0 ? (iy + 1) * this.cell : iy * this.cell) - p.y) / dy
    for (let guard = 0; guard < 4000; guard++) {
      const list = this.grid.get(key(ix, iy))
      if (list) {
        for (const o of list) {
          if (o.stamp !== this.stamp) {
            o.stamp = this.stamp
            out.push(o)
          }
        }
      }
      // 線分の終点がこのセルの中にある
      if (tMaxX > 1 && tMaxY > 1) break
      if (tMaxX < tMaxY) {
        tMaxX += tDeltaX
        ix += stepX
      } else {
        tMaxY += tDeltaY
        iy += stepY
      }
    }
  }

  /** 点 p（平面座標）の日陰の状態。roof=true なら屋根の下 */
  stateAtXY(p: XY, sun: SunPosition, roof = false): ShadeState {
    if (sun.altitude <= LOW_SUN_DEG) return 'night'
    if (roof) return 'roof'
    const tan = Math.tan((sun.altitude * Math.PI) / 180)
    const az = (sun.azimuth * Math.PI) / 180
    const sx = Math.sin(az)
    const sy = Math.cos(az)
    const len = Math.min(MAX_SHADOW_M, this.maxHeight / tan)
    const end = { x: p.x + sx * len, y: p.y + sy * len }
    const cands: Obstacle[] = []
    this.candidates(p, end, cands)
    let tree = false
    for (const o of cands) {
      const t1 = o.hb / tan
      const t2 = Math.min(o.h / tan, MAX_SHADOW_M)
      if (t1 > t2) continue
      const a = { x: p.x + sx * t1, y: p.y + sy * t1 }
      const b = { x: p.x + sx * t2, y: p.y + sy * t2 }
      // 外接矩形で先にふるい落とす
      if (Math.max(a.x, b.x) < o.minX || Math.min(a.x, b.x) > o.maxX || Math.max(a.y, b.y) < o.minY || Math.min(a.y, b.y) > o.maxY) continue
      if (o.kind === 'building') {
        if (segmentHitsRing(a, b, o.ring!)) return 'building'
      } else if (!tree && distanceToSegment(o.c!, a, b) <= o.r) {
        tree = true
      }
    }
    return tree ? 'tree' : 'sun'
  }

  /**
   * ベンチなど「広さのある場所」の日陰の割合。中心と前後左右（約 1.5 m）の 5 点を調べ、
   * 日陰の点の割合から「日陰の可能性高／一部日陰／日なた」に分ける（SHADE SPOT の 3 段階表示）。
   */
  coverageAtXY(p: XY, sun: SunPosition, roof = false, spread = 1.5): ShadeCoverage {
    const center = this.stateAtXY(p, sun, roof)
    if (center === 'night' || center === 'roof') return { level: center, ratio: center === 'roof' ? 1 : 0, state: center }
    const pts = [p, { x: p.x + spread, y: p.y }, { x: p.x - spread, y: p.y }, { x: p.x, y: p.y + spread }, { x: p.x, y: p.y - spread }]
    const shaded = pts.filter((q, i) => isShaded(i === 0 ? center : this.stateAtXY(q, sun, false))).length
    const ratio = shaded / pts.length
    return { level: ratio >= 0.8 ? 'high' : ratio >= 0.2 ? 'partial' : 'sun', ratio, state: center }
  }

  stateAt(p: LatLng, time: Date, roof = false): ShadeState {
    return this.stateAtXY(this.proj.toXY(p), sunPosition(time, this.proj.origin), roof)
  }

  /** 1 日の日陰の移り変わり（JST の startMin〜endMin を stepMin ごと） */
  timeline(spotId: string, p: LatLng, roof: boolean, dateKey: string, startMin = 300, endMin = 1140, stepMin = 10): ShadeTimeline {
    const xy = this.proj.toXY(p)
    const states: ShadeState[] = []
    for (let m = startMin; m <= endMin; m += stepMin) {
      states.push(this.stateAtXY(xy, sunPosition(jstDate(dateKey, m), this.proj.origin), roof))
    }
    return { spotId, dateKey, startMin, stepMin, states }
  }

  /** 点 p が屋根・建物の中か（投稿した地点の屋根の推定に使う） */
  insideBuilding(p: LatLng): boolean {
    const xy = this.proj.toXY(p)
    const list = this.grid.get(key(this.ix(xy.x), this.ix(xy.y))) ?? []
    return list.some((o) => o.kind === 'building' && pointInRing(xy, o.ring!))
  }
}

function key(ix: number, iy: number): number {
  return (ix + 50_000) * 100_000 + (iy + 50_000)
}

function withBox(o: Omit<Obstacle, 'minX' | 'minY' | 'maxX' | 'maxY'>, ring: XY[]): Obstacle {
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
  return { ...o, minX, minY, maxX, maxY }
}

// ───────── 日陰の時間帯の要約 ─────────

export const isShaded = (s: ShadeState) => s === 'building' || s === 'tree' || s === 'roof'

export interface ShadeWindow {
  startMin: number
  endMin: number
  kind: 'building' | 'tree' | 'roof'
}

/** 日が出ている間の、日陰が続く時間帯（stepMin 未満の途切れは無視しない） */
export function shadeWindows(tl: ShadeTimeline, minLengthMin = 20): ShadeWindow[] {
  const out: ShadeWindow[] = []
  let start = -1
  const counts = { building: 0, tree: 0, roof: 0 }
  const flush = (endIndex: number) => {
    if (start < 0) return
    const startMin = tl.startMin + start * tl.stepMin
    const endMin = tl.startMin + endIndex * tl.stepMin
    if (endMin - startMin >= minLengthMin) {
      const kind = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as ShadeWindow['kind']) ?? 'building'
      out.push({ startMin, endMin, kind })
    }
    start = -1
    counts.building = counts.tree = counts.roof = 0
  }
  tl.states.forEach((s, i) => {
    if (isShaded(s)) {
      if (start < 0) start = i
      counts[s as ShadeWindow['kind']]++
    } else {
      flush(i)
    }
  })
  flush(tl.states.length)
  return out
}

export interface ShadeOutlook {
  state: ShadeState
  /** いま日陰なら「日なたになるまで」、日なたなら「日陰になるまで」の分。分からなければ null */
  minutesToChange: number | null
}

export function shadeOutlook(tl: ShadeTimeline, minutesOfDay: number, current: ShadeState): ShadeOutlook {
  if (current === 'night' || current === 'roof') return { state: current, minutesToChange: null }
  const shadedNow = isShaded(current)
  const from = Math.max(0, Math.ceil((minutesOfDay - tl.startMin) / tl.stepMin))
  for (let i = from; i < tl.states.length; i++) {
    const s = tl.states[i]
    if (s === 'night') return { state: current, minutesToChange: null }
    if (isShaded(s) !== shadedNow) return { state: current, minutesToChange: Math.max(0, tl.startMin + i * tl.stepMin - minutesOfDay) }
  }
  return { state: current, minutesToChange: null }
}

export const SHADE_LABEL: Record<ShadeState, string> = {
  sun: '日なた',
  building: '日陰（建物）',
  tree: '木陰（推定）',
  roof: '屋根の下',
  night: '日差しなし',
}

export interface ShadeCoverage {
  level: 'high' | 'partial' | 'sun' | 'night' | 'roof'
  /** 調べた点のうち日陰だった割合（0〜1） */
  ratio: number
  /** 中心の点の状態（一覧の「日陰／日なた」と同じもの） */
  state: ShadeState
}

export const COVERAGE_LABEL: Record<ShadeCoverage['level'], string> = {
  high: '日陰の可能性高',
  partial: '一部日陰',
  sun: '日なた',
  night: '日差しなし',
  roof: '屋根の下',
}
