import {addTime,getTimes,times as sunTimeRows} from 'suncalc'
import {sunPosition} from './sun.ts'
import {jstDate} from './time.ts'
import type {LatLng,SunPosition} from './types.ts'
export interface SceneVector{x:number;y:number;z:number}
/** World coordinates: east +X, up +Y, north -Z. SunCalc v2 uses degrees from north. */
export function solarVector(sun:SunPosition,radius=1):SceneVector{
 const altitude=sun.altitude*Math.PI/180,azimuth=sun.azimuth*Math.PI/180
 return {x:Math.sin(azimuth)*Math.cos(altitude)*radius,y:Math.sin(altitude)*radius,z:-Math.cos(azimuth)*Math.cos(altitude)*radius}
}
export function solarTrack(day:string,at:LatLng,radius=145){return Array.from({length:145},(_,i)=>{const minute=i*10,sun=sunPosition(jstDate(day,minute),at);return {minute,sun,point:solarVector(sun,radius)}}).filter(p=>p.sun.altitude>=0)}
// 青い時間と黄金時間の境目（太陽高度 -4°）。Sunlitt と同じく、-6°〜-4° を青い時間、-4°〜+6° を黄金時間とする
if(!sunTimeRows.some(([, rise])=>rise==='blueHourMorningEnd'))addTime(-4,'blueHourMorningEnd','blueHourEveningStart')
export interface SolarMoments{dawn:number|null;sunrise:number|null;goldenMorningEnd:number|null;noon:number;goldenEveningStart:number|null;sunset:number|null;dusk:number|null;blueMorningEnd:number|null;blueEveningStart:number|null;nadir:number;dayLength:number|null}
export function solarMoments(day:string,at:LatLng):SolarMoments{
 const t=getTimes(jstDate(day,720),at.lat,at.lng,0,540),base=jstDate(day,0).getTime()
 const minute=(d:unknown)=>d instanceof Date&&Number.isFinite(d.getTime())?Math.round((d.getTime()-base)/60000):null
 const sunrise=minute(t.sunrise),sunset=minute(t.sunset),noon=minute(t.solarNoon)!
 return {dawn:minute(t.dawn),sunrise,goldenMorningEnd:minute(t.goldenHourEnd),noon,goldenEveningStart:minute(t.goldenHour),sunset,dusk:minute(t.dusk),blueMorningEnd:minute(t.blueHourMorningEnd),blueEveningStart:minute(t.blueHourEveningStart),nadir:noon+720,dayLength:sunrise!==null&&sunset!==null?sunset-sunrise:t.alwaysUp?1440:t.alwaysDown?0:null}
}
export function shadowRatio(altitude:number){return altitude>2?1/Math.tan(altitude*Math.PI/180):null}
/** 指定時刻のあとに来る最初の太陽イベント（ボトムシートの「次は日没 16:38」用）。その日のイベントがすべて過ぎたら翌日の最初の光（概算）を返す */
export function nextSolarMoment(t:SolarMoments,minutes:number):{label:string;at:number;inMin:number}|null{
 const rows:[string,number|null][]=[['最初の光',t.dawn],['日の出',t.sunrise],['太陽南中',t.noon],['日没',t.sunset],['最後の光',t.dusk]]
 const next=rows.find(([,at])=>at!==null&&at>minutes)??(t.dawn!==null?['最初の光',t.dawn+1440] as [string,number]:null)
 return next&&next[1]!==null?{label:next[0],at:next[1],inMin:next[1]-minutes}:null
}
