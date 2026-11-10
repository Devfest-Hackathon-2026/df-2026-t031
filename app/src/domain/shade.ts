// 日陰の判定。建物（外形と高さ）と樹木（樹冠）に、太陽の方向から光を当てて影になるかを調べる。2026-11-10 に書き直し
import { LocalProjection, pointInRing } from './geo.ts'
import { jstDate } from './time.ts'
import { sunPosition } from './sun.ts'
import type { Building, LatLng, ShadeState, ShadeTimeline, SunPosition, Tree, WeatherCondition, XY } from './types.ts'

interface Solid { ring: XY[]; height: number; minHeight: number; kind: Building['kind']; minX: number; maxX: number; minY: number; maxY: number }
interface Crown { c: XY; r: number; top: number; bottom: number }
const CELL = 40
const rad = (d: number) => (d * Math.PI) / 180

/** 線分 a→b と線分 c→d の交点の、a からの割合 t（交わらなければ null） */
function hitT(a: XY, b: XY, c: XY, d: XY): number | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-12) return null
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den, u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}

export class ShadeEngine {
  readonly proj: LocalProjection
  private solids: Solid[] = []
  private crowns: Crown[] = []
  private grid = new Map<string, number[]>()
  private treeGrid = new Map<string, number[]>()
  private maxHeight = 0
  private timelines = new Map<string, ShadeTimeline>()

  constructor(buildings: Building[], trees: Tree[], origin: LatLng) {
    this.proj = new LocalProjection(origin)
    for (const b of buildings) {
      if (b.footprint.length < 3 || !(b.height > 0)) continue
      const ring = b.footprint.map((p) => this.proj.toXY(p))
      const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y)
      const s: Solid = { ring, height: b.height, minHeight: b.minHeight || 0, kind: b.kind ?? 'building', minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
      const i = this.solids.push(s) - 1
      this.maxHeight = Math.max(this.maxHeight, s.height)
      for (let gx = Math.floor(s.minX / CELL); gx <= Math.floor(s.maxX / CELL); gx++) for (let gy = Math.floor(s.minY / CELL); gy <= Math.floor(s.maxY / CELL); gy++) this.push(this.grid, gx, gy, i)
    }
    for (const t of trees) {
      if (!(t.height > 0) || !(t.crownRadius > 0)) continue
      const c = this.proj.toXY(t.position)
      const i = this.crowns.push({ c, r: t.crownRadius, top: t.height, bottom: t.height * 0.35 }) - 1
      this.maxHeight = Math.max(this.maxHeight, t.height)
      this.push(this.treeGrid, Math.floor(c.x / CELL), Math.floor(c.y / CELL), i)
    }
  }
  private push(g: Map<string, number[]>, x: number, y: number, i: number) { const k = x + ',' + y; const a = g.get(k); if (a) a.push(i); else g.set(k, [i]) }

