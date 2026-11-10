/**
 * 休憩の必要度（RC-1・RC-5・RC-7・11章）。
 * 医療的な判定はしない。入力された疲れ・歩いた時間・暑さ指数から「今休むとよさそうか」をルールで決める。
 * Gemini に渡すのは allowlist に載せた集計値だけ（時系列・トークン・アカウント情報・正確な位置は送らない）。
 */

export type Fatigue = 'slight' | 'heavy' | 'limit'
export type WalkedBand = 'under15' | 'under30' | 'over30'
export type AvailableMinutes = 5 | 15 | 30
export type RestWish = 'cool' | 'shade' | 'roof' | 'seat' | 'backrest' | 'toilet' | 'barrierFree' | 'water'
/** 値の出どころ。画面には必ずラベルで示す */
export type HealthSource = 'manual' | 'demo' | 'health'
/** 直近の心拍の傾向。生の値や時系列は扱わず、区分だけを使う */
export type HeartCategory = 'normal' | 'slightlyHigh' | 'high'

export type Sourced<T> = { value: T; source: HealthSource }

export interface RestNeed {
  fatigue: Fatigue
  walked: WalkedBand
  available: AvailableMinutes
  wishes: RestWish[]
  /** RC-2: 必ず満たしたい希望（wishes の一部）。満たさない地点は外し、未確認なら下げて残す */
  must?: RestWish[]
  steps?: Sourced<number>
  activeMinutes?: Sourced<number>
  sleepHours?: Sourced<number>
  heart?: Sourced<HeartCategory>
}

export const FATIGUE_LABEL: Record<Fatigue, string> = { slight: '少し', heavy: 'かなり', limit: '限界に近い' }
export const WALKED_LABEL: Record<WalkedBand, string> = { under15: '〜15分', under30: '〜30分', over30: '30分以上' }
export const AVAILABLE_OPTIONS: AvailableMinutes[] = [5, 15, 30]
export const WISH_LABEL: Record<RestWish, string> = {
  cool: '涼しい場所',
  shade: '日陰',
  roof: '屋根',
  seat: '座りたい',
  backrest: '背もたれ',
  toilet: 'トイレ近く',
  barrierFree: '段差なし',
  water: '給水',
}
export const WISHES = Object.keys(WISH_LABEL) as RestWish[]
export const SOURCE_LABEL: Record<HealthSource, string> = { manual: '手入力', demo: 'デモ値', health: 'Google Health' }
export const HEART_LABEL: Record<HeartCategory, string> = { normal: '平常どおり', slightlyHigh: '平常よりやや高め', high: '平常より高め' }

/** 画面と Gemini で共通に使う注意書き（RC-7） */
export const MEDICAL_NOTICE = '医療診断・熱中症の危険度判定には使えません'
/** 「限界に近い」を選んだときに最初に出す案内。窓口の名称・番号は公式情報で確かめるまで載せない */
export const SAFETY_GUIDANCE = '無理に移動せず、近くの人や施設スタッフに声をかけてください。体調に不安があれば救急相談窓口に相談してください。'
/** Gemini の出力が使えないときの固定文 */
export const FALLBACK_ADVICE = '入力された状況から、ここで一度ひと休みするのがおすすめです。体調に不安があるときは無理をせず、近くの人や施設スタッフに声をかけてください。'

/** デモ用の健康データ（実在の人の値ではない） */
export const DEMO_HEALTH = {
  steps: 8600,
  activeMinutes: 42,
  sleepHours: 5.5,
  heart: 'slightlyHigh' as HeartCategory,
}

/**
 * 直近の平均心拍と安静時心拍から区分を出す（目安。医学的な基準ではない）。
 * どちらかが無ければ null（使わない）。
 */
export function heartCategory(recentAvgBpm: number | null, restingBpm: number | null): HeartCategory | null {
  if (recentAvgBpm === null || restingBpm === null || !Number.isFinite(recentAvgBpm) || !Number.isFinite(restingBpm) || restingBpm <= 0) return null
  const diff = recentAvgBpm - restingBpm
  if (diff >= 30) return 'high'
  if (diff >= 15) return 'slightlyHigh'
  return 'normal'
}

/** 暑さ指数が「厳重警戒」以上なら早めに提案する（RC-5: 通常30分、暑いとき20分） */
export const HOT_WBGT = 28
export function walkThresholdMinutes(wbgt: number | null): number {
  return wbgt !== null && wbgt >= HOT_WBGT ? 20 : 30
}

const WALKED_MINUTES: Record<WalkedBand, number> = { under15: 10, under30: 25, over30: 35 }

export type RestLevel = 'now' | 'soon' | 'ok'
export interface RestJudgement {
  level: RestLevel
  /** 判断の根拠（画面表示・Gemini への入力に使う。数値は入力値そのまま） */
  reasons: string[]
  /** 「限界に近い」なら安全案内を先に出す */
  safetyFirst: boolean
}

