import type { WeatherCondition, WeatherHour } from './types.ts'

// 2026-11-10 期間内に書き直し。
// 暑さ指数（WBGT）を天気の値から推定する。公式の予報値は環境省「熱中症予防情報サイト」（申込制）で得られる。

/**
 * 気象値からの WBGT 推定式（小野・登内 2014 とされる式。係数は原典で要確認）。
 * @param ta 気温 [℃]
 * @param rh 相対湿度 [%]
 * @param sr 日射量 [kW/m²]
 * @param ws 風速 [m/s]
 */
export function wbgtFormula(ta: number, rh: number, sr: number, ws: number): number {
  const temp = 0.735 * ta
  const humid = 0.0374 * rh + 0.00292 * ta * rh
  const solar = 7.619 * sr - 4.557 * sr ** 2
  const wind = -0.0572 * ws
  return temp + humid + solar + wind - 4.064
}

/** 雲や雨で日射がどれだけ残るか（晴れ=1） */
const SUNLIGHT_SHARE: Record<WeatherCondition, number> = {
  clear: 1,
  'partly-cloudy': 0.7,
  cloudy: 0.35,
  fog: 0.3,
  rain: 0.2,
  'heavy-rain': 0.1,
  snow: 0.2,
  unknown: 0.6,
}

/** 晴天時の地表日射のおおよその上限（kW/m²） */
const CLEAR_SKY_KW = 1.05
const MAX_SOLAR_KW = 1.2

/** 天気と太陽高度（度）から日射量（kW/m²）を見積もる。夜は 0 */
export function estimateSolarKw(condition: WeatherCondition, sunAltitudeDeg: number): number {
  if (!(sunAltitudeDeg > 0)) return 0
  return CLEAR_SKY_KW * SUNLIGHT_SHARE[condition] * Math.sin((sunAltitudeDeg / 180) * Math.PI)
}

/** 日なたでの WBGT 推定値（小数 1 桁）。湿度・風速が無ければ 60% / 2 m/s とみなす */
export function estimateWbgt(w: WeatherHour, sunAltitudeDeg: number): number {
  const measuredKw = w.solarRadiation === null ? null : Math.max(w.solarRadiation, 0) / 1000
  const sr = Math.min(MAX_SOLAR_KW, measuredKw ?? estimateSolarKw(w.condition, sunAltitudeDeg))
  const value = wbgtFormula(w.temperatureC, w.humidity ?? 60, sr, w.windSpeed ?? 2)
  return Math.round(value * 10) / 10
}

export type WbgtLevel = 'danger' | 'severe' | 'warning' | 'caution' | 'safe'

/** 日本生気象学会「日常生活に関する指針」の区分（下限値の高い順） */
const LEVEL_FLOORS: ReadonlyArray<[number, WbgtLevel]> = [
  [31, 'danger'],
  [28, 'severe'],
  [25, 'warning'],
  [21, 'caution'],
]

export function wbgtLevel(v: number): WbgtLevel {
  return LEVEL_FLOORS.find(([floor]) => v >= floor)?.[1] ?? 'safe'
}

export const WBGT_LABEL: Record<WbgtLevel, string> = {
  danger: '危険',
  severe: '厳重警戒',
  warning: '警戒',
  caution: '注意',
  safe: 'ほぼ安全',
}
