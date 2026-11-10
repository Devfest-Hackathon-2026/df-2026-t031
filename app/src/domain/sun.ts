// 太陽の位置（SunCalc）。方位は北を 0° とした時計回り、高度は度
import {getPosition} from 'suncalc'
import type {LatLng,SunPosition} from './types.ts'
const deg=(r:number)=>r*180/Math.PI
export function sunPosition(t:Date,at:LatLng):SunPosition{const p=getPosition(t,at.lat,at.lng);return {altitude:deg(p.altitude),azimuth:((deg(p.azimuth)+180)%360+360)%360}}
/** 太陽が地平線より上か（大気の屈折を見込んで -0.833° で判定） */
export const isDaylight=(s:SunPosition)=>s.altitude>-.833
