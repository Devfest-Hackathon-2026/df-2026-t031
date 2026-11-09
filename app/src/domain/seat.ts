import { haversineM } from './geo.ts'
import { isShaded } from './shade.ts'
import { DAY_TYPE_LABEL, jstParts } from './time.ts'
import type { AreaEvent, Attractor, DayType, SeatFactor, SeatPrediction, SeatReport, ShadeState, Spot, SpotKind, WeatherHour } from './types.ts'

/**
 * 空席確率 v1（カメラ・センサーなし）。
 *
 * 1 席あたりの埋まりやすさ ρ = 基準値 × 時間帯 × 天気 × 雨上がり × 暑さ × 暗さ × イベント × 人通り × 近くの席（0.02〜0.97 に収める）
 * 1 人で気兼ねなく座れる席数 n = ceil(席数 / 2)（他人と隣り合わせを避ける前提）
 * 空席確率 = 1 − ρ^n（席ごとに独立に埋まると仮定）
 *
 * ルールの確率に、同じ地点の過去の投稿（似た曜日・時間帯）から学んだ補正を足したものを AI 予測とする。
 * 直近 90 分の投稿（その地点と 150m 以内の地点）はさらにベイズ風に混ぜて combined にする。
 * 係数はここにまとめてある。投稿が十分たまったらロジスティック回帰などで係数自体を学習する想定（docs/API_GUIDE.md）。
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
  /** 近くの地点の投稿: 対象にする距離（m）と重み（同じ地点の投稿の何倍か。距離に比例して小さくする） */
  nearbyPostRadiusM: 150,
  nearbyPostWeight: 0.35,
  /** この距離（m）以内のほかの座れる場所は「人が分散する」とみなす */
  competitionRadiusM: 80,
  /** 過去の投稿からの補正: 曜日の種類が違うときの重み、時間帯の近さ（時）、重みが半分になる日数、0 に引き寄せる強さ（件数） */
  historyOtherDayWeight: 0.3,
  historyHourSigma: 1.5,
  historyHalfLifeDays: 30,
  historyShrink: 3,
  /** 確からしさ: ルールを観測何回分とみなすか */
  baseEvidence: 5,
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

// ───────── 近くの席 ─────────

/** 近くの席の地点（自分を除く）。地点ごとに 1 回だけ計算すればよい */
export interface SeatNeighbor {
  spotId: string
  distanceM: number
}

