import { haversineM } from './geo.ts'
import { isShaded } from './shade.ts'
import { DAY_TYPE_LABEL, jstParts } from './time.ts'
import type { AreaEvent, Attractor, DayType, SeatFactor, SeatPrediction, SeatReport, ShadeState, Spot, SpotKind, WeatherHour } from './types.ts'

// 2026-11-10 期間内に書き直し。
//
// 座れる確率の見積もり（カメラやセンサーは使わない、ルールベース v1）。
//   ρ（1 席が埋まっている確率）= 基準値 × 各要因の倍率。0.02〜0.97 に収める
//   n（1 人で気兼ねなく座れる席数）= ceil(席数 / 2)
//   ルールの確率 = 1 − ρ^n（席は互いに独立に埋まるとみなす）
// これに「同じ地点の過去の投稿から学んだずれ」を足したものを AI 予測とし、
// さらに直近 90 分の投稿（その地点と 150 m 以内の地点）を重み付きで混ぜて combined とする。
// 数値はすべてこのファイルで決める（Gemini には計算させない）。同じ入力なら必ず同じ結果になる。

export const SEAT_MODEL = {
  baseOccupancy: 0.3,
  defaultSeats: { bench: 3, shelter: 4, picnic: 4 } as Partial<Record<SpotKind, number>>,
  /** 直近の投稿として扱う範囲（分）と、重みが半分になるまでの時間（分） */
  postWindowMin: 90,
  postHalfLifeMin: 20,
  /** AI 予測を投稿何件ぶんの重さとして混ぜるか */
  priorWeight: 1.5,
  /** 近くの地点の投稿を拾う距離（m）と、同じ地点の投稿に対する重みの比（距離が離れるほど下げる） */
  nearbyPostRadiusM: 150,
  nearbyPostWeight: 0.35,
  /** この距離（m）以内にほかの座れる場所があれば、人が分かれるとみなす */
  competitionRadiusM: 80,
  /** 過去の投稿: 平日/休日が違うときの重み、時刻の近さの幅（時）、重みが半分になる日数、0 側に寄せる強さ（件数ぶん） */
  historyOtherDayWeight: 0.3,
  historyHourSigma: 1.5,
  historyHalfLifeDays: 30,
  historyShrink: 3,
  /** ルールだけの予測を、観測何回ぶんの確かさとみなすか */
  baseEvidence: 5,
}

export const SEAT_KINDS: ReadonlySet<SpotKind> = new Set(['bench', 'shelter', 'picnic', 'indoor'])
export const isSeatSpot = (s: Spot) => SEAT_KINDS.has(s.kind)

const roundTo = (digits: number) => {
  const k = 10 ** digits
  return (n: number) => Math.round(n * k) / k
}
const round2 = roundTo(2)
const round3 = roundTo(3)
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

// ── 時間帯 ──────────────────────────────────────────

/** [時, 倍率] の折れ線 */
type Curve = [number, number][]

/** 時刻ごとの混みやすさ。点と点の間は直線で補う */
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

/** 折れ線の hour における値。範囲外は端の値 */
export function curveAt(curve: Curve, hour: number): number {
  const upper = curve.findIndex(([h]) => hour <= h)
  if (upper === -1) return curve[curve.length - 1][1]
  if (upper === 0) return curve[0][1]
  const [h0, v0] = curve[upper - 1]
  const [h1, v1] = curve[upper]
  return v0 + ((v1 - v0) * (hour - h0)) / (h1 - h0)
}

function timeFactor(dayType: DayType, time: Date): SeatFactor {
  const { hour, minute } = jstParts(time)
  const isWeekday = dayType === 'weekday'
  const multiplier = round2(curveAt(isWeekday ? TIME_CURVES.weekday : TIME_CURVES.weekend, hour + minute / 60))
  const suffix = isWeekday && hour === 12 ? '・昼休み' : ''
  return { key: 'time', label: `${DAY_TYPE_LABEL[dayType]}の${hour}時台${suffix}`, multiplier }
}

// ── 人通り ──────────────────────────────────────────

/** 集客施設ごとの強さ */
const ATTRACTOR_PULL: Record<Attractor['kind'], number> = { station: 1, mall: 0.8, tourism: 0.6, park: 0.3 }
/** これより遠い施設は数えない（m） */
const ATTRACTOR_REACH_M = 700
/** 施設の影響が 1/e になる距離（m） */
const ATTRACTOR_DECAY_M = 180

