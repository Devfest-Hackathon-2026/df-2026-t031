import { haversineM } from './geo.ts'
import { isShaded } from './shade.ts'
import { DAY_TYPE_LABEL, jstParts } from './time.ts'
import type { AreaEvent, Attractor, DayType, SeatFactor, SeatPrediction, SeatReport, ShadeState, Spot, SpotKind, WeatherHour } from './types.ts'

/**
 * 空席確率 v0（カメラ・センサーなし）。
 *
 * 1 席あたりの埋まりやすさ ρ = 基準値 × 時間帯 × 天気 × 暑さ × イベント × 人通り（0.02〜0.97 に収める）
 * 1 人で気兼ねなく座れる席数 n = ceil(席数 / 2)（他人と隣り合わせを避ける前提）
 * 空席確率 = 1 − ρ^n（席ごとに独立に埋まると仮定）
 *
 * 学習済みのモデルではなく、根拠を説明できる重み付けのルール。係数はここにまとめてあり、
 * 投稿（座れた／満席）がたまったらロジスティック回帰などで置き換える想定（docs/API_GUIDE.md）。
 * Gemini には数値を計算させない（同じ入力で必ず同じ数字になるようにする）。
 */

export const SEAT_MODEL = {
  baseOccupancy: 0.3,
  defaultSeats: { bench: 3, shelter: 4, picnic: 4 } as Partial<Record<SpotKind, number>>,
  /** 投稿を反映する時間幅（分）と、重みが半分になる時間（分） */
  postWindowMin: 90,
  postHalfLifeMin: 20,
  /** AI 予測を「投稿何件分」として扱うか */
  priorWeight: 1.5,
}

export const SEAT_KINDS: ReadonlySet<SpotKind> = new Set(['bench', 'shelter', 'picnic'])
export const isSeatSpot = (s: Spot) => SEAT_KINDS.has(s.kind)

type Curve = [number, number][]

/** 時刻（時）→ 混みやすさの倍率。間は直線でつなぐ */
const TIME_CURVES: Record<'weekday' | 'weekend', Curve> = {
  weekday: [
    [5, 0.15], [7, 0.35], [8, 0.5], [10, 0.6], [11.5, 0.9], [12, 1.4], [13, 1.3], [14, 0.9],
    [15, 1.0], [16, 0.95], [17, 0.85], [18, 0.65], [19, 0.5], [21, 0.25], [23, 0.1],
  ],
  weekend: [
    [5, 0.15], [7, 0.3], [9, 0.7], [11, 1.15], [12, 1.4], [13, 1.5], [14, 1.45], [15, 1.5],
    [16, 1.35], [17, 1.1], [18, 0.85], [19, 0.65], [21, 0.35], [23, 0.1],
  ],
}

export function curveAt(curve: Curve, hour: number): number {
  if (hour <= curve[0][0]) return curve[0][1]
  for (let i = 0; i < curve.length - 1; i++) {
    const [h0, v0] = curve[i]
    const [h1, v1] = curve[i + 1]
    if (hour <= h1) return v0 + ((v1 - v0) * (hour - h0)) / (h1 - h0)
  }
  return curve[curve.length - 1][1]
}

const round2 = (n: number) => Math.round(n * 100) / 100

// ───────── 人通り ─────────

const ATTRACTOR_WEIGHT: Record<Attractor['kind'], number> = { station: 1, mall: 0.8, tourism: 0.6, park: 0.3 }

/** 駅・商業施設・観光地・公園の近さから「人通り」の倍率（0.7〜1.5）を求める。地点ごとに 1 回だけ計算すればよい */
export function locationFactor(spot: Spot, attractors: Attractor[]): { multiplier: number; nearest: Attractor | null } {
  let score = 0
  let nearest: Attractor | null = null
  let nearestD = Infinity
  for (const a of attractors) {
    const d = haversineM(spot.position, a.position)
    if (d > 700) continue
    score += ATTRACTOR_WEIGHT[a.kind] * Math.exp(-d / 180)
    if (a.kind !== 'park' && d < nearestD) {
      nearestD = d
      nearest = a
    }
  }
  return { multiplier: round2(0.7 + 0.8 * (1 - Math.exp(-score))), nearest }
}

// ───────── 予測 ─────────

