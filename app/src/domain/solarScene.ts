import { addTime, getTimes, times as suncalcTimes } from 'suncalc'
import { sunPosition } from './sun.ts'
import { jstDate } from './time.ts'
import type { LatLng, SunPosition } from './types.ts'

// 2026-11-10 期間内に書き直し。
// 3D 表示と「太陽」パネルで使う、太陽の位置・軌道・一日の節目の計算。

export interface SceneVector {
  x: number
  y: number
  z: number
}

const RAD = Math.PI / 180

/**
 * 太陽の方向を 3D シーンの座標にする。東が +X、上が +Y、北が -Z。
 * suncalc v2 の方位角は「北を 0 とする度」。
 */
export function solarVector(sun: SunPosition, radius = 1): SceneVector {
  const alt = sun.altitude * RAD
  const az = sun.azimuth * RAD
  const horizontal = Math.cos(alt) * radius
  return { x: Math.sin(az) * horizontal, y: Math.sin(alt) * radius, z: -Math.cos(az) * horizontal }
}

/** 10 分おきに 1 日分（0:00〜24:00 の 145 点）計算し、地平線より上の点だけ返す */
const TRACK_STEP_MIN = 10
const TRACK_POINTS = (24 * 60) / TRACK_STEP_MIN + 1

export function solarTrack(day: string, at: LatLng, radius = 145) {
  const track = []
  for (let k = 0; k < TRACK_POINTS; k++) {
    const minute = k * TRACK_STEP_MIN
    const sun = sunPosition(jstDate(day, minute), at)
    if (sun.altitude >= 0) track.push({ minute, sun, point: solarVector(sun, radius) })
  }
  return track
}

// 青い時間と黄金時間の境目として、太陽高度 -4° の時刻を suncalc に追加する。
// -6°〜-4° を青い時間、-4°〜+6° を黄金時間とする。モジュールを何度読んでも 1 回だけ登録する。
const BLUE_HOUR_EDGE = { angle: -4, rise: 'blueHourMorningEnd', set: 'blueHourEveningStart' } as const
if (!suncalcTimes.some(([, rise]) => rise === BLUE_HOUR_EDGE.rise)) {
  addTime(BLUE_HOUR_EDGE.angle, BLUE_HOUR_EDGE.rise, BLUE_HOUR_EDGE.set)
}

/** 一日の節目。値はすべて日本時間 0:00 からの分。その日に起きないものは null */
export interface SolarMoments {
  dawn: number | null
  sunrise: number | null
  goldenMorningEnd: number | null
  noon: number
  goldenEveningStart: number | null
  sunset: number | null
  dusk: number | null
  blueMorningEnd: number | null
  blueEveningStart: number | null
  nadir: number
  /** 昼の長さ（分）。白夜は 1440、極夜は 0 */
  dayLength: number | null
}

const MIN_PER_DAY = 1440

export function solarMoments(day: string, at: LatLng): SolarMoments {
  const midnight = jstDate(day, 0).getTime()
  const times = getTimes(jstDate(day, MIN_PER_DAY / 2), at.lat, at.lng, 0, 540) as unknown as Record<string, unknown>
  const at0 = (key: string): number | null => {
    const d = times[key]
    if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return null
    return Math.round((d.getTime() - midnight) / 60_000)
  }

  const sunrise = at0('sunrise')
  const sunset = at0('sunset')
  const noon = at0('solarNoon') as number

  let dayLength: number | null = null
  if (sunrise !== null && sunset !== null) dayLength = sunset - sunrise
  else if (times.alwaysUp) dayLength = MIN_PER_DAY
  else if (times.alwaysDown) dayLength = 0

  return {
    dawn: at0('dawn'),
    sunrise,
    goldenMorningEnd: at0('goldenHourEnd'),
    noon,
    goldenEveningStart: at0('goldenHour'),
    sunset,
    dusk: at0('dusk'),
    blueMorningEnd: at0(BLUE_HOUR_EDGE.rise),
    blueEveningStart: at0(BLUE_HOUR_EDGE.set),
    nadir: noon + MIN_PER_DAY / 2,
    dayLength,
  }
}

/** 高さ 1 m のものの影の長さ（m）。太陽が低すぎる（2° 以下）ときは null */
export function shadowRatio(altitude: number): number | null {
  return altitude > 2 ? 1 / Math.tan(altitude * RAD) : null
}

/**
 * minutes（日本時間 0:00 からの分）より後に来る最初の節目。「次は日没 16:38」の表示に使う。
 * その日の節目がすべて過ぎていたら、翌日の最初の光（今日の値 + 24 時間で概算）を返す。
 */
export function nextSolarMoment(t: SolarMoments, minutes: number): { label: string; at: number; inMin: number } | null {
  const upcoming: Array<[label: string, at: number | null]> = [
    ['最初の光', t.dawn],
    ['日の出', t.sunrise],
    ['太陽南中', t.noon],
    ['日没', t.sunset],
    ['最後の光', t.dusk],
  ]
  for (const [label, at] of upcoming) {
    if (at !== null && at > minutes) return { label, at, inMin: at - minutes }
  }
  if (t.dawn === null) return null
  const tomorrow = t.dawn + MIN_PER_DAY
  return { label: '最初の光', at: tomorrow, inMin: tomorrow - minutes }
}
