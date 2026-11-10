// アプリ全体で使う型。2026-11-10 に開発期間内のコードとして書き直し（期間中に足した項目はそのまま残す）
export interface LatLng {lat: number; lng: number}
/** 原点からの平面座標（m）。x は東、y は北 */
export interface XY {x: number; y: number}
export type TriState = 'yes' | 'no' | 'unknown'
export type DayType = 'weekday' | 'weekend' | 'holiday'

export type SpotKind = 'bench' | 'shelter' | 'picnic' | 'toilet' | 'trash' | 'water' | 'indoor'
export interface Spot {
  id: string
  /** 名前が分からない地点は null（画面では近くの目印から呼び名を作る） */
  name: string | null
  kind: SpotKind
  position: LatLng
  roof: TriState
  /** 屋根の情報の出どころ。tag=OSMのタグ、inside-building=建物の中、roof-polygon=屋根の形の中（どちらも推定）、user=投稿者 */
  roofSource: 'tag' | 'inside-building' | 'roof-polygon' | 'user' | null
  /** 座れる人数の目安。分からなければ null（計算では仮定の値を使う） */
  seats: number | null
  backrest: TriState
  /** 車いすで使えるか。limited = 一部のみ */
  wheelchair: TriState | 'limited'
  /** 利用条件（営業時間・利用者限定など）。OSM の access / opening_hours から */
  access?: string
  /** 説明（利用条件・営業時間など） */
  description?: string
  /** ユーザーが書いたメモ（ゴミ箱の「捨てられる物」など） */
  note?: string
  origin: 'osm' | 'user'
  createdAt?: string
  /** RC-0: 冷房・段差なし・多目的トイレ。未設定は「未確認」として扱う */
  cooling?: TriState
  stepFree?: TriState
  accessibleToilet?: TriState
  /** 情報の出どころと現地確認した日時（RC-0・RC-4） */
  infoSource?: 'osm' | 'field-check' | 'official' | 'user'
  verifiedAt?: string
}

export interface Building {
  id: string
  /** building = 建物、roof = 屋根だけの構造物（下を歩ける。影は落とすが中は屋根の下） */
  kind: 'building' | 'roof'
  footprint: LatLng[]
  /** 地面から屋根までの高さ（m） */
  height: number
  /** 下層が空いている建物の、下端の高さ（m）。通常は 0 */
  minHeight: number
  heightSource: 'measured' | 'levels' | 'assumed' | 'plateau'
  name?: string
}
export interface Tree {id: string; position: LatLng; height: number; crownRadius: number}
export interface Park {id: string; ring: LatLng[]; name?: string}
/** 人が集まる場所（駅・商業施設・観光地）。空席の「人通り」と地点の呼び名に使う */
export interface Attractor {id: string; name: string; position: LatLng; weight: number; kind: 'station' | 'mall' | 'sight' | 'other'}

export interface AreaDataset {
  spots: Spot[]
  buildings: Building[]
  trees: Tree[]
  parks: Park[]
  attractors: Attractor[]
  meta: {
    source: string
    sourceLabel: string
    attribution: string
    /** OSM のデータ時点（ISO） */
    asOf: string | null
    fetchedAt: string | null
    live: boolean
    heightSources: Record<Building['heightSource'], number>
    plateauBuildings?: number
  }
}

export interface SunPosition {
  /** 高度（度）。地平線が 0 */
  altitude: number
  /** 方位（度）。北が 0、東が 90 */
  azimuth: number
}

/** cloud = くもり・雨などで直射日光がない（建物の影に関係なく、街全体が日陰になる） */
export type ShadeState = 'sun' | 'building' | 'tree' | 'roof' | 'night' | 'cloud'
export interface ShadeTimeline {startMin: number; stepMin: number; states: ShadeState[]}