/**
 * 近くの駅・商業施設・観光地・公園から、人通りの倍率（0.7〜1.5）を出す。
 * nearest は表示用の「〇〇の近く」で、公園は名前に使わない。地点ごとに 1 回計算すれば足りる。
 */
export function locationFactor(spot: Spot, attractors: Attractor[]): { multiplier: number; nearest: Attractor | null } {
  let pull = 0
  let nearest: Attractor | null = null
  let nearestD = Infinity
  for (const attractor of attractors) {
    const d = haversineM(spot.position, attractor.position)
    if (d > ATTRACTOR_REACH_M) continue
    pull += ATTRACTOR_PULL[attractor.kind] * Math.exp(-d / ATTRACTOR_DECAY_M)
    if (attractor.kind !== 'park' && d < nearestD) [nearest, nearestD] = [attractor, d]
  }
  return { multiplier: round2(0.7 + 0.8 * (1 - Math.exp(-pull))), nearest }
}

function locationLabel(multiplier: number, nearName: string | null | undefined): string {
  const near = nearName ? `（${nearName}の近く）` : ''
  if (multiplier >= 1.15) return `人通りが多い場所${near}`
  if (multiplier <= 0.85) return '人通りは少なめ'
  return `人通りはふつう${near}`
}

// ── 近くの座れる場所 ─────────────────────────────────

/** ほかの座れる地点とその距離 */
export interface SeatNeighbor {
  spotId: string
  distanceM: number
}

/** 座れる地点ごとに、radiusM 以内にあるほかの座れる地点を並べる。地点ごとに 1 回計算すれば足りる */
export function seatNeighborMap(spots: Spot[], radiusM = SEAT_MODEL.nearbyPostRadiusM): Map<string, SeatNeighbor[]> {
  const seats = spots.filter(isSeatSpot)
  const map = new Map<string, SeatNeighbor[]>()
  for (const self of seats) {
    const list: SeatNeighbor[] = []
    for (const other of seats) {
      if (other.id === self.id) continue
      const distanceM = haversineM(self.position, other.position)
      if (distanceM <= radiusM) list.push({ spotId: other.id, distanceM })
    }
    map.set(self.id, list)
  }
  return map
}

/** 近くに座れる場所が多いと人が分かれる（1 か所につき 5%、最大 20% 減） */
function nearbyFactor(neighbors: SeatNeighbor[] = []): SeatFactor | null {
  const count = neighbors.reduce((k, n) => (n.distanceM <= SEAT_MODEL.competitionRadiusM ? k + 1 : k), 0)
  if (count === 0) return null
  return {
    key: 'nearby',
    label: `80m 以内にほかの座れる場所が ${count} か所（人が分散する）`,
    multiplier: round2(Math.max(0.8, 1 - 0.05 * count)),
  }
}

// ── 天気・雨上がり ───────────────────────────────────

export interface SeatInputs {
  spot: Spot
  /** 見積もる時刻 */
  time: Date
  /** いまの時刻（投稿がどれだけ新しいかに使う） */
  now: Date
  dayType: DayType
  weather: WeatherHour | null
  /** 日なたでの暑さ指数の推定値 */
  wbgt: number | null
  shade: ShadeState
  events: AreaEvent[]
  location: { multiplier: number; nearest: Attractor | null }
  reports: SeatReport[]
  /** 雨がやんでからの時間（時）。降っていない・分からないときは null */
  hoursSinceRain?: number | null
  /** 150 m 以内のほかの座れる地点 */
  neighbors?: SeatNeighbor[]
  /** 天気が予報ではなくデモ用の値か */
  weatherIsDemo?: boolean
}

const weather = (label: string, multiplier: number): SeatFactor => ({ key: 'weather', label, multiplier })

/** 降水中の天気。[屋根あり, 屋根なし] */
const PRECIPITATION: Partial<Record<WeatherHour['condition'], [SeatFactor, SeatFactor]>> = {
  rain: [weather('雨（屋根の下に人が集まりやすい）', 1.6), weather('雨（座面がぬれていて座る人が少ない）', 0.15)],
  'heavy-rain': [weather('雨（屋根の下に人が集まりやすい）', 1.6), weather('雨（座面がぬれていて座る人が少ない）', 0.15)],
  snow: [weather('雪（屋根の下に人が集まりやすい）', 1.4), weather('雪', 0.1)],
}

