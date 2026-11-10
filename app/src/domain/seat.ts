// 2026-11-10 に開発期間内のコードとして書き直し（期間中に足した部分はそのまま）
import { haversineM } from './geo.ts'
import { jstParts } from './time.ts'
import { isShaded } from './shade.ts'
import type { AreaEvent, Attractor, DayType, SeatFactor, SeatPrediction, SeatReport, ShadeState, Spot, SpotKind, WeatherHour, WeatherNow } from './types.ts'
/**
 * 空席確率 v1（カメラ・センサーなし）。
 *
 * 1 席あたりの埋まりやすさ ρ = 基準値 × 時間帯 × 天気 × 雨上がり × 暑さ × 暗さ × イベント × 人通り × 近くの席（0.02〜0.97 に収める）
 * 席が全部埋まっていない確率 = 1 − ρ^席数。
 * ρ は「その時刻に 1 席が埋まっている見込み」で、時刻・曜日・天気・暑さ・周りの施設などの倍率を掛けて求める。
 *
 * ルールの確率に、同じ地点の過去の投稿（似た曜日・時間帯）から学んだ補正を足したものを AI 予測とする。
 * 直近 90 分の投稿（その地点と 150m 以内の地点）はさらにベイズ風に混ぜて combined にする。
 * 係数はここにまとめてある。投稿が十分たまったらロジスティック回帰などで係数自体を学習する想定（docs/API_GUIDE.md）。
 */
