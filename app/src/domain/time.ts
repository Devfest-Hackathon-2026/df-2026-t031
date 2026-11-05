import type { DayType } from './types.ts'

/**
 * 時刻はすべて日本時間（JST, UTC+9）で扱う。端末のタイムゾーンが違っても結果が変わらないようにする。
 */
const JST_OFFSET_MIN = 9 * 60

export interface JstParts {
  year: number
  month: number
  day: number
  /** 0=日〜6=土 */
  weekday: number
  hour: number
  minute: number
  minutesOfDay: number
  dateKey: string
}

const pad = (n: number) => String(n).padStart(2, '0')

export function jstParts(d: Date): JstParts {
  const t = new Date(d.getTime() + JST_OFFSET_MIN * 60_000)
  const year = t.getUTCFullYear()
  const month = t.getUTCMonth() + 1
  const day = t.getUTCDate()
  const hour = t.getUTCHours()
  const minute = t.getUTCMinutes()
  return {
    year,
    month,
    day,
    weekday: t.getUTCDay(),
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
  }
}

/** "2026-11-04" の JST の minutes 分後の時刻 */
export function jstDate(dateKey: string, minutes: number): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 0, 0) - JST_OFFSET_MIN * 60_000 + minutes * 60_000)
}

export function addDays(dateKey: string, days: number): string {
  return jstParts(jstDate(dateKey, 12 * 60 + days * 24 * 60)).dateKey
}

export function formatTime(minutesOfDay: number): string {
  const m = ((Math.round(minutesOfDay) % 1440) + 1440) % 1440
  return `${Math.floor(m / 60)}:${pad(m % 60)}`
}

export function formatJst(d: Date): string {
  return formatTime(jstParts(d).minutesOfDay)
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']

export function formatDateJa(dateKey: string): string {
  const p = jstParts(jstDate(dateKey, 12 * 60))
  return `${p.month}/${p.day}（${WEEKDAY_JA[p.weekday]}）`
}

/**
 * 日本の祝日（2026〜2027 年）。振替休日・国民の休日を含む。
 * 法改正や閣議決定で変わることがあるため、年が変わったら内閣府の「国民の祝日について」で確認して更新する。
 */
export const HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29',
  '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11',
  '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  // 2027
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22',
  '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19', '2027-08-11',
  '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23',
])

export function dayTypeOf(d: Date): DayType {
  const p = jstParts(d)
  if (HOLIDAYS.has(p.dateKey)) return 'holiday'
  if (p.weekday === 0 || p.weekday === 6) return 'weekend'
  return 'weekday'
}

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  weekday: '平日',
  weekend: '土日',
  holiday: '祝日',
}

export function minutesAgo(iso: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000))
}

export function formatAgo(min: number): string {
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const h = Math.floor(min / 60)
  return `${h}時間${min % 60 ? `${min % 60}分` : ''}前`
}
