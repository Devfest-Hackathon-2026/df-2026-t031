import type { WeatherCondition, WeatherHour } from './types.ts'

/**
 * 暑さ指数（WBGT）の推定。
 * 気温・湿度・日射量・風速からの簡易推定式（小野・登内 2014 の式とされるもの。係数は実装前に原典で要確認）：
 *   WBGT = 0.735·Ta + 0.0374·RH + 0.00292·Ta·RH + 7.619·SR − 4.557·SR² − 0.0572·WS − 4.064
 *   Ta: 気温[℃] RH: 相対湿度[%] SR: 日射量[kW/m²] WS: 風速[m/s]
 * 公式の予測値・実況値は環境省「熱中症予防情報サイト」の電子情報提供サービス（申し込み制）で得られる。
 */
export function wbgtFormula(ta: number, rh: number, srKw: number, ws: number): number {
  return 0.735 * ta + 0.0374 * rh + 0.00292 * ta * rh + 7.619 * srKw - 4.557 * srKw * srKw - 0.0572 * ws - 4.064
}

const CLOUD_FACTOR: Record<WeatherCondition, number> = {
  clear: 1,
  'partly-cloudy': 0.7,
  cloudy: 0.35,
  fog: 0.3,
  rain: 0.2,
  'heavy-rain': 0.1,
  snow: 0.2,
  unknown: 0.6,
}

/** 日射量（kW/m²）の目安。天気と太陽の高度から */
export function estimateSolarKw(condition: WeatherCondition, sunAltitudeDeg: number): number {
  if (sunAltitudeDeg <= 0) return 0
  return 1.05 * Math.sin((sunAltitudeDeg * Math.PI) / 180) * CLOUD_FACTOR[condition]
}

/** 日なたの暑さ指数の推定値 */
export function estimateWbgt(w: WeatherHour, sunAltitudeDeg: number): number {
  const sr = w.solarRadiation !== null ? Math.max(0, w.solarRadiation) / 1000 : estimateSolarKw(w.condition, sunAltitudeDeg)
  const v = wbgtFormula(w.temperatureC, w.humidity ?? 60, Math.min(1.2, sr), w.windSpeed ?? 2)
  return Math.round(v * 10) / 10
}

export type WbgtLevel = 'danger' | 'severe' | 'warning' | 'caution' | 'safe'

/** 日本生気象学会の指針の区分 */
export function wbgtLevel(v: number): WbgtLevel {
  if (v >= 31) return 'danger'
  if (v >= 28) return 'severe'
  if (v >= 25) return 'warning'
  if (v >= 21) return 'caution'
  return 'safe'
}

export const WBGT_LABEL: Record<WbgtLevel, string> = {
  danger: '危険',
  severe: '厳重警戒',
  warning: '警戒',
  caution: '注意',
  safe: 'ほぼ安全',
}
