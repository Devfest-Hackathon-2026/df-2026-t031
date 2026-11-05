import {haversineM} from './geo.ts'
import {isSeatSpot} from './seat.ts'
import type {Spot} from './types.ts'
export const SEAT_FILTER_MIN=.7
export const TOILET_NEAR_M=200
export function nearestToiletDistance(spot:Spot,toilets:Spot[]):number{
 let nearest=Infinity
 for(const toilet of toilets)if(toilet.kind==='toilet')nearest=Math.min(nearest,haversineM(spot.position,toilet.position))
 return nearest
}
export function matchesSeatFilter(spot:Spot,probability:number|null){return isSeatSpot(spot)&&probability!==null&&probability>=SEAT_FILTER_MIN}