  /** 光線 p→太陽 が通るマス目にある建物・樹木の番号 */
  private along(g: Map<string, number[]>, p: XY, dx: number, dy: number, reach: number) {
    const out = new Set<number>()
    const steps = Math.ceil(reach / (CELL / 2)) + 1
    for (let k = 0; k <= steps; k++) {
      const x = p.x + dx * Math.min(reach, k * CELL / 2), y = p.y + dy * Math.min(reach, k * CELL / 2)
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL)
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (const i of g.get(cx + ox + ',' + (cy + oy)) ?? []) out.add(i)
    }
    return out
  }

  /** 1 点の状態。roof = その地点自体に屋根がある */
  stateAtXY(p: XY, sun: SunPosition, roof = false): ShadeState {
    if (sun.altitude <= 0) return 'night'
    if (roof) return 'roof'
    const tanAlt = Math.tan(rad(Math.max(0.5, sun.altitude)))
    const reach = Math.min(1500, this.maxHeight / tanAlt)
    const dx = Math.sin(rad(sun.azimuth)), dy = Math.cos(rad(sun.azimuth))
    const end = { x: p.x + dx * reach, y: p.y + dy * reach }
    for (const i of this.along(this.grid, p, dx, dy, reach)) {
      const s = this.solids[i]
      if (s.minX > Math.max(p.x, end.x) || s.maxX < Math.min(p.x, end.x) || s.minY > Math.max(p.y, end.y) || s.maxY < Math.min(p.y, end.y)) continue
      // 光線が建物の外形の上を通る区間（入口〜出口。p が中なら入口は 0）
      const inside = pointInRing(p, s.ring)
      let entry = inside ? 0 : Infinity, exit = inside ? 0 : -Infinity
      for (let j = 0, k = s.ring.length - 1; j < s.ring.length; k = j++) { const t = hitT(p, end, s.ring[k], s.ring[j]); if (t !== null) { entry = Math.min(entry, t * reach); exit = Math.max(exit, t * reach) } }
      if (!Number.isFinite(entry)) continue
      if (inside && s.kind === 'roof') return 'roof'
      // その区間での光の高さが、建物の下端〜上端と重なれば影
      if (entry * tanAlt < s.height && Math.max(exit, entry) * tanAlt >= s.minHeight) return 'building'
    }
    for (const i of this.along(this.treeGrid, p, dx, dy, reach)) {
      const t = this.crowns[i]
      const vx = t.c.x - p.x, vy = t.c.y - p.y
      const d = vx * dx + vy * dy
      if (d < 0) continue
      const off = Math.abs(vx * dy - vy * dx)
      if (off > t.r) continue
      const z = d * tanAlt
      if (z <= t.top && z >= t.bottom - t.r * 0.5) return 'tree'
    }
    return 'sun'
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

  stateAt(p: LatLng, sun: SunPosition, roof = false) { return this.stateAtXY(this.proj.toXY(p), sun, roof) }

  /** 1 日の日陰の移り変わり（startMin〜endMin を stepMin ごと）。地点と日付ごとに覚えておく */
  timeline(id: string, position: LatLng, roof: boolean, day: string, startMin = 360, endMin = 1140, stepMin = 15): ShadeTimeline {
    const key = `${id}|${day}|${roof}|${startMin}|${endMin}|${stepMin}`
    const hit = this.timelines.get(key)
    if (hit) return hit
    const p = this.proj.toXY(position), states: ShadeState[] = []
    for (let m = startMin; m <= endMin; m += stepMin) states.push(this.stateAtXY(p, sunPosition(jstDate(day, m), this.proj.origin), roof))
    const tl = { startMin, stepMin, states }
    if (this.timelines.size > 4000) this.timelines.clear()
    this.timelines.set(key, tl)
    return tl
  }
}

export const isShaded = (s: ShadeState) => s === 'building' || s === 'tree' || s === 'roof' || s === 'cloud'

/** 直射日光が届かない天気（くもり・霧・雨・雪）。晴れ時々くもりは日が差すので含めない */
export const OVERCAST: ReadonlySet<WeatherCondition> = new Set<WeatherCondition>(['cloudy', 'fog', 'rain', 'heavy-rain', 'snow'])
/** 建物と太陽で求めた状態に天気を重ねる。くもりの日は影がなく街全体が日陰なので、屋外は日なたも建物の影も「くもり（日差しなし）」にする（屋根の下と夜はそのまま） */
export const weatherShade = (s: ShadeState, condition: WeatherCondition | null | undefined): ShadeState => (s === 'sun' || s === 'building' || s === 'tree') && condition && OVERCAST.has(condition) ? 'cloud' : s

/** 日陰が続く時間帯（夜は含めない） */
export function shadeWindows(tl: ShadeTimeline): { startMin: number; endMin: number }[] {
  const out: { startMin: number; endMin: number }[] = []
  let start: number | null = null
  tl.states.forEach((s, i) => {
    const m = tl.startMin + i * tl.stepMin
    const on = s !== 'night' && isShaded(s)
    if (on && start === null) start = m
    if (!on && start !== null) { out.push({ startMin: start, endMin: m }); start = null }
  })
  if (start !== null) out.push({ startMin: start, endMin: tl.startMin + tl.states.length * tl.stepMin })
  return out
}

export const SHADE_LABEL: Record<ShadeState, string> = {
  sun: '日なた',
  building: '建物の影',
  tree: '木陰',
  roof: '屋根の下',
  night: '日没後',
  cloud: 'くもり（日差しなし）',
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
