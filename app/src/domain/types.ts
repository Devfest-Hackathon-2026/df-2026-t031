// 2026-11-10 期間内に書き直し。
// アプリ・サーバー（server/）・スクリプト（scripts/）で共有するデータの形。
// Node からも読み込むので、型のほかは定数 1 つ（FLAG_HIDE_COUNT）だけを置く。

/* ── 位置と範囲 ─────────────────────────────── */

export interface LatLng { lat: number; lng: number }

/** 南西端と北東端の緯度経度 */
export interface Bounds { south: number; west: number; north: number; east: number }

/** エリア中心を原点にした平面座標（m）。x は東向き、y は北向き */
export interface XY { x: number; y: number }

/* ── 休憩スポット ───────────────────────────── */

/** 座れるのは bench・shelter・picnic の 3 種類 */
export type SpotKind = 'bench' | 'shelter' | 'picnic' | 'toilet' | 'trash' | 'water' | 'indoor'

/** はい・いいえ・わからない */
export type TriState = 'yes' | 'no' | 'unknown'

/** osm=OpenStreetMap、places=Google Places（Google 地図表示時のみ）、user=この端末で登録、shared=Firestore の共有登録 */
export type SpotOrigin = 'osm' | 'places' | 'user' | 'shared'

/** 屋根があると判断した根拠 */
export type RoofSource = 'tag' | 'roof-polygon' | 'inside-building' | 'kind' | 'user'

export interface Spot {
  id: string
  kind: SpotKind
  /** 名前のないベンチが多いので null を許す */
  name: string | null
  position: LatLng
  origin: SpotOrigin
  /** 席の数。わからなければ null */
  seats: number | null
  roof: TriState
  roofSource: RoofSource | null
  backrest: TriState
  wheelchair: 'yes' | 'limited' | 'no' | 'unknown'
  // RC-0 の設備情報。値がなければ「未確認」と表示する
  cooling?: TriState
  stepFree?: TriState
  accessibleToilet?: TriState
  /** 情報源と、現地で確かめた日時（RC-0・RC-4） */
  infoSource?: 'osm' | 'field-check' | 'official' | 'user'
  verifiedAt?: string
  /** ペットボトル回収などの補足 */
  note?: string
  /** 元データの参照。例 "node/123" */
  ref?: string
  photoId?: string
  description?: string
  createdAt?: string
  ownerUid?: string
}

/* ── 影を落とすもの ─────────────────────────── */

/** 建物・建物の一部・屋根だけの構造物 */
export interface Building {
  id: string
  kind: 'building' | 'part' | 'roof'
  footprint: LatLng[]
  /** 地面から上端まで（m） */
  height: number
  /** 地面から下端まで（m）。地面に接していれば 0 */
  minHeight: number
  /** 高さの根拠。measured=高さの記載、levels=階数から換算、plateau=PLATEAU、assumed=既定値 */
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

/** 人の流れを生む場所。空席確率の「人通り」の計算に使う */
export interface Attractor {
  id: string
  kind: 'station' | 'tourism' | 'mall' | 'park'
  name: string | null
  position: LatLng
}

export interface ParkArea { id: string; name: string | null; ring: LatLng[] }

/** 1 つのエリアについて読み込んだデータ一式 */
export interface AreaDataset {
  spots: Spot[]
  buildings: Building[]
  trees: Tree[]
  attractors: Attractor[]
  parks: ParkArea[]
  meta: {
    /** 画面に表示するデータ元の説明 */
    sourceLabel: string
    attribution: string
    /** いつ時点のデータか（ISO 8601） */
    asOf: string | null
    live: boolean
    plateauBuildings?: number
  }
}

/* ── 天気 ───────────────────────────────────── */

export type WeatherCondition = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'rain' | 'heavy-rain' | 'snow' | 'unknown'

/** 1 時間ぶんの予報 */
export interface WeatherHour {
  /** 1 時間の始まり（ISO 8601） */
  time: string
  condition: WeatherCondition
  temperatureC: number
  humidity: number | null
  precipitationProbability: number | null
  /** 日射（W/m²）。WBGT の推定に使う */
  solarRadiation: number | null
  windSpeed: number | null
}

export interface WeatherForecast { hours: WeatherHour[]; sourceLabel: string; isDemo: boolean; fetchedAt: string }

/* ── 催し ───────────────────────────────────── */

export interface AreaEvent {
  id: string
  name: string
  position: LatLng
  /** 開催する曜日（日曜 0〜土曜 6）。dates が空でないときは dates を使う */
  daysOfWeek: number[]
  /** 開催日（例 "2026-11-08"） */
  dates: string[]
  startMin: number
  endMin: number
  radiusM: number
  /** 人出への効き具合。おおむね 0〜1.5 */
  intensity: number
  isDemo: boolean
}

/* ── 日なたと日陰 ───────────────────────────── */

export interface SunPosition {
  /** 太陽高度（度）。マイナスは日没後 */
  altitude: number
  /** 方位角（度）。北を 0 とし時計回り */
  azimuth: number
}

/**
 * sun=日なた、building=建物の陰、tree=木陰（推定）、roof=屋根の下、night=日の出前・日没後、
 * cloud=曇りや雨で日が差していない（街じゅう日陰と同じ扱い）
 */
export type ShadeState = 'sun' | 'building' | 'tree' | 'roof' | 'night' | 'cloud'

/** 1 地点の 1 日分の日陰の移り変わり */
export interface ShadeTimeline {
  spotId: string
  dateKey: string
  /** 先頭の時刻（日本時間 0:00 からの分） */
  startMin: number
  stepMin: number
  states: ShadeState[]
}

/* ── 利用者の投稿 ───────────────────────────── */

/**
 * sat=座れた、full=空いていなかった、missing=見つからなかった、
 * facility=設備が使えなかった（冷房停止・閉鎖・トイレ使用不可など。RC-6）。facility は空席の計算に入れない
 */
export type SeatReportValue = 'sat' | 'full' | 'missing' | 'facility'

/** 日陰予測の現地での答え合わせ。predicted は記録時点の予測 */
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
  /** local=この端末、shared=Firestore、demo=見本の投稿 */
  origin: 'local' | 'shared' | 'demo'
  /** 投稿時点の予測の入力。後で係数を合わせるために残す */
  features?: SeatFeatureSnapshot
  ownerUid?: string
}

