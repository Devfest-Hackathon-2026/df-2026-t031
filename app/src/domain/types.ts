/**
 * アプリ全体で使う型。ここは Node（server/・scripts/）からも読むので、型以外のものは置かない。
 */

export interface LatLng {
  lat: number
  lng: number
}

export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

/** エリア中心からの距離（m）。x=東、y=北 */
export interface XY {
  x: number
  y: number
}

// ───────── 地点 ─────────

/** 地点の種類。bench / shelter / picnic は「座れる場所」 */
export type SpotKind = 'bench' | 'shelter' | 'picnic' | 'toilet' | 'trash' | 'water'

export type TriState = 'yes' | 'no' | 'unknown'

/**
 * データの出どころ。
 * - osm: OpenStreetMap（同梱スナップショット or ライブ取得）
 * - places: Google Places API（Google の地図で表示するときだけ使う）
 * - user: この端末で利用者が登録した
 * - shared: 共有データベース（Firestore）で他の利用者が登録した
 */
export type SpotOrigin = 'osm' | 'places' | 'user' | 'shared'

export type RoofSource = 'tag' | 'roof-polygon' | 'inside-building' | 'kind' | 'user'

export interface Spot {
  id: string
  kind: SpotKind
  /** 名前（OSM の多くのベンチには名前がない） */
  name: string | null
  position: LatLng
  origin: SpotOrigin
  /** 席数。null は不明 */
  seats: number | null
  roof: TriState
  roofSource: RoofSource | null
  backrest: TriState
  wheelchair: 'yes' | 'limited' | 'no' | 'unknown'
  /** ゴミ箱の補足（ペットボトル回収など） */
  note?: string
  /** 元データへの参照（"node/123" など） */
  ref?: string
  photoId?: string
  description?: string
  createdAt?: string
  ownerUid?: string
}

/** 建物（または建物の一部・屋根だけの構造物）。高さの根拠を必ず持つ */
export interface Building {
  id: string
  kind: 'building' | 'part' | 'roof'
  footprint: LatLng[]
  /** 上端の高さ（m） */
  height: number
  /** 下端の高さ（m）。地面から立っていれば 0 */
  minHeight: number
  /** measured=高さタグ / levels=階数から推定 / assumed=仮定値 */
  heightSource: 'measured' | 'levels' | 'assumed' | 'plateau'
  name?: string
}

export interface Tree {
  id: string
  position: LatLng
  height: number
  crownRadius: number
  heightSource: 'measured' | 'assumed'
}

/** 人を集める場所（駅・観光地・商業施設・公園）。空席確率の「人通り」に使う */
export interface Attractor {
  id: string
  kind: 'station' | 'tourism' | 'mall' | 'park'
  name: string | null
  position: LatLng
}

export interface ParkArea {
  id: string
  name: string | null
  ring: LatLng[]
}

export interface AreaDataset {
  spots: Spot[]
  buildings: Building[]
  trees: Tree[]
  attractors: Attractor[]
  parks: ParkArea[]
  meta: {
    /** 画面に出す取得元の説明 */
    sourceLabel: string
    attribution: string
    /** データの基準時刻（ISO） */
    asOf: string | null
    live: boolean
    plateauBuildings?: number
  }
}

// ───────── 天気 ─────────

export type WeatherCondition = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'rain' | 'heavy-rain' | 'snow' | 'unknown'

export interface WeatherHour {
  /** その時間帯の開始時刻（ISO） */
  time: string
  condition: WeatherCondition
  temperatureC: number
  humidity: number | null
  precipitationProbability: number | null
  /** 日射量（W/m²）。暑さ指数の推定に使う */
  solarRadiation: number | null
  windSpeed: number | null
}

export interface WeatherForecast {
  hours: WeatherHour[]
  sourceLabel: string
  isDemo: boolean
  fetchedAt: string
}

// ───────── イベント ─────────

export interface AreaEvent {
  id: string
  name: string
  position: LatLng
  /** 0=日〜6=土。dates があればそちらを優先 */
  daysOfWeek: number[]
  /** "2026-11-08" など。指定日だけ開催 */
  dates: string[]
  startMin: number
  endMin: number
  radiusM: number
  /** 混雑への影響（0〜1.5 程度） */
  intensity: number
  isDemo: boolean
}

// ───────── 日陰 ─────────

export interface SunPosition {
  /** 高度（度）。負なら地平線の下 */
  altitude: number
  /** 方位（度・北から時計回り） */
  azimuth: number
}

/** sun=日なた / building=建物の影 / tree=木陰（推定） / roof=屋根の下 / night=日が出ていない */
export type ShadeState = 'sun' | 'building' | 'tree' | 'roof' | 'night'

export interface ShadeTimeline {
  spotId: string
  dateKey: string
  /** 最初の時刻（JST の 0 時からの分） */
  startMin: number
  stepMin: number
  states: ShadeState[]
}

// ───────── 投稿 ─────────

/** sat=座れた / full=満席だった / missing=見当たらなかった */
export type SeatReportValue = 'sat' | 'full' | 'missing'

/** 現地での日陰の答え合わせ。predicted は記録した時点のモデルの判定 */
export interface ShadeCheck {
  id: string
  spotId: string
  observed: 'shade' | 'sun'
  predicted: 'shade' | 'sun'
  checkedAt: string
}

export interface SeatReport {
  id: string
  spotId: string
  value: SeatReportValue
  reportedAt: string
  /** local=この端末 / shared=共有データベース / demo=デモ投稿（実際の投稿ではない） */
  origin: 'local' | 'shared' | 'demo'
  /** 投稿したときの予測の入力（あとで係数を学習するためのデータ） */
  features?: SeatFeatureSnapshot
  ownerUid?: string
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

// ───────── 空席確率 ─────────

export type DayType = 'weekday' | 'weekend' | 'holiday'

export interface SeatFactor {
  key: 'time' | 'weather' | 'wet' | 'heat' | 'dark' | 'event' | 'location' | 'nearby' | 'seats'
  label: string
  /** 混み具合への倍率（1 より大きいと混みやすい）。席数の行は 1 */
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
  spotId: string
  /** ルールだけの空席確率（過去の投稿による補正の前） */
  rule: number
  /** 過去の投稿（90 分より前）から学んだ補正。似た曜日・時間帯の投稿がなければ null */
  history: { offset: number; n: number } | null
  /** AI 予測（ルール＋過去投稿の補正。直近の投稿は含まない）の空席確率 0〜1 */
  ai: number
  /** 1 席あたりの埋まりやすさ 0〜1 */
  occupancy: number
  effectiveSeats: number
  seatsAssumed: boolean
  factors: SeatFactor[]
  /** 直近の投稿（新しい順・90 分以内） */
  posts: { value: SeatReportValue; minutesAgo: number; origin: SeatReport['origin'] }[]
  /** 投稿で補正した値。投稿がなければ ai と同じ */
  combined: number
  /** combined に使った近くの地点（150m 以内）の直近の投稿の件数 */
  nearbyPosts: number
  confidence: SeatConfidence
  method: 'rule-v1'
}
