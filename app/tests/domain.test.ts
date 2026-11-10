// 2026-11-10 期間内に書き直し。
// 時刻・太陽・日陰・空席予測・保存データの仕様テスト。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { AREA_CENTER } from '../src/domain/area.ts'
import { LocalProjection, pointInRing } from '../src/domain/geo.ts'
import { sunPosition, sunTimes } from '../src/domain/sun.ts'
import { dayTypeOf, jstDate, jstParts } from '../src/domain/time.ts'
import { ShadeEngine } from '../src/domain/shade.ts'
import { buildingShadowXY } from '../src/domain/shadowPolygons.ts'
import { parseOsm } from '../src/domain/osm.ts'
import {
  confidenceOf, historyOffset, hoursSinceRain, postWeight, postsApply, predictSeat, seatNeighborMap,
} from '../src/domain/seat.ts'
import { EMPTY, validFeatures, validateSaved } from '../src/lib/storage.ts'
import { demoWeather, weatherAt } from '../src/lib/weather.ts'
import type { Building, SeatReport, Spot } from '../src/domain/types.ts'

const DAY = '2026-11-04'
const MIN = 60_000
const HOUR = 60 * MIN
const DAY_MS = 24 * HOUR

const projection = new LocalProjection(AREA_CENTER)
/** 地域の中心から東へ x m、北へ y m の地点 */
const at = (x: number, y: number) => projection.toLatLng({ x, y })

/** 中心に置いた 20m 四方・高さ 20m の建物 */
const block: Building = {
  id: 'b',
  kind: 'building',
  footprint: [at(-10, -10), at(10, -10), at(10, 10), at(-10, 10)],
  height: 20,
  minHeight: 0,
  heightSource: 'measured',
}
/** 建物の北 25m にあるベンチ */
const bench: Spot = {
  id: 'a', name: '検証地点', kind: 'bench', position: at(0, 25), origin: 'osm',
  seats: 3, roof: 'no', roofSource: 'tag', backrest: 'yes', wheelchair: 'unknown',
}
const SOUTH_45 = { altitude: 45, azimuth: 180 }

describe('日本時間と太陽', () => {
  it('日付と分は日本時間として解釈され、端末のタイムゾーンに左右されない', () => {
    expect(jstDate(DAY, 0).toISOString()).toBe('2026-11-03T15:00:00.000Z')
    expect(jstParts(jstDate(DAY, 13 * 60)).minutesOfDay).toBe(13 * 60)
  })

  it('横浜の正午は南寄りの高い位置、深夜は地平線の下', () => {
    const noon = sunPosition(jstDate(DAY, 12 * 60), AREA_CENTER)
    expect(noon.altitude).toBeGreaterThan(30)
    expect(noon.azimuth).toBeGreaterThan(150)
    expect(noon.azimuth).toBeLessThan(220)
    expect(sunPosition(jstDate(DAY, 0), AREA_CENTER).altitude).toBeLessThan(0)
  })

  it('11 月初めの日の出は 5〜7 時、日の入りは 16〜18 時', () => {
    const { sunriseMin, sunsetMin } = sunTimes(DAY, AREA_CENTER)
    expect(sunriseMin).toBeGreaterThan(5 * 60)
    expect(sunriseMin).toBeLessThan(7 * 60)
    expect(sunsetMin).toBeGreaterThan(16 * 60)
    expect(sunsetMin).toBeLessThan(18 * 60)
  })
})