/** スポットへの通報の理由 */
export type SpotFlagReason = 'missing' | 'moved' | 'wrong-items' | 'spam'

export interface SpotFlag { id: string; spotId: string; reason: SpotFlagReason; flaggedAt: string }

/** この件数の通報が集まったスポットは一覧と地図から隠す */
export const FLAG_HIDE_COUNT = 3

/** 投稿した瞬間の予測の入力値 */
export interface SeatFeatureSnapshot {
  hour: number
  dayType: DayType
  temperatureC: number | null
  wbgt: number | null
  condition: WeatherCondition | null
  shade: ShadeState
  roof: boolean
  /** その時点のルールのみの空席確率（過去投稿の補正なし）。過去投稿とのずれを学ぶのに使う */
  aiProbability: number | null
}

/* ── 空席確率 ───────────────────────────────── */

export type DayType = 'weekday' | 'weekend' | 'holiday'

/** 空席確率を動かした要因 1 つ */
export interface SeatFactor {
  key: 'time' | 'weather' | 'wet' | 'heat' | 'dark' | 'event' | 'location' | 'nearby' | 'seats'
  label: string
  /** 混雑の倍率。1 を超えると混みやすい。席数の行は常に 1 */
  multiplier: number
}

export type ConfidenceLevel = 'high' | 'mid' | 'low'

export interface SeatConfidence {
  level: ConfidenceLevel
  /** combined を中心とした 80% のおおよその範囲 */
  low: number
  high: number
  /** 根拠の多さを観測回数に換算した値 */
  effectiveN: number
  /** 確からしさが上下した理由 */
  notes: string[]
}

export interface SeatPrediction {
  spotId: string
  /** 過去投稿で補正する前の、ルールだけの空席確率 */
  rule: number
  /** 90 分より前の投稿から求めた補正。似た曜日・時間帯の投稿がないと null */
  history: { offset: number; n: number } | null
  /** ルールと過去投稿の補正を合わせた空席確率（0〜1）。直近の投稿は入れない */
  ai: number
  /** 1 席が埋まっている度合い（0〜1） */
  occupancy: number
  effectiveSeats: number
  seatsAssumed: boolean
  factors: SeatFactor[]
  /** 90 分以内の投稿。新しいものから */
  posts: { value: SeatReportValue; minutesAgo: number; origin: SeatReport['origin'] }[]
  /** 直近の投稿を反映した値。投稿がなければ ai と等しい */
  combined: number
  /** combined の計算に入れた、150 m 以内のほかのスポットの直近投稿の数 */
  nearbyPosts: number
  confidence: SeatConfidence
  method: 'rule-v1'
}
