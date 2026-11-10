// 太陽の位置（SunCalc）。方位は北を 0° とした時計回り、高度は度
import {getPosition,getTimes} from 'suncalc'
import {jstDate} from './time.ts'
import type {LatLng,SunPosition} from './types.ts'
const deg=(r:number)=>r*180/Math.PI
export function sunPosition(t:Date,at:LatLng):SunPosition{const p=getPosition(t,at.lat,at.lng);return {altitude:deg(p.altitude),azimuth:((deg(p.azimuth)+180)%360+360)%360}}
/** 太陽が地平線より上か（大気の屈折を見込んで -0.833° で判定） */
export const isDaylight=(s:SunPosition)=>s.altitude>-.833
/** 方位（度）を 16 方位の日本語に */
export function directionLabel(azimuth:number){const names=['北','北北東','北東','東北東','東','東南東','南東','南南東','南','南南西','南西','西南西','西','西北西','北西','北北西'];return names[Math.round((((azimuth%360)+360)%360)/22.5)%16]}
/** その日の日の出・南中・日の入り（JST 0:00 からの分。起きない日は null） */
export function sunTimes(day:string,at:LatLng){const base=jstDate(day,0).getTime(),t=getTimes(new Date(base+12*3600_000),at.lat,at.lng),m=(d:Date|null)=>d&&Number.isFinite(d.getTime())?Math.round((d.getTime()-base)/60000):null;return {sunriseMin:m(t.sunrise),noonMin:m(t.solarNoon),sunsetMin:m(t.sunset)}}