describe('日陰の判定と、地図に描く影', () => {
  const engine = new ShadeEngine([block], [], AREA_CENTER)
  const ringXY = (b: Building) => b.footprint.map((p) => projection.toXY(p))
  const covers = (rings: { x: number; y: number }[][], x: number, y: number) => rings.some((r) => pointInRing({ x, y }, r))

  it('太陽が南にあれば建物の北側だけが日陰になる', () => {
    expect(engine.stateAtXY({ x: 0, y: 25 }, SOUTH_45)).toBe('building')
    expect(engine.stateAtXY({ x: 0, y: -25 }, SOUTH_45)).toBe('sun')
  })

  it('描いた影の形も判定と同じく北側にだけかかる', () => {
    const shadow = buildingShadowXY(ringXY(block), 20, 0, SOUTH_45)
    expect(covers(shadow, 0, 25)).toBe(true)
    expect(covers(shadow, 0, -25)).toBe(false)
  })

  it('太陽が低く影が 1km 以上伸びても、判定と描画が食い違わない', () => {
    const tower = { ...block, height: 200 }
    const lowSun = { altitude: 5, azimuth: 180 }
    expect(new ShadeEngine([tower], [], AREA_CENTER).stateAtXY({ x: 0, y: 1400 }, lowSun)).toBe('building')
    expect(covers(buildingShadowXY(ringXY(tower), 200, 0, lowSun), 0, 1400)).toBe(true)
  })

  it('太陽が沈んでいれば「夜」で、影は描かない', () => {
    const below = { altitude: -5, azimuth: 0 }
    expect(engine.stateAtXY({ x: 0, y: 25 }, below)).toBe('night')
    expect(buildingShadowXY([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], 5, 0, below)).toEqual([])
  })

  it('地上 20m から上だけの屋根なら、その真下近くにも日が差し込む', () => {
    const canopy = new ShadeEngine([{ ...block, kind: 'roof', height: 25, minHeight: 20 }], [], AREA_CENTER)
    expect(canopy.stateAtXY({ x: 0, y: 5 }, SOUTH_45)).toBe('sun')
  })
})