export interface SeatInputs {
  spot: Spot
  /** 予測する時刻 */
  time: Date
  /** 現在時刻（投稿の新しさの計算に使う） */
  now: Date
  dayType: DayType
  weather: WeatherHour | null
  /** 日なたの暑さ指数（推定） */
  wbgt: number | null
  shade: ShadeState
  events: AreaEvent[]
  location: { multiplier: number; nearest: Attractor | null }
  reports: SeatReport[]
}

function timeFactor(dayType: DayType, time: Date): SeatFactor {
  const p = jstParts(time)
  const curve = dayType === 'weekday' ? TIME_CURVES.weekday : TIME_CURVES.weekend
  const m = round2(curveAt(curve, p.hour + p.minute / 60))
  const lunch = dayType === 'weekday' && p.hour >= 12 && p.hour < 13 ? '・昼休み' : ''
  return { key: 'time', label: `${DAY_TYPE_LABEL[dayType]}の${p.hour}時台${lunch}`, multiplier: m }
}

function weatherFactor(w: WeatherHour | null, roofed: boolean): SeatFactor | null {
  if (!w) return null
  switch (w.condition) {
    case 'rain':
    case 'heavy-rain':
      return roofed
        ? { key: 'weather', label: '雨（屋根の下に人が集まりやすい）', multiplier: 1.6 }
        : { key: 'weather', label: '雨（座面がぬれていて座る人が少ない）', multiplier: 0.15 }
    case 'snow':
      return roofed ? { key: 'weather', label: '雪（屋根の下に人が集まりやすい）', multiplier: 1.4 } : { key: 'weather', label: '雪', multiplier: 0.1 }
  }
  if (!roofed && (w.precipitationProbability ?? 0) >= 60) return { key: 'weather', label: `降水確率 ${w.precipitationProbability}%`, multiplier: 0.8 }
  if (w.condition === 'cloudy' || w.condition === 'fog') return { key: 'weather', label: 'くもり', multiplier: 0.95 }
  return { key: 'weather', label: w.condition === 'clear' ? '晴れ' : '晴れ時々くもり', multiplier: 1 }
}

function heatFactor(wbgt: number | null, temp: number | null, shade: ShadeState): SeatFactor | null {
  if (shade === 'night') return null
  const shaded = isShaded(shade)
  if (wbgt !== null && wbgt >= 28) {
    return shaded
      ? { key: 'heat', label: `暑さ指数 ${wbgt}（日陰に人が集まる）`, multiplier: 1.35 }
      : { key: 'heat', label: `暑さ指数 ${wbgt}（日なたは座る人が減る）`, multiplier: 0.35 }
  }
  if (wbgt !== null && wbgt >= 25) {
    return shaded
      ? { key: 'heat', label: `暑さ指数 ${wbgt}（日陰が好まれる）`, multiplier: 1.2 }
      : { key: 'heat', label: `暑さ指数 ${wbgt}（日なたは避けられがち）`, multiplier: 0.6 }
  }
  if (wbgt !== null && wbgt >= 21) {
    return shaded ? { key: 'heat', label: `暑さ指数 ${wbgt}`, multiplier: 1.05 } : { key: 'heat', label: `暑さ指数 ${wbgt}（やや暑い日なた）`, multiplier: 0.85 }
  }
  if (temp !== null && temp < 13) {
    return shaded
      ? { key: 'heat', label: `気温 ${Math.round(temp)}℃（日陰は寒い）`, multiplier: 0.8 }
      : { key: 'heat', label: `気温 ${Math.round(temp)}℃（ひなたぼっこ向き）`, multiplier: 1.15 }
  }
  return null
}

export function activeEvents(events: AreaEvent[], time: Date): AreaEvent[] {
  const p = jstParts(time)
  return events.filter((e) => {
    const dayOk = e.dates.length > 0 ? e.dates.includes(p.dateKey) : e.daysOfWeek.includes(p.weekday)
    return dayOk && p.minutesOfDay >= e.startMin && p.minutesOfDay < e.endMin
  })
}

function eventFactor(spot: Spot, events: AreaEvent[], time: Date): SeatFactor | null {
  let boost = 0
  const names: string[] = []
  for (const e of activeEvents(events, time)) {
    const d = haversineM(spot.position, e.position)
    if (d >= e.radiusM) continue
    boost += e.intensity * (1 - d / e.radiusM)
    names.push(e.name)
  }
  if (boost <= 0.01) return null
  return { key: 'event', label: `${names.join('・')}が開催中`, multiplier: round2(1 + boost) }
}