export const SEAT_MODEL = {
  /** 平日昼の基準の ρ */
  baseOccupancy: 0.32,
  minOccupancy: 0.02,
  maxOccupancy: 0.97,
  /** 席数が分からないときに仮定する席数（種類ごと） */
  assumedSeats: { bench: 3, shelter: 4, picnic: 6, indoor: 12 } as Partial<Record<SpotKind, number>>,
  /** 直近の投稿として扱う時間（分）と、重みが半分になる時間（分） */
  postWindowMin: 90,
  postHalfLifeMin: 30,
  /** 直近の投稿と混ぜるとき、ルールの値を投稿何件分とみなすか */
  rulePrior: 2,
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

export const SEAT_KINDS: ReadonlySet<SpotKind> = new Set(['bench', 'shelter', 'picnic', 'indoor'])
export const isSeatSpot = (s: Pick<Spot, 'kind'>) => SEAT_KINDS.has(s.kind)

const round2 = (n: number) => Math.round(n * 100) / 100
const round3 = (n: number) => Math.round(n * 1000) / 1000

// ───────── 時刻・天気・催し・人通り ─────────

/** 時間帯ごとの混み具合（平日／休日）。昼休みと夕方に人が増え、早朝と夜は少ない */
const HOURLY: Record<'weekday' | 'weekend', number[]> = {
  weekday: [0.2, 0.15, 0.1, 0.1, 0.1, 0.15, 0.3, 0.5, 0.7, 0.75, 0.8, 0.95, 1.25, 1.1, 0.95, 0.95, 1.0, 1.05, 0.95, 0.75, 0.6, 0.45, 0.35, 0.25],
  weekend: [0.25, 0.2, 0.15, 0.1, 0.1, 0.15, 0.25, 0.4, 0.6, 0.85, 1.05, 1.25, 1.4, 1.45, 1.45, 1.4, 1.35, 1.2, 1.05, 0.9, 0.75, 0.55, 0.4, 0.3],
}
export const DAY_TYPE_LABEL: Record<DayType, string> = { weekday: '平日', weekend: '土日', holiday: '祝日' }

function timeFactor(time: Date, dayType: DayType): SeatFactor {
  const p = jstParts(time), table = HOURLY[dayType === 'weekday' ? 'weekday' : 'weekend']
  const h = p.hour + p.minute / 60, i = Math.floor(h) % 24, f = h - Math.floor(h)
  const m = table[i] * (1 - f) + table[(i + 1) % 24] * f
  return { key: 'time', label: `${DAY_TYPE_LABEL[dayType]}の${p.hour}時台`, multiplier: round2(m) }
}

function weatherFactor(w: Pick<WeatherNow, 'condition' | 'temperatureC'> | null | undefined, roofed: boolean): SeatFactor | null {
  if (!w) return null
  const c = w.condition
  if (c === 'rain' || c === 'heavy-rain' || c === 'snow') return roofed ? { key: 'weather', label: '雨・雪（屋根の下に人が集まる）', multiplier: 1.3 } : { key: 'weather', label: c === 'heavy-rain' ? '強い雨（屋根なしは座る人がほぼいない）' : '雨・雪（屋根なしは座る人が減る）', multiplier: c === 'heavy-rain' ? 0.12 : 0.3 }
  if (w.temperatureC <= 8 && !roofed) return { key: 'weather', label: `寒い（${Math.round(w.temperatureC)}°C・外で座る人が減る）`, multiplier: 0.7 }
  if (c === 'clear' && w.temperatureC >= 15 && w.temperatureC <= 26) return { key: 'weather', label: '過ごしやすい晴れ（外で座る人が増える）', multiplier: 1.15 }
  return null
}

/** 近くの人が集まる場所（駅・商業施設・観光地）の影響。近くて大きいほど人通りが多い */
export function locationFactor(spot: Spot, attractors: Attractor[]): { multiplier: number; nearest: { name: string; distanceM: number } | null } {
  let pull = 0
  let nearest: { name: string; distanceM: number } | null = null
  for (const a of attractors) {
    const d = haversineM(spot.position, a.position)
    if (d > 600) continue
    pull += a.weight * Math.max(0, 1 - d / 600)
    if (a.name && (!nearest || d < nearest.distanceM)) nearest = { name: a.name, distanceM: Math.round(d) }
  }
  return { multiplier: round2(Math.min(1.6, 0.8 + 0.25 * pull)), nearest }
}

function eventFactor(spot: Spot, events: AreaEvent[], time: Date): SeatFactor | null {
  const p = jstParts(time)
  const on = events.filter((e) => (!e.days || e.days.includes(p.dateKey)) && p.minutesOfDay >= e.startMin - 60 && p.minutesOfDay <= e.endMin + 30 && haversineM(spot.position, e.position) <= e.radiusM)
  if (!on.length) return null
  const top = on.reduce((a, b) => (b.multiplier > a.multiplier ? b : a))
  return { key: 'event', label: `${top.name}の前後で人が多い`, multiplier: round2(top.multiplier) }
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

export interface SeatInput {
  spot: Spot
  /** 予測する時刻 */
  time: Date
  /** いまの時刻（直近の投稿を数える基準） */
  now: Date
  dayType: DayType
  weather: Pick<WeatherNow, 'condition' | 'temperatureC'> | null
  /** 暑さ指数の推定（分からなければ null） */
  wbgt: number | null
  shade: ShadeState
  events: AreaEvent[]
  location: { multiplier: number; nearest: { name: string; distanceM: number } | null }
  reports: SeatReport[]
  /** 雨がやんでから何時間か（予報から求める）。降っていない・分からなければ null */
  hoursSinceRain?: number | null
  /** 近くの座れる地点（150m 以内） */
  neighbors?: SeatNeighbor[]
  /** 天気が実際の予報ではなくデモの値か */
  weatherIsDemo?: boolean
}

/** 地点の直近の投稿（postWindowMin 分以内） */
export function recentPosts(spotId: string, reports: SeatReport[], now: Date) {
  const out: { value: SeatReport['value']; minutesAgo: number }[] = []
  for (const r of reports) {
    if (r.spotId !== spotId) continue
    const minutesAgo = (now.getTime() - Date.parse(r.reportedAt)) / 60_000
    if (minutesAgo >= -1 && minutesAgo <= SEAT_MODEL.postWindowMin) out.push({ value: r.value, minutesAgo: Math.max(0, minutesAgo) })
  }
  return out.sort((a, b) => a.minutesAgo - b.minutesAgo)
}
/** 投稿の重み。postHalfLifeMin 分ごとに半分になる */
export const postWeight = (minutesAgo: number) => Math.pow(0.5, Math.max(0, minutesAgo) / SEAT_MODEL.postHalfLifeMin)
/** 直近の投稿を混ぜてよいのは、いまに近い時刻を見ているときだけ */
export const postsApply = (time: Date, now: Date) => Math.abs(time.getTime() - now.getTime()) <= SEAT_MODEL.postWindowMin * 60_000

/** 種類ごとの席数（分からなければ仮定） */
function seatCount(spot: Spot) {
  if (spot.seats !== null && Number.isFinite(spot.seats) && spot.seats > 0) return { effective: Math.min(60, spot.seats), assumed: false }
  return { effective: SEAT_MODEL.assumedSeats[spot.kind] ?? 3, assumed: true }
}

// ───────── 雨上がり・暗さ・近くの席 ─────────

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

/** 暑い日は日陰の席に人が集まり、日なたの席は避けられる */
function heatFactor(wbgt: number | null, temperatureC: number | null, shade: ShadeState): SeatFactor | null {
  const w = wbgt ?? (temperatureC !== null ? temperatureC - 4 : null)
  if (w === null || shade === 'night' || shade === 'roof' && w < 25) return null
  const shaded = isShaded(shade)
  if (w >= 28)
    return shaded
      ? { key: 'heat', label: `暑さの参考指数 ${wbgt}（日陰に人が集まる）`, multiplier: 1.35 }
      : { key: 'heat', label: `暑さの参考指数 ${wbgt}（日なたは座る人が減る）`, multiplier: 0.35 }
  if (w >= 25)
    return shaded

      ? { key: 'heat', label: `暑さの参考指数 ${wbgt}（日陰が好まれる）`, multiplier: 1.2 }
      : { key: 'heat', label: `暑さの参考指数 ${wbgt}（日なたは避けられがち）`, multiplier: 0.6 }
  if (w >= 21)

    return shaded ? { key: 'heat', label: `暑さの参考指数 ${wbgt}`, multiplier: 1.05 } : { key: 'heat', label: `暑さの参考指数 ${wbgt}（やや暑い日なた）`, multiplier: 0.85 }
  return null
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
    if (r.spotId !== spotId || (r.value !== 'sat' && r.value !== 'full') || !r.features || r.features.aiProbability === null) continue
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

/** 空席確率を求める（カメラ・センサーなし） */
export function predictSeat(inp: SeatInput): SeatPrediction {
  const roofed = inp.spot.roof === 'yes' || inp.shade === 'roof'
  const factors: SeatFactor[] = [timeFactor(inp.time, inp.dayType)]
  for (const f of [
    weatherFactor(inp.weather, roofed),
    wetFactor(inp.hoursSinceRain, roofed),
    heatFactor(inp.wbgt, inp.weather?.temperatureC ?? null, inp.shade),
    darkFactor(inp.shade, roofed),
    eventFactor(inp.spot, inp.events, inp.time),
  ])
    if (f) factors.push(f)
  if (Math.abs(inp.location.multiplier - 1) >= 0.01)
    factors.push({
      key: 'location',
      label: inp.location.nearest ? `${inp.location.nearest.name}から${inp.location.nearest.distanceM}m（人通り）` : '人通りの少ない場所',
      multiplier: round2(inp.location.multiplier),
    })
  const nf = nearbyFactor(inp.neighbors)
  if (nf) factors.push(nf)
  const seats = seatCount(inp.spot)
  factors.push({ key: 'seats', label: seats.assumed ? `席数は仮定（${seats.effective}席）` : `${seats.effective}席`, multiplier: 1 })
  const rho = Math.min(
    SEAT_MODEL.maxOccupancy,
    Math.max(SEAT_MODEL.minOccupancy, factors.reduce((m, f) => m * f.multiplier, SEAT_MODEL.baseOccupancy)),
  )
  const rule = 1 - Math.pow(rho, seats.effective)
  const history = historyOffset(inp.spot.id, inp.reports, inp.time, inp.now, inp.dayType)
  const ai = history ? clamp01(rule + history.offset) : rule

  // 直近の投稿（その地点と近くの地点）をルールの値に混ぜる。いまに近い時刻を見ているときだけ
  const posts = recentPosts(inp.spot.id, inp.reports, inp.now)
  const applies = postsApply(inp.time, inp.now)
  let combined = ai
  let liveWeight = 0
  let nearbyPosts = 0
  if (applies) {
    let vsum = ai * SEAT_MODEL.rulePrior
    const add = (value: SeatReport['value'], w: number) => {
      // 座れた = 1、満席 = 0
      vsum += w * (value === 'sat' ? 1 : 0)
      liveWeight += w
    }
    for (const p of posts) if (p.value === 'sat' || p.value === 'full') add(p.value, postWeight(p.minutesAgo))
    // 近くの地点の投稿（150m 以内）。遠いほど・古いほど軽い
    for (const n of inp.neighbors ?? []) {
      for (const p of recentPosts(n.spotId, inp.reports, inp.now)) {
        if (p.value !== 'sat' && p.value !== 'full') continue
        add(p.value, postWeight(p.minutesAgo) * SEAT_MODEL.nearbyPostWeight * (1 - n.distanceM / SEAT_MODEL.nearbyPostRadiusM))
        nearbyPosts++
      }
    }
    if (liveWeight > 0) combined = clamp01((vsum) / (SEAT_MODEL.rulePrior + liveWeight), 0, 1)
  }
  combined = round3(combined)
  return {
    rule: round3(rule),
    history,
    ai: round3(ai),
    combined,
    occupancy: round3(rho),
    seats,
    factors,
    posts,
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

export type SeatLevel = 'high' | 'mid' | 'low'
/** ピンの色の区切り: 70% 以上は緑（座れそう）、40% 以上は黄、それ未満は赤 */
export const seatLevel = (p: number): SeatLevel => (p >= 0.7 ? 'high' : p >= 0.4 ? 'mid' : 'low')
export const SEAT_LEVEL_LABEL: Record<SeatLevel, string> = { high: '緑（座れそう）', mid: '黄（五分五分）', low: '赤（混みそう）' }
export const pct = (p: number) => `${Math.round(p * 100)}%`

/** 「トイレ近く」の絞り込みの距離（m）。徒歩2分ほど */
export const TOILET_NEAR_M = 150

/** 各地点から、いちばん近い targets（例: トイレ）までの直線距離（m）。targets がなければ Infinity */
export function nearestDistanceMap(spots: Spot[], targets: Spot[]): Map<string, number> {
  return new Map(spots.map((s) => [s.id, targets.reduce((best, t) => Math.min(best, haversineM(s.position, t.position)), Infinity)]))
}
