import { getPosition, getTimes } from 'suncalc'
import { jstDate } from './time.ts'
import type { LatLng, SunPosition } from './types.ts'

// 2026-11-10 期間内に書き直し。
// suncalc v2 の返り値は「度」「北を 0 として時計回り」の方位（v1 のラジアン・南起点とは違う）。

const normalizeDeg = (deg: number) => ((deg % 360) + 360) % 360

export function sunPosition(time: Date, at: LatLng): SunPosition {
  const { altitude, azimuth } = getPosition(time, at.lat, at.lng)
  return { altitude, azimuth: normalizeDeg(azimuth) }
}

export interface SunTimesJst {
  /** 日本時間 0:00 からの分。極夜・白夜などで起きない日は null */
  sunriseMin: number | null
  sunsetMin: number | null
  solarNoonMin: number
}

export function sunTimes(dateKey: string, at: LatLng): SunTimesJst {
  const midnight = jstDate(dateKey, 0).getTime()
  const noon = jstDate(dateKey, 720)
  const times = getTimes(noon, at.lat, at.lng, 0, 540)
  const sinceMidnight = (d: Date | null | undefined): number | null =>
    d ? Math.round((d.getTime() - midnight) / 60_000) : null
  return {
    sunriseMin: sinceMidnight(times.sunrise),
    sunsetMin: sinceMidnight(times.sunset),
    solarNoonMin: sinceMidnight(times.solarNoon) ?? 720,
  }
}

const COMPASS_8 = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'] as const

/** 方位角（度）を 8 方位の言葉にする */
export function directionLabel(azimuth: number): string {
  const sector = Math.floor((normalizeDeg(azimuth) + 22.5) / 45) % 8
  return COMPASS_8[sector]
}
