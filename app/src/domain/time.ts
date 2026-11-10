import type { DayType } from './types.ts'

// 2026-11-10 期間内に書き直し。日時はすべて日本時間で扱い、端末のタイムゾーンに左右されないようにする。

const MS_PER_MIN = 60_000
const JST_SHIFT_MS = 9 * 60 * MS_PER_MIN
const MIN_PER_DAY = 24 * 60

export interface JstParts {
  year: number
  month: number
  day: number
  /** 曜日（0=日曜 … 6=土曜） */
  weekday: number
  hour: number
  minute: number
  /** その日の 0:00 からの分 */
  minutesOfDay: number
  /** "YYYY-MM-DD" */
  dateKey: string
}

const two = (n: number) => (n < 10 ? `0${n}` : `${n}`)

/** 日本時間に直した年月日・時分 */
export function jstParts(date: Date): JstParts {
  // UTC として読めば日本時間の値になるよう 9 時間ずらす
  const shifted = new Date(date.getTime() + JST_SHIFT_MS)
  const [year, month, day] = [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()]
  const [hour, minute] = [shifted.getUTCHours(), shifted.getUTCMinutes()]
  return {
    year,
    month,
    day,
    weekday: shifted.getUTCDay(),
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
    dateKey: [year, two(month), two(day)].join('-'),
  }
}

/** 日付キーの日本時間 0:00 から minutes 分たった時刻 */
export function jstDate(dateKey: string, minutes: number): Date {
  const [y, m, d] = dateKey.split('-').map((s) => Number.parseInt(s, 10))
  const midnightUtcMs = Date.UTC(y, m - 1, d)
  return new Date(midnightUtcMs - JST_SHIFT_MS + minutes * MS_PER_MIN)
}

/** 日付キーを days 日ずらす（正午基準なので月末・年末もずれない） */
export function addDays(dateKey: string, days: number): string {
  return jstParts(jstDate(dateKey, (days + 0.5) * MIN_PER_DAY)).dateKey
}

/** 0 時からの分を "H:MM" にする。24 時以降・負の値は 1 日の中に巻き戻す */
export function formatTime(minutesOfDay: number): string {
  let m = Math.round(minutesOfDay) % MIN_PER_DAY
  if (m < 0) m += MIN_PER_DAY
  return `${Math.floor(m / 60)}:${two(m % 60)}`
}

export function formatJst(date: Date): string {
  return formatTime(jstParts(date).minutesOfDay)
}

const WEEKDAYS = '日月火水木金土'

/** "11/10（火）" */
export function formatDateJa(dateKey: string): string {
  const { month, day, weekday } = jstParts(jstDate(dateKey, MIN_PER_DAY / 2))
  return `${month}/${day}（${WEEKDAYS[weekday]}）`
}

/**
 * 国民の祝日・振替休日・国民の休日（2026・2027 年）。
 * 出典は内閣府「国民の祝日について」。年が替わる前に追記すること。
 */
const HOLIDAYS_BY_YEAR: Record<number, string[]> = {
  2026: ['01-01', '01-12', '02-11', '02-23', '03-20', '04-29', '05-03', '05-04', '05-05', '05-06', '07-20', '08-11', '09-21', '09-22', '09-23', '10-12', '11-03', '11-23'],
  2027: ['01-01', '01-11', '02-11', '02-23', '03-21', '03-22', '04-29', '05-03', '05-04', '05-05', '07-19', '08-11', '09-20', '09-23', '10-11', '11-03', '11-23'],
}

export const HOLIDAYS: ReadonlySet<string> = new Set(
  Object.entries(HOLIDAYS_BY_YEAR).flatMap(([year, days]) => days.map((md) => `${year}-${md}`)),
)

/** 祝日 > 土日 > 平日 の順に判定 */
export function dayTypeOf(date: Date): DayType {
  const { dateKey, weekday } = jstParts(date)
  if (HOLIDAYS.has(dateKey)) return 'holiday'
  return weekday % 6 === 0 ? 'weekend' : 'weekday'
}

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  weekday: '平日',
  weekend: '土日',
  holiday: '祝日',
}

/** ISO 文字列の時刻から now までの経過分（未来なら 0） */
export function minutesAgo(iso: string, now: Date): number {
  const diff = Math.round((now.getTime() - Date.parse(iso)) / MS_PER_MIN)
  return diff > 0 ? diff : 0
}

/** "たった今" / "15分前" / "2時間" / "2時間5分前" */
export function formatAgo(min: number): string {
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const hours = Math.floor(min / 60)
  const rest = min - hours * 60
  return rest > 0 ? `${hours}時間${rest}分前` : `${hours}時間前`
}