function weatherFactor(w: WeatherHour | null, roofed: boolean): SeatFactor | null {
  if (w === null) return null
  const falling = PRECIPITATION[w.condition]
  if (falling) return roofed ? falling[0] : falling[1]
  const chance = w.precipitationProbability ?? 0
  if (!roofed && chance >= 60) return weather(`降水確率 ${w.precipitationProbability}%`, 0.8)
  switch (w.condition) {
    case 'cloudy':
    case 'fog':
      return weather('くもり', 0.95)
    case 'clear':
      return weather('晴れ', 1)
    default:
      return weather('晴れ時々くもり', 1)
  }
}

const isWetCondition = (c: WeatherHour['condition']) => c === 'rain' || c === 'heavy-rain' || c === 'snow'

/**
 * 時間別の予報から、time の時点で雨（雪）がやんでから何時間たったかを返す。
 * まだ降っている、その時間帯の予報がない、最後の雨から 3 時間を超えている（雨がない）ときは null。
 */
export function hoursSinceRain(hours: WeatherHour[], time: Date): number | null {
  const t = time.getTime()
  const slotStart = (h: WeatherHour) => Date.parse(h.time)
  const now = hours.find((h) => slotStart(h) <= t && t < slotStart(h) + HOUR_MS)
  if (now === undefined || isWetCondition(now.condition)) return null

  const lastWetEnd = hours
    .filter((h) => isWetCondition(h.condition))
    .map((h) => slotStart(h) + HOUR_MS)
    .filter((end) => end <= t)
    .reduce((a, b) => Math.max(a, b), -Infinity)
  const elapsed = (t - lastWetEnd) / HOUR_MS
  return elapsed > 3 ? null : round2(elapsed)
}

/** 雨上がりで座面がぬれている（屋根の下は関係ない）。[経過時間の上限, 説明, 倍率] */
const DRYING_STEPS: Array<[maxHours: number, note: string, multiplier: number]> = [
  [1, '座面がまだぬれていそう', 0.5],
  [2, '座面が乾ききっていないかも', 0.75],
  [Infinity, 'ほぼ乾いていそう', 0.9],
]

function wetFactor(hours: number | null | undefined, roofed: boolean): SeatFactor | null {
  if (roofed || hours == null) return null
  // 読めない値（NaN）は最後の段階として扱う
  const [, note, multiplier] = DRYING_STEPS.find(([max]) => hours <= max) ?? DRYING_STEPS[DRYING_STEPS.length - 1]
  return { key: 'wet', label: `雨上がり（${note}）`, multiplier }
}

// ── 暑さ・暗さ ──────────────────────────────────────

interface HeatRule {
  /** この値以上で当てはまる暑さ指数 */
  wbgtAtLeast: number
  shaded: [multiplier: number, note: string | null]
  sunny: [multiplier: number, note: string]
}

/** 暑い日は日陰に人が寄り、日なたは避けられる。上から順に判定する */
const HEAT_RULES: HeatRule[] = [
  { wbgtAtLeast: 28, shaded: [1.35, '日陰に人が集まる'], sunny: [0.35, '日なたは座る人が減る'] },
  { wbgtAtLeast: 25, shaded: [1.2, '日陰が好まれる'], sunny: [0.6, '日なたは避けられがち'] },
  { wbgtAtLeast: 21, shaded: [1.05, null], sunny: [0.85, 'やや暑い日なた'] },
]
/** これより寒い（℃）と、逆に日なたが好まれる */
const CHILLY_BELOW_C = 13

function heatFactor(wbgt: number | null, temp: number | null, shade: ShadeState): SeatFactor | null {
  if (shade === 'night') return null
  const inShade = isShaded(shade)

  const rule = wbgt === null ? undefined : HEAT_RULES.find((r) => wbgt >= r.wbgtAtLeast)
  if (rule) {
    const [multiplier, note] = inShade ? rule.shaded : rule.sunny
    return { key: 'heat', label: `暑さの参考指数 ${wbgt}${note ? `（${note}）` : ''}`, multiplier }
  }
  if (temp !== null && temp < CHILLY_BELOW_C) {
    const t = Math.round(temp)
    return inShade
      ? { key: 'heat', label: `気温 ${t}℃（日陰は寒い）`, multiplier: 0.8 }
      : { key: 'heat', label: `気温 ${t}℃（ひなたぼっこ向き）`, multiplier: 1.15 }
  }
  return null
}