export function effectiveSeatsOf(spot: Spot): { seats: number; effective: number; assumed: boolean } {
  const assumed = spot.seats === null
  const seats = spot.seats ?? SEAT_MODEL.defaultSeats[spot.kind] ?? 3
  return { seats, effective: Math.max(1, Math.ceil(seats / 2)), assumed }
}

/** 投稿の重み。新しいほど重い（半減期 postHalfLifeMin 分） */
export function postWeight(minutesAgo: number): number {
  return Math.pow(0.5, minutesAgo / SEAT_MODEL.postHalfLifeMin)
}

export function recentPosts(spotId: string, reports: SeatReport[], now: Date): SeatPrediction['posts'] {
  return reports
    .filter((r) => r.spotId === spotId)
    .map((r) => ({ value: r.value, origin: r.origin, minutesAgo: Math.round((now.getTime() - new Date(r.reportedAt).getTime()) / 60_000) }))
    .filter((r) => r.minutesAgo >= 0 && r.minutesAgo <= SEAT_MODEL.postWindowMin)
    .sort((a, b) => a.minutesAgo - b.minutesAgo)
}

/** 投稿が「予測する時刻」に使えるか（現在の 15 分前〜30 分後だけ） */
export function postsApply(time: Date, now: Date): boolean {
  const diff = (time.getTime() - now.getTime()) / 60_000
  return diff >= -15 && diff <= 30
}

export function predictSeat(inp: SeatInputs): SeatPrediction {
  const roofed = inp.shade === 'roof' || inp.spot.roof === 'yes'
  const factors: SeatFactor[] = [timeFactor(inp.dayType, inp.time)]
  const wf = weatherFactor(inp.weather, roofed)
  if (wf) factors.push(wf)
  const hf = heatFactor(inp.wbgt, inp.weather?.temperatureC ?? null, inp.shade)
  if (hf) factors.push(hf)
  const ef = eventFactor(inp.spot, inp.events, inp.time)
  if (ef) factors.push(ef)
  const near = inp.location.nearest?.name
  factors.push({
    key: 'location',
    label:
      inp.location.multiplier >= 1.15
        ? `人通りが多い場所${near ? `（${near}の近く）` : ''}`
        : inp.location.multiplier <= 0.85
          ? '人通りは少なめ'
          : `人通りはふつう${near ? `（${near}の近く）` : ''}`,
    multiplier: inp.location.multiplier,
  })

  let rho = SEAT_MODEL.baseOccupancy
  for (const f of factors) rho *= f.multiplier
  rho = Math.max(0.02, Math.min(0.97, rho))

  const seats = effectiveSeatsOf(inp.spot)
  factors.push({
    key: 'seats',
    label: seats.assumed
      ? `席数は不明のため ${seats.seats} 席と仮定（1 人で座れる目安 ${seats.effective} 席）`
      : `${seats.seats} 席（1 人で座れる目安 ${seats.effective} 席）`,
    multiplier: 1,
  })
  const ai = 1 - Math.pow(rho, seats.effective)

  const posts = recentPosts(inp.spot.id, inp.reports, inp.now)
  let combined = ai
  if (postsApply(inp.time, inp.now)) {
    let wsum = SEAT_MODEL.priorWeight
    let vsum = SEAT_MODEL.priorWeight * ai
    for (const p of posts) {
      if (p.value === 'missing') continue
      const w = postWeight(p.minutesAgo)
      wsum += w
      vsum += w * (p.value === 'sat' ? 1 : 0)
    }
    combined = vsum / wsum
  }

  return {
    spotId: inp.spot.id,
    ai: round3(ai),
    occupancy: round3(rho),
    effectiveSeats: seats.effective,
    seatsAssumed: seats.assumed,
    factors,
    posts,
    combined: round3(combined),
    method: 'rule-v0',
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

export type SeatLevel = 'high' | 'mid' | 'low'

export function seatLevel(p: number): SeatLevel {
  if (p >= 0.7) return 'high'
  if (p >= 0.4) return 'mid'
  return 'low'
}

export const SEAT_LEVEL_LABEL: Record<SeatLevel, string> = {
  high: '座れそう',
  mid: '五分五分',
  low: '混みそう',
}

export const pct = (p: number) => `${Math.round(p * 100)}%`
