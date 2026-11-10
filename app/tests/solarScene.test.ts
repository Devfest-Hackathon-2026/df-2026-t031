// 2026-11-10 期間内に書き直し。
// 3D 表示の太陽・影と、街モデルの組み立ての仕様テスト。
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { nextSolarMoment, shadowRatio, solarMoments, solarTrack, solarVector } from '../src/domain/solarScene.ts'
import { createCity, createContext, disposeObject, worldPoint } from '../src/components/cityGeometry.ts'
import { AREA_CENTER } from '../src/domain/area.ts'
import { LocalProjection } from '../src/domain/geo.ts'

const DAY = '2026-11-05'
const projection = new LocalProjection(AREA_CENTER)

describe('太陽の向きと動き', () => {
  it('座標は 東 = +X・上 = +Y・北 = -Z で、光源と表示で共通', () => {
    expect(solarVector({ azimuth: 90, altitude: 0 }).x).toBeCloseTo(1)
    expect(solarVector({ azimuth: 0, altitude: 90 }).y).toBeCloseTo(1)
    expect(solarVector({ azimuth: 0, altitude: 0 }).z).toBeCloseTo(-1)
  })

  it('南西・高度 30° の太陽は西寄り・南寄りにあり、影は北東へ落ちる', () => {
    const v = solarVector({ azimuth: 225, altitude: 30 })
    expect(v.x).toBeLessThan(0)
    expect(v.z).toBeGreaterThan(0)
    expect(v.y).toBeCloseTo(0.5)
  })

  it('一日の軌道は地平線より上の点だけで、どれも指定した半径の球面上', () => {
    const track = solarTrack(DAY, AREA_CENTER, 145)
    expect(track.length).toBeGreaterThan(50)
    for (const { point } of track) {
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(145)
    }
  })

  it('薄明 → 日の出 → 朝のゴールデンアワー → 南中 → 夕方のゴールデンアワー → 日の入り → 薄暮 の順', () => {
    const m = solarMoments(DAY, AREA_CENTER)
    const order = [m.dawn!, m.sunrise!, m.goldenMorningEnd!, m.noon, m.goldenEveningStart!, m.sunset!, m.dusk!]
    for (let i = 1; i < order.length; i++) expect(order[i - 1]).toBeLessThan(order[i])
  })

  it('次の出来事を返し、薄暮より後なら翌朝の最初の光を返す', () => {
    const m = solarMoments(DAY, AREA_CENTER)
    expect(nextSolarMoment(m, m.sunrise! - 1)!.label).toBe('日の出')
    expect(nextSolarMoment(m, m.noon)!.label).toBe('日没')
    const tomorrow = nextSolarMoment(m, m.dusk! + 10)!
    expect(tomorrow.label).toBe('最初の光')
    expect(tomorrow.at).toBe(m.dawn! + 24 * 60)
    expect(tomorrow.inMin).toBeGreaterThan(0)
  })

  it('影の長さ（高さの何倍か）は 1/tan(高度)。太陽が低すぎる・沈んでいるときは出さない', () => {
    expect(shadowRatio(45)).toBeCloseTo(1)
    expect(shadowRatio(30)).toBeCloseTo(Math.sqrt(3))
    expect(shadowRatio(1)).toBeNull()
    expect(shadowRatio(-10)).toBeNull()
  })
})

describe('街の 3D モデル', () => {
  it('緯度経度は日陰計算と同じ投影で置き、北は -Z', () => {
    const p = { lat: 35.455, lng: 139.64 }
    const flat = projection.toXY(p)
    const world = worldPoint(p, 12)
    expect(world.x).toBeCloseTo(flat.x)
    expect(world.z).toBeCloseTo(-flat.y)
    expect(world.y).toBe(12)
  })

  it('道路の面は上を向き、影を受ける', () => {
    const context = createContext({ features: [{ id: 1, kind: 'road', roadType: 'residential', points: [[35.455, 139.63], [35.455, 139.632]] }] })
    expect(context.children.length).toBe(2)
    for (const child of context.children) {
      const mesh = child as THREE.Mesh
      expect(mesh.receiveShadow).toBe(true)
      expect(mesh.geometry.getAttribute('normal').getY(0)).toBeGreaterThan(0.9)
    }
    disposeObject(context)
  })

  it('建物は 1 棟ずつではなくまとめて描き、片付けでジオメトリを解放する', () => {
    const square = (x: number) => [0, 10].flatMap((dy) => (dy === 0 ? [[x, 0], [x + 10, 0]] : [[x + 10, 10], [x, 10]]))
      .map(([px, py]) => projection.toLatLng({ x: px, y: py }))
    const buildings = Array.from({ length: 24 }, (_, i) => ({
      id: String(i), kind: 'building' as const, footprint: square(i * 20), height: 15, minHeight: 0, heightSource: 'measured' as const,
    }))
    const city = createCity({
      buildings, trees: [], parks: [], spots: [], attractors: [],
      meta: { sourceLabel: 'test', attribution: '', asOf: null, live: false },
    })
    expect(city.children.length).toBeLessThan(12)

    let released = 0
    city.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.addEventListener('dispose', () => released++)
    })
    disposeObject(city)
    expect(released).toBeGreaterThan(0)
  })
})