function darkFactor(shade: ShadeState, roofed: boolean): SeatFactor | null {
  return shade === 'night' && !roofed ? { key: 'dark', label: '日没後で暗い（座る人が減る）', multiplier: 0.75 } : null
}

// ── イベント ────────────────────────────────────────

/** time の時点で開催中のイベント。日付の指定があれば日付で、なければ曜日で判定する */
export function activeEvents(events: AreaEvent[], time: Date): AreaEvent[] {
  const { dateKey, weekday, minutesOfDay } = jstParts(time)
  const onDay = (e: AreaEvent) => (e.dates.length > 0 ? e.dates.includes(dateKey) : e.daysOfWeek.includes(weekday))
  return events.filter((e) => onDay(e) && e.startMin <= minutesOfDay && minutesOfDay < e.endMin)
}

/** 開催中のイベントが近いほど混む（会場の中心で intensity、半径の端で 0） */
function eventFactor(spot: Spot, events: AreaEvent[], time: Date): SeatFactor | null {
  const hits = activeEvents(events, time)
    .map((e) => ({ e, d: haversineM(spot.position, e.position) }))
    .filter(({ e, d }) => d < e.radiusM)
  let boost = 0
  for (const { e, d } of hits) boost += e.intensity * (1 - d / e.radiusM)
  if (boost <= 0.01) return null
  return { key: 'event', label: `${hits.map(({ e }) => e.name).join('・')}が開催中`, multiplier: round2(1 + boost) }
}

// ── 席数 ────────────────────────────────────────────

/** 席数（不明なら種類ごとの既定値）と、1 人で座れる目安の席数 */
export function effectiveSeatsOf(spot: Spot): { seats: number; effective: number; assumed: boolean } {
  const seats = spot.seats ?? SEAT_MODEL.defaultSeats[spot.kind] ?? 3
  return { seats, effective: Math.max(1, Math.ceil(seats / 2)), assumed: spot.seats === null }
}

function seatsFactor({ seats, effective, assumed }: ReturnType<typeof effectiveSeatsOf>): SeatFactor {
  const label = assumed
    ? `席数は不明のため ${seats} 席と仮定（1 人で座れる目安 ${effective} 席）`
    : `${seats} 席（1 人で座れる目安 ${effective} 席）`
  return { key: 'seats', label, multiplier: 1 }
}

// ── 投稿 ────────────────────────────────────────────

/** 投稿の重み。postHalfLifeMin 分ごとに半分になる */
export function postWeight(minutesAgo: number): number {
  return Math.pow(0.5, minutesAgo / SEAT_MODEL.postHalfLifeMin)
}

/** その地点の、直近 postWindowMin 分以内の投稿（新しい順） */
export function recentPosts(spotId: string, reports: SeatReport[], now: Date): SeatPrediction['posts'] {
  const posts: SeatPrediction['posts'] = []
  for (const r of reports) {
    if (r.spotId !== spotId) continue
    const minutesAgo = Math.round((now.getTime() - new Date(r.reportedAt).getTime()) / MINUTE_MS)
    if (!(minutesAgo >= 0 && minutesAgo <= SEAT_MODEL.postWindowMin)) continue
    posts.push({ value: r.value, origin: r.origin, minutesAgo })
  }
  return posts.sort((a, b) => a.minutesAgo - b.minutesAgo)
}

/** 直近の投稿を混ぜてよい時刻か（いまの 15 分前から 30 分後まで） */
export function postsApply(time: Date, now: Date): boolean {
  const aheadMin = (time.getTime() - now.getTime()) / MINUTE_MS
  return -15 <= aheadMin && aheadMin <= 30
}

/** 座れた/満席のどちらかを答えた投稿か（「見ただけ」などは数えない） */
const isOutcome = (value: SeatReport['value']) => value === 'sat' || value === 'full'
const outcomeValue = (value: SeatReport['value']) => (value === 'sat' ? 1 : 0)

/**
 * 過去の投稿から学ぶ補正。直近 postWindowMin 分より前の「座れた／満席」の投稿で、
 * 投稿したときの入力（features）が保存されているものについて「結果（座れた=1, 満席=0）− そのときの AI 予測」を集め、
 * 平日/休日の一致・時刻の近さ・新しさで重み付けした平均を返す。件数が少ないうちは historyShrink 件ぶん 0 側に寄せる。
 */
