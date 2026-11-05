import {getTimes} from 'suncalc'
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
export interface SolarMoments{dawn:number|null;sunrise:number|null;goldenMorningEnd:number|null;noon:number;goldenEveningStart:number|null;sunset:number|null;dusk:number|null}
export function solarMoments(day:string,at:LatLng):SolarMoments{
 const t=getTimes(jstDate(day,720),at.lat,at.lng,0,540),base=jstDate(day,0).getTime()
 const minute=(d:Date|null)=>d&&Number.isFinite(d.getTime())?Math.round((d.getTime()-base)/60000):null
 return {dawn:minute(t.dawn),sunrise:minute(t.sunrise),goldenMorningEnd:minute(t.goldenHourEnd),noon:minute(t.solarNoon)!,goldenEveningStart:minute(t.goldenHour),sunset:minute(t.sunset),dusk:minute(t.dusk)}
}
export function shadowRatio(altitude:number){return altitude>2?1/Math.tan(altitude*Math.PI/180):null}
