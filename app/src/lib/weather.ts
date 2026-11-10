// 2026-11-10 期間内に書き直し。
// 天気の取得と表示用ラベル。
//   openMeteo()     ブラウザーから Open-Meteo を直接呼ぶ（キー不要、7 日分）
//   googleWeather() 自前 API（/api/weather）経由で Google Weather を呼ぶ
//   demoWeather()   予報が無いときの手動デモ

import type { WeatherCondition, WeatherForecast, WeatherHour } from '../domain/types.ts'
import { jstDate } from '../domain/time.ts'
import { apiUrl } from './api.ts'

const HOUR_MS = 3_600_000

export const WEATHER_LABEL: Record<WeatherCondition, string> = {
  clear: '晴れ',
  'partly-cloudy': '晴れ時々くもり',
  cloudy: 'くもり',
  fog: '霧',
  rain: '雨',
  'heavy-rain': '強い雨',
  snow: '雪',
  unknown: '不明',
}

/** 手動デモの 1 時間分。湿度・風は平均的な値で固定し、雨のときだけ降水確率を上げる */
export function demoWeather(day: string, minutes: number, temp = 24, condition: WeatherCondition = 'clear'): WeatherHour {
  return {
    time: jstDate(day, minutes).toISOString(),
    condition,
    temperatureC: temp,
    humidity: 60,
    precipitationProbability: condition === 'rain' ? 90 : 10,
    solarRadiation: null,
    windSpeed: 2,
  }
}

/** time を含む 1 時間の予報。範囲外なら null */
export function weatherAt(forecast: WeatherForecast | null, time: Date): WeatherHour | null {
  if (!forecast) return null
  const t = time.getTime()
  for (const hour of forecast.hours) {
    const start = Date.parse(hour.time)
    if (start <= t && t < start + HOUR_MS) return hour
  }
  return null
}

/* ── Open-Meteo ─────────────────────────────── */

/** WMO の天気コードをアプリの区分にまとめる */
function fromWmoCode(code: number): WeatherCondition {
  if (code === 0) return 'clear'
  if (code <= 2) return 'partly-cloudy'
  if (code === 3) return 'cloudy'
  if (code <= 48) return 'fog'
  if (code >= 71 && code <= 77) return 'snow'
  if (code >= 95) return 'heavy-rain'
  return 'rain'
}

const OPEN_METEO_URL = (() => {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.search = new URLSearchParams({
    latitude: '35.45765',
    longitude: '139.6356',
    hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m,shortwave_radiation',
    wind_speed_unit: 'ms',
    timezone: 'Asia/Tokyo',
    forecast_days: '7',
  }).toString()
  return url.toString()
})()

export async function openMeteo(): Promise<WeatherForecast> {
  const res = await fetch(OPEN_METEO_URL, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error('天気を取得できませんでした。手動デモを引き続き使えます。')

  const hourly = (await res.json())?.hourly
  const columnsOk = Array.isArray(hourly?.time) && Array.isArray(hourly.temperature_2m) && Array.isArray(hourly.weather_code)
  if (!columnsOk) throw new Error('天気データの形式が不正です。')

  // 列ごとの配列を 1 時間ずつの行にする。気温か天気コードが欠けた時間は飛ばす
  const pick = (column: unknown, i: number): number | null => (Array.isArray(column) ? column[i] ?? null : null)
  const hours: WeatherHour[] = []
  hourly.time.forEach((localTime: string, i: number) => {
    const temperature = hourly.temperature_2m[i]
    const code = hourly.weather_code[i]
    if (!Number.isFinite(temperature) || !Number.isFinite(code)) return
    hours.push({
      // Open-Meteo は日本時間の "2026-11-10T13:00" 形式で返す
      time: new Date(`${localTime}+09:00`).toISOString(),
      condition: fromWmoCode(code),
      temperatureC: temperature,
      humidity: pick(hourly.relative_humidity_2m, i),
      precipitationProbability: pick(hourly.precipitation_probability, i),
      solarRadiation: pick(hourly.shortwave_radiation, i),
      windSpeed: pick(hourly.wind_speed_10m, i),
    })
  })
  if (hours.length === 0) throw new Error('有効な天気データがありません。')
  return { hours, sourceLabel: 'Open-Meteo', isDemo: false, fetchedAt: new Date().toISOString() }
}

/* ── Google Weather（サーバー経由） ─────────── */

export async function googleWeather(): Promise<WeatherForecast> {
  const res = await fetch(apiUrl('/api/weather'), { signal: AbortSignal.timeout(20_000) })
  // API サーバーが無い環境では index.html などが返るので、JSON かどうかで見分ける
  if (!res.headers.get('content-type')?.includes('application/json')) throw new Error('Weather APIサーバーは未接続です。')
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error || '天気の取得に失敗しました。')
  return body as WeatherForecast
}