/** 各座れる地点から radiusM 以内の、ほかの座れる地点の一覧 */
export function seatNeighborMap(spots: Spot[], radiusM = SEAT_MODEL.nearbyPostRadiusM): Map<string, SeatNeighbor[]> {
  const seatSpots = spots.filter(isSeatSpot)
  return new Map(
    seatSpots.map((s) => [
      s.id,
      seatSpots
        .filter((o) => o.id !== s.id)
        .map((o) => ({ spotId: o.id, distanceM: haversineM(s.position, o.position) }))
        .filter((n) => n.distanceM <= radiusM),
    ]),
  )
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
  /** 雨がやんでから何時間か（予報から求める）。降っていない・分からなければ null */
  hoursSinceRain?: number | null
  /** 近くの座れる地点（150m 以内） */
  neighbors?: SeatNeighbor[]
  /** 天気が実際の予報ではなくデモの値か */
  weatherIsDemo?: boolean
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

const isRainy = (c: WeatherHour['condition']) => c === 'rain' || c === 'heavy-rain' || c === 'snow'

/**
 * 予報の時間別データから「雨がやんでから何時間か」を求める（0〜3 時間だけ。それより前・雨なしは null）。
 * 予測する時刻にまだ降っているときも null（その場合は天気の倍率で扱う）
 */
export function hoursSinceRain(hours: WeatherHour[], time: Date): number | null {
  const t = time.getTime()
  const current = hours.find((h) => t >= Date.parse(h.time) && t < Date.parse(h.time) + 3_600_000)
  if (!current || isRainy(current.condition)) return null
  let latestEnd = -Infinity
  for (const h of hours) {
    const end = Date.parse(h.time) + 3_600_000
    if (isRainy(h.condition) && end <= t && end > latestEnd) latestEnd = end
  }
  const hrs = (t - latestEnd) / 3_600_000
  return hrs <= 3 ? Math.round(hrs * 100) / 100 : null
}

function wetFactor(hrs: number | null | undefined, roofed: boolean): SeatFactor | null {
  if (roofed || hrs === null || hrs === undefined) return null
  if (hrs <= 1) return { key: 'wet', label: '雨上がり（座面がまだぬれていそう）', multiplier: 0.5 }
  if (hrs <= 2) return { key: 'wet', label: '雨上がり（座面が乾ききっていないかも）', multiplier: 0.75 }
  return { key: 'wet', label: '雨上がり（ほぼ乾いていそう）', multiplier: 0.9 }
}

function darkFactor(shade: ShadeState, roofed: boolean): SeatFactor | null {
  if (shade !== 'night' || roofed) return null
  return { key: 'dark', label: '日没後で暗い（座る人が減る）', multiplier: 0.75 }
}

/** 80m 以内に座れる場所がほかにあると、人が分散して埋まりにくい（最大 2 割減） */
function nearbyFactor(neighbors: SeatNeighbor[] | undefined): SeatFactor | null {
  const k = (neighbors ?? []).filter((n) => n.distanceM <= SEAT_MODEL.competitionRadiusM).length
  if (k === 0) return null
  return { key: 'nearby', label: `80m 以内にほかの座れる場所が ${k} か所（人が分散する）`, multiplier: round2(Math.max(0.8, 1 - 0.05 * k)) }
}

function heatFactor(wbgt: number | null, temp: number | null, shade: ShadeState): SeatFactor | null {
  if (shade === 'night') return null
  const shaded = isShaded(shade)
  if (wbgt !== null && wbgt >= 28) {
    return shaded
      ? { key: 'heat', label: `暑さの参考指数 ${wbgt}（日陰に人が集まる）`, multiplier: 1.35 }
      : { key: 'heat', label: `暑さの参考指数 ${wbgt}（日なたは座る人が減る）`, multiplier: 0.35 }
  }
  if (wbgt !== null && wbgt >= 25) {
    return shaded
      ? { key: 'heat', label: `暑さの参考指数 ${wbgt}（日陰が好まれる）`, multiplier: 1.2 }
      : { key: 'heat', label: `暑さの参考指数 ${wbgt}（日なたは避けられがち）`, multiplier: 0.6 }
  }
  if (wbgt !== null && wbgt >= 21) {
    return shaded ? { key: 'heat', label: `暑さの参考指数 ${wbgt}`, multiplier: 1.05 } : { key: 'heat', label: `暑さの参考指数 ${wbgt}（やや暑い日なた）`, multiplier: 0.85 }
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

const sameDayClass = (a: DayType, b: DayType) => (a === 'weekday') === (b === 'weekday')

/**
 * 過去の投稿（直近 postWindowMin 分より前）からの補正。
 * 同じ地点の「座れた／満席」の投稿のうち、投稿時の入力（features）が残っているものだけを使い、
 * 「実際（座れた=1・満席=0）− 投稿時のルールの確率」を、曜日の種類・時間帯の近さ・新しさで重み付けして平均する。
 * 件数が少ないうちは 0 に引き寄せる（historyShrink 件分の「補正なし」を足す）。
 */
export function historyOffset(
  spotId: string,
  reports: SeatReport[],
  time: Date,
  now: Date,
  dayType: DayType,
): { offset: number; n: number } | null {
  const p = jstParts(time)
  const hour = p.hour + p.minute / 60
  let wsum = 0
  let rsum = 0
  for (const r of reports) {
    if (r.spotId !== spotId || r.value === 'missing' || !r.features || r.features.aiProbability === null) continue
    const minutesAgo = (now.getTime() - Date.parse(r.reportedAt)) / 60_000
    if (!(minutesAgo > SEAT_MODEL.postWindowMin)) continue
    const dh = r.features.hour - hour
    const w =
      (sameDayClass(r.features.dayType, dayType) ? 1 : SEAT_MODEL.historyOtherDayWeight) *
      Math.exp(-(dh * dh) / (2 * SEAT_MODEL.historyHourSigma ** 2)) *
      Math.pow(0.5, minutesAgo / (SEAT_MODEL.historyHalfLifeDays * 1440))
    if (w < 0.01) continue
    wsum += w
    rsum += w * ((r.value === 'sat' ? 1 : 0) - r.features.aiProbability)
  }
  if (wsum === 0) return null
  return { offset: round3(rsum / (wsum + SEAT_MODEL.historyShrink)), n: round2(wsum) }
}

const clamp01 = (n: number, lo = 0.01, hi = 0.99) => Math.max(lo, Math.min(hi, n))

export function predictSeat(inp: SeatInputs): SeatPrediction {
  const roofed = inp.shade === 'roof' || inp.spot.roof === 'yes'
  const factors: SeatFactor[] = [timeFactor(inp.dayType, inp.time)]
  for (const f of [
    weatherFactor(inp.weather, roofed),
    wetFactor(inp.hoursSinceRain, roofed),
    heatFactor(inp.wbgt, inp.weather?.temperatureC ?? null, inp.shade),
    darkFactor(inp.shade, roofed),
    eventFactor(inp.spot, inp.events, inp.time),
  ])
    if (f) factors.push(f)
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
  const nf = nearbyFactor(inp.neighbors)
  if (nf) factors.push(nf)

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
  const rule = 1 - Math.pow(rho, seats.effective)
  const history = historyOffset(inp.spot.id, inp.reports, inp.time, inp.now, inp.dayType)
  const ai = history ? clamp01(rule + history.offset) : rule

  const posts = recentPosts(inp.spot.id, inp.reports, inp.now)
  const applies = postsApply(inp.time, inp.now)
  let combined = ai
  let liveWeight = 0
  let nearbyPosts = 0
  if (applies) {
    let wsum = SEAT_MODEL.priorWeight
    let vsum = SEAT_MODEL.priorWeight * ai
    const add = (value: SeatReport['value'], w: number) => {
      wsum += w
      vsum += w * (value === 'sat' ? 1 : 0)
      liveWeight += w
    }
    for (const p of posts) if (p.value !== 'missing') add(p.value, postWeight(p.minutesAgo))
    // 近くの地点の投稿（150m 以内）。遠いほど・古いほど軽い
    for (const n of inp.neighbors ?? []) {
      for (const p of recentPosts(n.spotId, inp.reports, inp.now)) {
        if (p.value === 'missing') continue
        add(p.value, postWeight(p.minutesAgo) * SEAT_MODEL.nearbyPostWeight * (1 - n.distanceM / SEAT_MODEL.nearbyPostRadiusM))
        nearbyPosts++
      }
    }
    combined = vsum / wsum
  }

  return {
    spotId: inp.spot.id,
    rule: round3(rule),
    history,
    ai: round3(ai),
    occupancy: round3(rho),
    effectiveSeats: seats.effective,
    seatsAssumed: seats.assumed,
    factors,
    posts,
    combined: round3(combined),
    nearbyPosts,
    confidence: confidenceOf(combined, {
      seatsAssumed: seats.assumed,
      weatherIsDemo: !!inp.weatherIsDemo,
      hoursAhead: (inp.time.getTime() - inp.now.getTime()) / 3_600_000,
      historyN: history?.n ?? 0,
      liveWeight,
      applies,
    }),
    method: 'rule-v1',
  }
}

/**
 * 確からしさ。ルールを「観測 baseEvidence 回分」とみなし、仮定が多いほど減らし、投稿があるほど増やす。
 * 幅は二項分布の正規近似（80% → ±1.28σ）。実測で校正した幅ではない
 */
export function confidenceOf(
  p: number,
  c: { seatsAssumed: boolean; weatherIsDemo: boolean; hoursAhead: number; historyN: number; liveWeight: number; applies: boolean },
): SeatPrediction['confidence'] {
  const notes: string[] = []
  let n = SEAT_MODEL.baseEvidence
  if (c.seatsAssumed) {
    n -= 1
    notes.push('席数は仮定')
  }
  if (c.weatherIsDemo) {
    n -= 1
    notes.push('天気はデモの値')
  }
  if (Math.abs(c.hoursAhead) > 6) {
    n -= 1
    notes.push(c.hoursAhead > 0 ? '先の時刻の予測' : '過去の時刻の推定')
  }
  n = Math.max(1, n)
  if (c.historyN > 0) {
    n += c.historyN
    notes.push('過去の投稿で補正')
  }
  if (c.liveWeight > 0) {
    n += c.liveWeight * 2
    notes.push('直近の投稿あり')
  } else if (c.applies) notes.push('直近の投稿なし')
  const sd = Math.sqrt((p * (1 - p)) / (n + 1))
  return {
    level: n >= 7 ? 'high' : n >= 4 ? 'mid' : 'low',
    low: round3(Math.max(0, p - 1.28 * sd)),
    high: round3(Math.min(1, p + 1.28 * sd)),
    effectiveN: round2(n),
    notes,
  }
}

export const CONFIDENCE_LABEL: Record<SeatPrediction['confidence']['level'], string> = { high: '高', mid: '中', low: '低' }

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

/** 「トイレ近く」の絞り込みの距離（m）。徒歩2分ほど */
export const TOILET_NEAR_M = 150

/** 各地点から、いちばん近い targets（例: トイレ）までの直線距離（m）。targets がなければ Infinity */
export function nearestDistanceMap(spots: Spot[], targets: Spot[]): Map<string, number> {
  return new Map(spots.map((s) => [s.id, targets.reduce((best, t) => Math.min(best, haversineM(s.position, t.position)), Infinity)]))
}