describe('空席予測', () => {
  const now = jstDate(DAY, 12 * 60)
  const input = {
    spot: bench, time: now, now, dayType: dayTypeOf(now),
    weather: demoWeather(DAY, 12 * 60), wbgt: null, shade: 'sun' as const, events: [],
    location: { multiplier: 1, nearest: null }, reports: [] as SeatReport[],
  }
  const report = (value: SeatReport['value'], reportedAt: Date, spotId = bench.id): SeatReport =>
    ({ id: `r-${spotId}-${reportedAt.getTime()}`, spotId, value, reportedAt: reportedAt.toISOString(), origin: 'local' })
  /** 何日か前の投稿。投稿時の予測の入力つき */
  const past = (value: 'sat' | 'full', daysAgo: number, aiProbability: number): SeatReport => ({
    ...report(value, new Date(now.getTime() - daysAgo * DAY_MS)),
    features: { hour: 12, dayType: 'weekday', temperatureC: 20, wbgt: null, condition: 'clear', shade: 'sun', roof: false, aiProbability },
  })
  const factor = (p: ReturnType<typeof predictSeat>, key: string) => p.factors.find((f) => f.key === key)

  describe('今の投稿', () => {
    it('同じ入力からは同じ結果が出て、確率は 0〜1', () => {
      const p = predictSeat(input)
      expect(predictSeat(input)).toEqual(p)
      expect(p.ai).toBeGreaterThanOrEqual(0)
      expect(p.ai).toBeLessThanOrEqual(1)
    })

    it('「満席」の投稿は投稿込みの値だけを下げ、予測そのものは変えない', () => {
      const p = predictSeat({ ...input, reports: [report('full', now)] })
      expect(p.ai).toBe(predictSeat(input).ai)
      expect(p.combined).toBeLessThan(p.ai)
      expect(p.posts[0].origin).toBe('local')
    })

    it('2 時間後の予測には、今の投稿を使わない', () => {
      const later = new Date(now.getTime() + 2 * HOUR)
      const p = predictSeat({ ...input, time: later, reports: [report('full', now)] })
      expect(p.combined).toBe(p.ai)
      expect(postsApply(later, now)).toBe(false)
    })

    it('投稿の効き目は 20 分で半分になり、90 分を過ぎると使わない', () => {
      expect(postWeight(20)).toBe(0.5)
      const p = predictSeat({ ...input, reports: [report('full', new Date(now.getTime() - 91 * MIN))] })
      expect(p.posts).toEqual([])
      expect(p.combined).toBe(p.ai)
    })
  })

  describe('過去の投稿からの学習', () => {
    it('「座れた」が続いた場所は上げ、「満席」が続いた場所は下げる。ルールの値はそのまま', () => {
      const rule = predictSeat(input).rule
      const sat = predictSeat({ ...input, reports: [1, 2, 3, 4].map((d) => past('sat', d, 0.2)) })
      const full = predictSeat({ ...input, reports: [1, 2, 3, 4].map((d) => past('full', d, 0.9)) })
      expect(sat.ai).toBeGreaterThan(rule)
      expect(full.ai).toBeLessThan(rule)
      expect(sat.rule).toBe(rule)
      expect(sat.history?.n).toBeGreaterThan(0)
    })

    it('入力の記録が無い投稿と、今日の投稿は学習に使わない', () => {
      expect(historyOffset(bench.id, [{ ...past('full', 3, 0.9), features: undefined }], now, now, 'weekday')).toBe(null)
      const tenMinutesAgo = { ...past('full', 0, 0.9), reportedAt: new Date(now.getTime() - 10 * MIN).toISOString() }
      expect(historyOffset(bench.id, [tenMinutesAgo], now, now, 'weekday')).toBe(null)
    })

    it('1 件だけなら補正は小さく抑える', () => {
      const one = historyOffset(bench.id, [past('full', 1, 0.9)], now, now, 'weekday')!
      expect(Math.abs(one.offset)).toBeLessThan(0.3)
    })
  })

  describe('周りの状況', () => {
    it('近くの場所の投稿は、投稿込みの値だけに効く', () => {
      const neighbors = [{ spotId: 'b2', distanceM: 50 }]
      const withPost = predictSeat({ ...input, neighbors, reports: [report('full', now, 'b2')] })
      const without = predictSeat({ ...input, neighbors })
      expect(withPost.ai).toBe(without.ai)
      expect(withPost.combined).toBeLessThan(without.combined)
      expect(withPost.nearbyPosts).toBe(1)
    })

    it('80m 以内にほかの座れる場所があると、人が分かれて座りやすくなる', () => {
      const p = predictSeat({ ...input, neighbors: [{ spotId: 'x', distanceM: 30 }, { spotId: 'y', distanceM: 60 }, { spotId: 'z', distanceM: 120 }] })
      expect(factor(p, 'nearby')?.multiplier).toBe(0.9)
      expect(p.ai).toBeGreaterThan(predictSeat(input).ai)
    })

    it('近くの場所は 150m 以内だけを数える', () => {
      const near = { ...bench, id: 'c', position: at(0, 125) }
      const far = { ...bench, id: 'd', position: at(0, 400) }
      const list = seatNeighborMap([bench, near, far]).get('a')!
      expect(list.map((n) => n.spotId)).toEqual(['c'])
      expect(list[0].distanceM).toBeGreaterThan(95)
      expect(list[0].distanceM).toBeLessThan(105)
    })

    it('雨が上がって間もないと屋根のない座面はぬれていて、座る人が減る', () => {
      const hour = (m: number, condition: 'rain' | 'clear') => ({ ...demoWeather(DAY, m), time: jstDate(DAY, m).toISOString(), condition })
      const hours = [hour(10 * 60, 'rain'), hour(11 * 60, 'clear'), hour(12 * 60, 'clear')]
      expect(hoursSinceRain(hours, jstDate(DAY, 11 * 60 + 30))).toBe(0.5)
      expect(hoursSinceRain(hours, jstDate(DAY, 10 * 60 + 30))).toBe(null)

      const wet = predictSeat({ ...input, hoursSinceRain: 0.5 })
      expect(factor(wet, 'wet')?.multiplier).toBe(0.5)
      expect(wet.ai).toBeGreaterThan(predictSeat(input).ai)
      expect(factor(predictSeat({ ...input, hoursSinceRain: 0.5, shade: 'roof' }), 'wet')).toBeUndefined()
    })

    it('日が沈んだあとは、屋根のない場所にだけ「暗い」が付く', () => {
      expect(factor(predictSeat({ ...input, shade: 'night' }), 'dark')).toBeDefined()
      expect(factor(predictSeat({ ...input, shade: 'night', spot: { ...bench, roof: 'yes' } }), 'dark')).toBeUndefined()
    })
  })

  describe('確からしさ', () => {
    const guesses = { seatsAssumed: true, weatherIsDemo: true, hoursAhead: 8, historyN: 0, liveWeight: 0, applies: false }

    it('仮定が多いと「低」、実測と投稿がそろうと「高」で幅も狭い', () => {
      const low = confidenceOf(0.5, guesses)
      const high = confidenceOf(0.5, { ...guesses, seatsAssumed: false, weatherIsDemo: false, hoursAhead: 0, liveWeight: 2, applies: true })
      expect(low.level).toBe('low')
      expect(low.notes).toEqual(expect.arrayContaining(['席数は仮定', '天気はデモの値', '先の時刻の予測']))
      expect(high.level).toBe('high')
      expect(high.high - high.low).toBeLessThan(low.high - low.low)
    })

    it('幅は 0〜1 からはみ出さない', () => {
      const edge = confidenceOf(0.99, guesses)
      expect(edge.low).toBeGreaterThanOrEqual(0)
      expect(edge.high).toBeLessThanOrEqual(1)
    })

    it('予測結果に幅とモデル名が付き、幅は投稿込みの値を含む', () => {
      const p = predictSeat({ ...input, weatherIsDemo: true })
      expect(p.method).toBe('rule-v1')
      expect(p.confidence.low).toBeLessThanOrEqual(p.combined)
      expect(p.confidence.high).toBeGreaterThanOrEqual(p.combined)
      expect(p.confidence.notes).toContain('天気はデモの値')
    })
  })

  it('投稿に添えた入力は検査してから保存し、形が崩れたものは外す', () => {
    const features = past('sat', 1, 0.4).features!
    expect(validFeatures(features)).toEqual(features)
    expect(validFeatures({ ...features, aiProbability: 2 })).toBeUndefined()
    expect(validFeatures({ ...features, dayType: 'x' })).toBeUndefined()

    const saved = validateSaved({ ...EMPTY, reports: [past('sat', 1, 0.4), { ...past('full', 2, 0.4), features: { bad: 1 } }] })
    expect(saved.reports[0].features).toEqual(features)
    expect(saved.reports[1]).not.toHaveProperty('features')
  })
})