export function historyOffset(
  spotId: string,
  reports: SeatReport[],
  time: Date,
  now: Date,
  dayType: DayType,
): { offset: number; n: number } | null {
  const { hour, minute } = jstParts(time)
  const targetHour = hour + minute / 60
  const isWeekday = dayType === 'weekday'
  const halfLifeMin = SEAT_MODEL.historyHalfLifeDays * 1440
  const twoSigma2 = 2 * SEAT_MODEL.historyHourSigma ** 2

  let weightSum = 0
  let residualSum = 0
  for (const r of reports) {
    const f = r.features
    if (r.spotId !== spotId || !isOutcome(r.value) || !f || f.aiProbability === null) continue
    const minutesAgo = (now.getTime() - Date.parse(r.reportedAt)) / MINUTE_MS
    // NaN（日時が読めない）も除外する
    if (!(minutesAgo > SEAT_MODEL.postWindowMin)) continue
    const dayMatch = (f.dayType === 'weekday') === isWeekday ? 1 : SEAT_MODEL.historyOtherDayWeight
    const dh = f.hour - targetHour
    const w = dayMatch * Math.exp(-(dh * dh) / twoSigma2) * Math.pow(0.5, minutesAgo / halfLifeMin)
    if (w < 0.01) continue
    weightSum += w
    residualSum += w * (outcomeValue(r.value) - f.aiProbability)
  }
  if (weightSum === 0) return null
  return { offset: round3(residualSum / (weightSum + SEAT_MODEL.historyShrink)), n: round2(weightSum) }
}

/** AI 予測に直近の投稿を混ぜた結果 */
interface Blend {
  combined: number
  liveWeight: number
  nearbyPosts: number
}

/** AI 予測を priorWeight 件ぶんの投稿とみなし、直近の投稿（近くの地点の分は軽く）と重み付き平均する */
function blendWithPosts(ai: number, inp: SeatInputs, own: SeatPrediction['posts']): Blend {
  let weightSum = SEAT_MODEL.priorWeight
  let valueSum = SEAT_MODEL.priorWeight * ai
  let liveWeight = 0
  let nearbyPosts = 0
  const add = (value: SeatReport['value'], w: number) => {
    weightSum += w
    valueSum += w * outcomeValue(value)
    liveWeight += w
  }

  for (const p of own) {
    if (isOutcome(p.value)) add(p.value, postWeight(p.minutesAgo))
  }
  for (const n of inp.neighbors ?? []) {
    const closeness = 1 - n.distanceM / SEAT_MODEL.nearbyPostRadiusM
    for (const p of recentPosts(n.spotId, inp.reports, inp.now)) {
      if (!isOutcome(p.value)) continue
      add(p.value, postWeight(p.minutesAgo) * SEAT_MODEL.nearbyPostWeight * closeness)
      nearbyPosts++
    }
  }
  return { combined: valueSum / weightSum, liveWeight, nearbyPosts }
}

// ── まとめ ──────────────────────────────────────────

const clampProbability = (p: number) => Math.min(0.99, Math.max(0.01, p))