/**
 * ルールによる休憩判断。Gemini が無くても同じ画面が成り立つよう、こちらが常に主になる。
 * walkingMinutes を渡したときは、選択肢（歩いた時間）より実際の経過時間を優先する。
 */
export function judgeRest(need: RestNeed, wbgt: number | null, walkingMinutes?: number): RestJudgement {
  const reasons: string[] = []
  let score = 0
  if (need.fatigue === 'limit') { reasons.push('疲れが「限界に近い」'); score += 3 }
  else if (need.fatigue === 'heavy') { reasons.push('疲れが「かなり」'); score += 2 }
  else score += 0.5
  const walked = walkingMinutes ?? WALKED_MINUTES[need.walked]
  const threshold = walkThresholdMinutes(wbgt)
  if (walked >= threshold) { reasons.push(`続けて${walkingMinutes !== undefined ? `約${Math.round(walked)}分` : WALKED_LABEL[need.walked]}歩いている`); score += 1.5 }
  if (wbgt !== null && wbgt >= HOT_WBGT) { reasons.push(`暑さ指数の推定が${wbgt}（厳重警戒以上の目安）`); score += 1 }
  else if (wbgt !== null && wbgt >= 25) { reasons.push(`暑さ指数の推定が${wbgt}`); score += 0.5 }
  if (need.steps && need.steps.value >= 12000) { reasons.push(`今日の歩数が${need.steps.value.toLocaleString('ja-JP')}歩`); score += 0.5 }
  if (need.activeMinutes && need.activeMinutes.value >= 60) { reasons.push(`今日の活動時間が${need.activeMinutes.value}分`); score += 0.5 }
  if (need.sleepHours && need.sleepHours.value < 6) { reasons.push(`昨夜の睡眠が約${need.sleepHours.value}時間`); score += 0.5 }
  if (need.heart && need.heart.value !== 'normal') { reasons.push(`直近の心拍が${HEART_LABEL[need.heart.value]}`); score += need.heart.value === 'high' ? 1 : 0.5 }
  const level: RestLevel = score >= 2 ? 'now' : score >= 1 ? 'soon' : 'ok'
  return { level, reasons, safetyFirst: need.fatigue === 'limit' }
}

export const REST_LEVEL_LABEL: Record<RestLevel, string> = {
  now: '今ひと休みするのがおすすめです',
  soon: '近いうちにひと休みしましょう',
  ok: '休みたくなったらいつでもどうぞ',
}

/** 時間内に歩いて行ける目安の距離（往復を考えて、使える時間の3割を移動に回す。分速80m） */
export function reachableMeters(available: AvailableMinutes): number {
  return Math.max(200, Math.round(available * 0.3 * 80 / 50) * 50)
}

/* ---------- RC-5 アプリ内バナー ---------- */

export const SNOOZE_MINUTES = 15
export interface BannerState {
  disabled: boolean
  snoozedUntil: number | null
}
export function shouldSuggestRest(walkingMinutes: number, wbgt: number | null, state: BannerState, now: number): boolean {
  if (state.disabled) return false
  if (state.snoozedUntil !== null && now < state.snoozedUntil) return false
  return walkingMinutes >= walkThresholdMinutes(wbgt)
}

/* ---------- 11.3 Gemini に送る値の allowlist ---------- */

/** Gemini に送ってよい項目だけの形。これ以外のキーはサーバーでも捨てる */
export interface RestAdviceContext {
  fatigue: Fatigue
  walkingMinutes: number
  available: AvailableMinutes
  wishes: RestWish[]
  temperatureC: number | null
  wbgt: number | null
  reasons: string[]
  /** 以下は健康データの同意があるときだけ */
  steps?: number
  activeMinutes?: number
  sleepHours?: number
  heart?: HeartCategory
}

/** 画面の入力から Gemini 用の値を作る。healthConsent が false なら健康データは一切入れない */
export function allowlistPayload(
  need: RestNeed,
  env: { walkingMinutes: number; temperatureC: number | null; wbgt: number | null; reasons: string[] },
  healthConsent: boolean,
): RestAdviceContext {
  const out: RestAdviceContext = {
    fatigue: need.fatigue,
    walkingMinutes: Math.max(0, Math.min(600, Math.round(env.walkingMinutes))),
    available: need.available,
    wishes: need.wishes.filter(w => WISHES.includes(w)),
    temperatureC: env.temperatureC === null ? null : Math.round(env.temperatureC),
    wbgt: env.wbgt === null ? null : Math.round(env.wbgt * 10) / 10,
    reasons: env.reasons.slice(0, 12).map(r => r.slice(0, 120)),
  }
  if (healthConsent) {
    if (need.steps) out.steps = Math.round(need.steps.value)
    if (need.activeMinutes) out.activeMinutes = Math.round(need.activeMinutes.value)
    if (need.sleepHours) out.sleepHours = Math.round(need.sleepHours.value * 2) / 2
    if (need.heart) out.heart = need.heart.value
  }
  return out
}