describe('同梱データ・バックアップ・天気', () => {
  it('同梱の地図データを読み込み、全スポットの日陰を判定できる', () => {
    const data = parseOsm(JSON.parse(readFileSync('public/data/area-osm.json', 'utf8')), { origin: AREA_CENTER, live: false })
    expect(data.spots.length).toBe(256)
    expect(data.buildings.length).toBeGreaterThan(1000)
    const engine = new ShadeEngine(data.buildings, data.trees, AREA_CENTER)
    const when = jstDate(DAY, 13 * 60)
    for (const s of data.spots) {
      expect(['sun', 'roof', 'building', 'tree', 'night']).toContain(engine.stateAt(s.position, when, s.roof === 'yes'))
    }
  })

  it('形の合わないバックアップは受け付けない', () => {
    expect(() => validateSaved({})).toThrow()
    // 対象地域の外（緯度経度 0,0）の地点
    expect(() => validateSaved({ ...EMPTY, spots: [{ ...bench, origin: 'user', position: { lat: 0, lng: 0 } }] })).toThrow()
    expect(() => validateSaved({ ...EMPTY, reports: [{ id: 'r', spotId: 's', value: 'sat', reportedAt: 'invalid', origin: 'local' }] })).toThrow()
  })

  it('復元では重複を除き、知らない項目は持ち込まない', () => {
    const restored = validateSaved({ ...EMPTY, favorites: ['a', 'a'], unexpected: 'x' })
    expect(restored.favorites).toEqual(['a'])
    expect(restored).not.toHaveProperty('unexpected')
  })

  it('予報の範囲外の時刻を聞かれたら null', () => {
    const forecast = { sourceLabel: 'test', isDemo: false, fetchedAt: '', hours: [demoWeather(DAY, 12 * 60)] }
    expect(weatherAt(forecast, jstDate('2026-11-05', 12 * 60))).toBe(null)
  })
})
