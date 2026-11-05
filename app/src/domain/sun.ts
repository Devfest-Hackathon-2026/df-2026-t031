import { getPosition, getTimes } from 'suncalc'
import type { LatLng, SunPosition } from './types.ts'
import { jstDate } from './time.ts'

/**
 * 太陽の位置。SunCalc v2 は「度・北から時計回り」（v1 は「ラジアン・南起点」なので注意）。
 */
export function sunPosition(time: Date, at: LatLng): SunPosition {
  const p = getPosition(time, at.lat, at.lng)
  return { altitude: p.altitude, azimuth: ((p.azimuth % 360) + 360) % 360 }
}

export interface SunTimesJst {
  /** JST の 0 時からの分。日が昇らない日は null */
  sunriseMin: number | null
  sunsetMin: number | null
  solarNoonMin: number
}

export function sunTimes(dateKey: string, at: LatLng): SunTimesJst {
  const t = getTimes(jstDate(dateKey, 12 * 60), at.lat, at.lng, 0, 9 * 60)
  const base = jstDate(dateKey, 0).getTime()
  const toMin = (d: Date | null) => (d ? Math.round((d.getTime() - base) / 60_000) : null)
  return { sunriseMin: toMin(t.sunrise), sunsetMin: toMin(t.sunset), solarNoonMin: toMin(t.solarNoon)! }
}

/** 方位を「北」「南東」などの言葉にする */
export function directionLabel(azimuth: number): string {
  const names = ['北', '北東', '東', '南東', '南', '南西', '西', '北西']
  return names[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8]
}
