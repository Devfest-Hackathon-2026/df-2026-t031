// 日本時間（JST, UTC+9）の日付と時刻。端末のタイムゾーンに左右されないように UTC から計算する
import type {DayType} from './types.ts'
const JST=9*3600_000
/** "2026-11-10" の JST 0:00 から minutes 分後の時刻 */
export function jstDate(day:string,minutes:number){const [y,m,d]=day.split('-').map(Number);return new Date(Date.UTC(y,m-1,d)-JST+Math.round(minutes*60_000))}
/** JST の年月日・時分・曜日など */
export function jstParts(t:Date){const j=new Date(t.getTime()+JST),year=j.getUTCFullYear(),month=j.getUTCMonth()+1,date=j.getUTCDate(),hour=j.getUTCHours(),minute=j.getUTCMinutes()
 return {year,month,date,hour,minute,weekday:j.getUTCDay(),dateKey:`${year}-${String(month).padStart(2,'0')}-${String(date).padStart(2,'0')}`,minutesOfDay:hour*60+minute+j.getUTCSeconds()/60}}
/** 日本の祝日（2026年・2027年の主なもの）。振替休日を含む */
export const HOLIDAYS:ReadonlySet<string>=new Set(['2026-01-01','2026-01-12','2026-02-11','2026-02-23','2026-03-20','2026-04-29','2026-05-04','2026-05-05','2026-05-06','2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23','2026-10-12','2026-11-03','2026-11-23','2027-01-01','2027-01-11','2027-02-11','2027-02-23','2027-03-21','2027-03-22','2027-04-29','2027-05-03','2027-05-04','2027-05-05'])
export function dayTypeOf(t:Date):DayType{const p=jstParts(t);return HOLIDAYS.has(p.dateKey)?'holiday':p.weekday===0||p.weekday===6?'weekend':'weekday'}
/** 分を "9:05" の形に（24時以降は折り返す） */
export function formatTime(minutes:number){const m=((Math.round(minutes)%1440)+1440)%1440;return `${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`}
const WEEK='日月火水木金土'
/** "2026-11-10" を「11月10日（火）」に */
export function formatDateJa(day:string){const [y,m,d]=day.split('-').map(Number),w=new Date(Date.UTC(y,m-1,d)).getUTCDay();return `${m}月${d}日（${WEEK[w]}）`}
/** 今日の JST の日付キー */
export const todayKey=(now=new Date())=>jstParts(now).dateKey