const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
/**
 * サーバー側の検証。allowlist 以外のキーは捨て、型の合わない入力は null。
 * healthConsent が true でない限り、健康データは届いても使わない。
 */
export function sanitizeRestContext(input: unknown, healthConsent: unknown): RestAdviceContext | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const b = input as Record<string, unknown>
  if (!['slight', 'heavy', 'limit'].includes(b.fatigue as string)) return null
  if (!num(b.walkingMinutes, 0, 600)) return null
  if (![5, 15, 30].includes(b.available as number)) return null
  if (!Array.isArray(b.wishes) || b.wishes.length > WISHES.length || b.wishes.some(w => !WISHES.includes(w as RestWish))) return null
  if (!(b.temperatureC === null || num(b.temperatureC, -30, 60))) return null
  if (!(b.wbgt === null || num(b.wbgt, -10, 50))) return null
  if (!Array.isArray(b.reasons) || b.reasons.length > 12 || b.reasons.some(r => typeof r !== 'string' || r.length > 120)) return null
  const out: RestAdviceContext = {
    fatigue: b.fatigue as Fatigue,
    walkingMinutes: b.walkingMinutes as number,
    available: b.available as AvailableMinutes,
    wishes: b.wishes as RestWish[],
    temperatureC: b.temperatureC as number | null,
    wbgt: b.wbgt as number | null,
    reasons: b.reasons as string[],
  }
  if (healthConsent === true) {
    if (num(b.steps, 0, 200000)) out.steps = b.steps as number
    if (num(b.activeMinutes, 0, 1440)) out.activeMinutes = b.activeMinutes as number
    if (num(b.sleepHours, 0, 24)) out.sleepHours = b.sleepHours as number
    if (['normal', 'slightlyHigh', 'high'].includes(b.heart as string)) out.heart = b.heart as HeartCategory
  }
  return out
}

/**
 * Gemini の出力に診断・病名・危険度の断定が含まれていたら固定文に差し替える（RC-7）。
 * 迷う表現は差し替える側に倒す。
 */
const BLOCKED = [
  /診断/, /熱中症/, /脱水/, /病気/, /疾患/, /症状/, /病院/, /受診/, /医師/, /医療/, /治療/, /薬/,
  /心臓/, /不整脈/, /頻脈/, /高血圧/, /低血糖/, /貧血/, /失神/, /心拍数が\d/, /\d+\s*bpm/i,
  /危険(な状態|です|性が高)/, /命に/, /救急車/, /[0-9０-９]{3,}-?[0-9０-９]{3,}/,
]
export function guardAdvice(text: string): { text: string; replaced: boolean } {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || t.length > 200 || BLOCKED.some(r => r.test(t))) return { text: FALLBACK_ADVICE, replaced: true }
  return { text: t, replaced: false }
}

/* ---------- Google Health の集計値（サーバー → 画面） ---------- */

export type HealthItemStatus = 'ok' | 'noConsent' | 'noData' | 'error'
export interface HealthItem<T> { status: HealthItemStatus; value?: T }
export interface HealthSummary {
  linked: boolean
  steps: HealthItem<number>
  activeMinutes: HealthItem<number>
  sleepHours: HealthItem<number>
  heart: HealthItem<HeartCategory>
  fetchedAt: string
}

/** 集計値を RestNeed に反映する。値の無い項目・同意の無い項目は入れない */
export function applyHealth(need: RestNeed, summary: HealthSummary): RestNeed {
  const next: RestNeed = { ...need }
  if (summary.steps.status === 'ok' && summary.steps.value !== undefined) next.steps = { value: summary.steps.value, source: 'health' }
  if (summary.activeMinutes.status === 'ok' && summary.activeMinutes.value !== undefined) next.activeMinutes = { value: summary.activeMinutes.value, source: 'health' }
  if (summary.sleepHours.status === 'ok' && summary.sleepHours.value !== undefined) next.sleepHours = { value: summary.sleepHours.value, source: 'health' }
  if (summary.heart.status === 'ok' && summary.heart.value !== undefined) next.heart = { value: summary.heart.value, source: 'health' }
  return next
}

export function applyDemo(need: RestNeed): RestNeed {
  return {
    ...need,
    steps: { value: DEMO_HEALTH.steps, source: 'demo' },
    activeMinutes: { value: DEMO_HEALTH.activeMinutes, source: 'demo' },
    sleepHours: { value: DEMO_HEALTH.sleepHours, source: 'demo' },
    heart: { value: DEMO_HEALTH.heart, source: 'demo' },
  }
}

export const DEFAULT_NEED: RestNeed = { fatigue: 'heavy', walked: 'under30', available: 15, wishes: [] }
