import {addTime,getTimes,times as sunTimeRows} from 'suncalc'
// 3D の太陽の位置・1 日の軌道・時間帯。2026-11-10 に書き直し（期間中に足した部分はそのまま）
import {jstDate} from './time.ts'
import {sunPosition} from './sun.ts'
import type {LatLng,SunPosition} from './types.ts'
const rad=(d:number)=>d*Math.PI/180
/** 太陽の方向の点（three.js の座標: x=東、y=上、z=南）。radius は中心からの距離 */
export function solarVector(sun:SunPosition,radius=1){const a=rad(sun.altitude),z=rad(sun.azimuth),h=Math.cos(a)*radius;return {x:Math.sin(z)*h,y:Math.sin(a)*radius,z:-Math.cos(z)*h}}
export interface TrackPoint{minute:number;sun:SunPosition;point:{x:number;y:number;z:number}}
/** 日の出から日の入りまでの太陽の軌道（stepMin 分ごと。地平線より上の点だけ） */
export function solarTrack(day:string,at:LatLng,radius=1,stepMin=10):TrackPoint[]{const out:TrackPoint[]=[];for(let m=0;m<=1440;m+=stepMin){const sun=sunPosition(jstDate(day,m),at);if(sun.altitude>0)out.push({minute:m,sun,point:solarVector(sun,radius)})}return out}
/** 影の長さ ÷ 高さ（太陽が低いほど長い）。日没後は null */
export const shadowRatio=(altitude:number)=>altitude>0.5?1/Math.tan(rad(altitude)):null
// 青い時間と黄金時間の境目（太陽高度 -4°）。Sunlitt と同じく、-6°〜-4° を青い時間、-4°〜+6° を黄金時間とする
if(!sunTimeRows.some(([, rise])=>rise==='blueHourMorningEnd'))addTime(-4,'blueHourMorningEnd','blueHourEveningStart')
export interface SolarMoments{dawn:number|null;sunrise:number|null;goldenMorningEnd:number|null;noon:number;goldenEveningStart:number|null;sunset:number|null;dusk:number|null;blueMorningEnd:number|null;blueEveningStart:number|null;nadir:number;dayLength:number|null}
/** その日の時間帯の区切り（JST の 0:00 からの分。起きない日は null） */
export function solarMoments(day:string,at:LatLng):SolarMoments{
 const base=jstDate(day,0).getTime(),t=getTimes(new Date(base+12*3600_000),at.lat,at.lng) as unknown as Record<string,Date>
 const minute=(d:unknown)=>d instanceof Date&&Number.isFinite(d.getTime())?Math.round((d.getTime()-base)/60000):null
 const sunrise=minute(t.sunrise),sunset=minute(t.sunset),noon=minute(t.solarNoon)!
 return {dawn:minute(t.dawn),sunrise,goldenMorningEnd:minute(t.goldenHourEnd),noon,goldenEveningStart:minute(t.goldenHour),sunset,dusk:minute(t.dusk),blueMorningEnd:minute(t.blueHourMorningEnd),blueEveningStart:minute(t.blueHourEveningStart),nadir:noon+720,dayLength:sunrise!==null&&sunset!==null?sunset-sunrise:t.alwaysUp?1440:t.alwaysDown?0:null}
}

/** 指定時刻のあとに来る最初の太陽イベント（ボトムシートの「次は日没 16:38」用）。その日のイベントがすべて過ぎたら翌日の最初の光（概算）を返す */
export function nextSolarMoment(t:SolarMoments,minutes:number):{label:string;at:number;inMin:number}|null{
 const rows:[string,number|null][]=[['最初の光',t.dawn],['日の出',t.sunrise],['太陽南中',t.noon],['日没',t.sunset],['最後の光',t.dusk]]
 const next=rows.find(([,at])=>at!==null&&at>minutes)??(t.dawn!==null?['最初の光',t.dawn+1440] as [string,number]:null)
 return next&&next[1]!==null?{label:next[0],at:next[1],inMin:next[1]-minutes}:null
}