export function predictSeat(inp: SeatInputs): SeatPrediction {
  const roofed = inp.shade === 'roof' || inp.spot.roof === 'yes'

  // 倍率を掛ける順番は表示の順番でもある
  const candidates: Array<SeatFactor | null> = [
    timeFactor(inp.dayType, inp.time),
    weatherFactor(inp.weather, roofed),
    wetFactor(inp.hoursSinceRain, roofed),
    heatFactor(inp.wbgt, inp.weather?.temperatureC ?? null, inp.shade),
    darkFactor(inp.shade, roofed),
    eventFactor(inp.spot, inp.events, inp.time),
    { key: 'location', label: locationLabel(inp.location.multiplier, inp.location.nearest?.name), multiplier: inp.location.multiplier },
    nearbyFactor(inp.neighbors),
  ]
  const factors = candidates.filter((f): f is SeatFactor => f !== null)
  const occupancy = Math.min(0.97, Math.max(0.02, factors.reduce((rho, f) => rho * f.multiplier, SEAT_MODEL.baseOccupancy)))

  const seats = effectiveSeatsOf(inp.spot)
  factors.push(seatsFactor(seats))

  const rule = 1 - Math.pow(occupancy, seats.effective)
  const history = historyOffset(inp.spot.id, inp.reports, inp.time, inp.now, inp.dayType)
  const ai = history === null ? rule : clampProbability(rule + history.offset)

  const posts = recentPosts(inp.spot.id, inp.reports, inp.now)
  const applies = postsApply(inp.time, inp.now)
  const blend: Blend = applies ? blendWithPosts(ai, inp, posts) : { combined: ai, liveWeight: 0, nearbyPosts: 0 }

  return {
    spotId: inp.spot.id,
    rule: round3(rule),
    history,
    ai: round3(ai),
    occupancy: round3(occupancy),
    effectiveSeats: seats.effective,
    seatsAssumed: seats.assumed,
    factors,
    posts,
    combined: round3(blend.combined),
    nearbyPosts: blend.nearbyPosts,
    confidence: confidenceOf(blend.combined, {
      seatsAssumed: seats.assumed,
      weatherIsDemo: inp.weatherIsDemo === true,
      hoursAhead: (inp.time.getTime() - inp.now.getTime()) / HOUR_MS,
      historyN: history?.n ?? 0,
      liveWeight: blend.liveWeight,
      applies,
    }),
    method: 'rule-v1',
  }
}

// ── 確からしさ ──────────────────────────────────────

/** 80% 区間の幅（正規分布で ±1.28σ） */
const Z80 = 1.28

/**
 * 予測の確からしさ。ルールだけの予測を観測 baseEvidence 回ぶんとし、仮定 1 つにつき 1 回ぶん減らし（最低 1）、
 * 過去の投稿と直近の投稿のぶんを足す。区間は二項分布の正規近似で、実測で校正したものではない。
 */
export function confidenceOf(
  p: number,
  c: { seatsAssumed: boolean; weatherIsDemo: boolean; hoursAhead: number; historyN: number; liveWeight: number; applies: boolean },
): SeatPrediction['confidence'] {
  const caveats: string[] = []
  if (c.seatsAssumed) caveats.push('席数は仮定')
  if (c.weatherIsDemo) caveats.push('天気はデモの値')
  if (Math.abs(c.hoursAhead) > 6) caveats.push(c.hoursAhead > 0 ? '先の時刻の予測' : '過去の時刻の推定')

  const notes = [...caveats]
  let n = Math.max(1, SEAT_MODEL.baseEvidence - caveats.length)
  if (c.historyN > 0) {
    n += c.historyN
    notes.push('過去の投稿で補正')
  }
  if (c.liveWeight > 0) {
    n += c.liveWeight * 2
    notes.push('直近の投稿あり')
  } else if (c.applies) {
    notes.push('直近の投稿なし')
  }

  const halfWidth = Z80 * Math.sqrt((p * (1 - p)) / (n + 1))
  return {
    level: n >= 7 ? 'high' : n >= 4 ? 'mid' : 'low',
    low: round3(Math.max(0, p - halfWidth)),
    high: round3(Math.min(1, p + halfWidth)),
    effectiveN: round2(n),
    notes,
  }
}

export const CONFIDENCE_LABEL: Record<SeatPrediction['confidence']['level'], string> = { high: '高', mid: '中', low: '低' }

// ── 表示用 ──────────────────────────────────────────

export type SeatLevel = 'high' | 'mid' | 'low'

/** 確率を 3 段階に分ける（70% 以上 / 40% 以上 / それ未満） */
export function seatLevel(p: number): SeatLevel {
  return p >= 0.7 ? 'high' : p >= 0.4 ? 'mid' : 'low'
}

export const SEAT_LEVEL_LABEL: Record<SeatLevel, string> = { high: '座れそう', mid: '五分五分', low: '混みそう' }

export const pct = (p: number) => `${Math.round(p * 100)}%`

/** 「トイレの近く」で絞り込むときの距離（m）。歩いて 2 分ほど */
export const TOILET_NEAR_M = 150

/** 各地点から、targets のうちいちばん近いものまでの直線距離（m）。targets が空なら Infinity */
export function nearestDistanceMap(spots: Spot[], targets: Spot[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const s of spots) {
    let best = Infinity
    for (const t of targets) best = Math.min(best, haversineM(s.position, t.position))
    result.set(s.id, best)
  }
  return result
}