export type WeatherCondition = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'rain' | 'heavy-rain' | 'snow' | 'unknown'
export interface WeatherNow {
  temperatureC: number
  condition: WeatherCondition
  humidity: number | null
  precipitationProbability: number | null
  /** 風速（m/s） */
  windSpeed: number | null
  /** 日射（W/m²）。分からなければ null */
  solarRadiation: number | null
}
export interface WeatherHour extends WeatherNow {time: string}
export interface WeatherForecast {source: 'open-meteo' | 'google' | 'demo'; sourceLabel: string; fetchedAt: string; hours: WeatherHour[]}

/** 混みやすくなる催し（花火・イベントなど）。days が無ければ毎日 */
export interface AreaEvent {id: string; name: string; position: LatLng; radiusM: number; startMin: number; endMin: number; multiplier: number; days?: string[]}

/** facility = 設備が使えなかった（冷房が止まっていた・閉まっていた・トイレ使用不可など。RC-6）。空席の計算には使わない */
export type SeatReportValue = 'sat' | 'full' | 'missing' | 'facility'
export interface SeatReport {id: string; spotId: string; value: SeatReportValue; reportedAt: string; origin: 'local' | 'shared'; features?: SeatFeatureSnapshot}
/** 現地での日陰の答え合わせ。predicted は記録した時点のモデルの判定 */
export interface ShadeCheck {
  id: string
  spotId: string
  observed: 'shade' | 'sun'
  predicted: 'shade' | 'sun'
  checkedAt: string
}

/** 地点の通報（SHADE SPOT の「この投稿を通報」）。3 件集まった地点は一覧と地図に出さない */
export type SpotFlagReason = 'missing' | 'moved' | 'wrong-items' | 'spam'
export interface SpotFlag {
  id: string
  spotId: string
  reason: SpotFlagReason
  flaggedAt: string
}
export const FLAG_HIDE_COUNT = 3

/** 投稿したときの予測の入力。あとで「実際との差」から地点ごとの補正を学ぶ */
export interface SeatFeatureSnapshot {
  hour: number
  dayType: DayType
  temperatureC: number | null
  wbgt: number | null
  condition: WeatherCondition | null
  shade: ShadeState
  roof: boolean
  /** 投稿したときのルールだけの空席確率（過去投稿の補正を含まない）。過去投稿との差を学習に使う */
  aiProbability: number | null
}

export interface SeatFactor {
  key: 'time' | 'weather' | 'wet' | 'heat' | 'dark' | 'event' | 'location' | 'nearby' | 'seats'
  label: string
  /** 1 席が埋まっている見込み（ρ）に掛ける倍率 */
  multiplier: number
}
export type ConfidenceLevel = 'high' | 'mid' | 'low'

export interface SeatConfidence {
  level: ConfidenceLevel
  /** 80% のおおよその幅（combined のまわり） */
  low: number
  high: number
  /** 根拠の量を「観測何回分」に直した目安 */
  effectiveN: number
  /** 確からしさを下げた・上げた理由 */
  notes: string[]
}

export interface SeatPrediction {
  /** ルールだけの空席確率（過去の投稿による補正の前） */
  rule: number
  /** 過去の投稿（90 分より前）から学んだ補正。似た曜日・時間帯の投稿がなければ null */
  history: { offset: number; n: number } | null
  /** AI 予測（ルール＋過去投稿の補正。直近の投稿は含まない）の空席確率 0〜1 */
  ai: number
  /** 直近の投稿を混ぜた空席確率 0〜1。地図のピンの色と一覧に使う */
  combined: number
  /** 1 席が埋まっている見込み */
  occupancy: number
  /** 計算に使った席数（仮定を含む） */
  seats: {effective: number; assumed: boolean}
  factors: SeatFactor[]
  /** その地点の直近の投稿 */
  posts: {value: SeatReportValue; minutesAgo: number}[]
  /** combined に使った近くの地点（150m 以内）の直近の投稿の件数 */
  nearbyPosts: number
  confidence: SeatConfidence
  method: 'rule-v1'
}
