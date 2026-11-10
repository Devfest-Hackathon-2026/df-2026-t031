import {isShaded} from './shade.ts'
import {haversineM} from './geo.ts'
import type {ShadeCheck,ShadeState,ShadeTimeline,Spot} from './types.ts'

/**
 * 「着いたとき日陰で座れるベンチ」を選ぶ計算。いまではなく、歩いて着く時刻の日陰と空席で順位を付ける。
 * 寒い日（気温が PREFER_SHADE_FROM_C 未満）は逆に、着いたとき日なたの場所を上にする。
 */
/** 直線距離から道のりを見積もる係数（みなとみらいの歩道で、道のりは直線の 1.2〜1.4 倍ほど） */
export const DETOUR=1.3
/** この気温以上なら日陰を、未満なら日なたを優先する（℃） */
export const PREFER_SHADE_FROM_C=18
export const preferShadeFor=(temperatureC:number)=>temperatureC>=PREFER_SHADE_FROM_C
/** 休憩に向かうのに歩ける目安（分）。これより遠い候補は、近くに候補がないときだけ出す */
export const MAX_WALK_MIN=20
export const walkMinutesFor=(distanceM:number)=>Math.max(1,Math.round(distanceM/80))

export interface ArrivalPick{spot:Spot;walkMin:number;arriveMin:number;shade:ShadeState;seat:number;score:number}
interface RankOptions{departMin:number;preferShade:boolean;shadeAt:(spot:Spot,arriveMin:number)=>ShadeState;seatAt:(spot:Spot,arriveMin:number,shade:ShadeState)=>number;maxWalkMin?:number}

/** 日陰（または日なた）の合い具合。夜は日陰の差がないので一定 */
export function fitOf(shade:ShadeState,preferShade:boolean){if(shade==='night')return .85;return preferShade?(isShaded(shade)?1:.55):(shade==='sun'?1:.7)}

export function rankArrival(items:{spot:Spot;distanceM:number}[],o:RankOptions):ArrivalPick[]{
 const all=items.map(({spot,distanceM})=>{const walkMin=walkMinutesFor(distanceM*DETOUR),arriveMin=Math.min(1439,o.departMin+walkMin),shade=o.shadeAt(spot,arriveMin),seat=o.seatAt(spot,arriveMin,shade)
  return {spot,walkMin,arriveMin,shade,seat,score:seat*fitOf(shade,o.preferShade)-walkMin*.015}}).sort((a,b)=>b.score-a.score)
 const near=all.filter(p=>p.walkMin<=(o.maxWalkMin??MAX_WALK_MIN))
 return near.length?near:all
}

/** 着く時刻に日陰なら、その日陰がいつまで続くか。日なたなら、次に日陰になる時刻 */
export function shadeSpan(tl:ShadeTimeline,atMin:number):{shaded:boolean;untilMin:number|null;nextShadeMin:number|null;untilDark?:boolean}{
 const i=Math.floor((atMin-tl.startMin)/tl.stepMin),at=(k:number)=>tl.startMin+k*tl.stepMin
 if(i<0||i>=tl.states.length)return {shaded:false,untilMin:null,nextShadeMin:null}
 if(isShaded(tl.states[i])){let k=i;while(k<tl.states.length&&isShaded(tl.states[k]))k++;return {shaded:true,untilMin:at(k),nextShadeMin:null,...(tl.states[k]==='night'?{untilDark:true}:{})}}
 let k=i;while(k<tl.states.length&&!isShaded(tl.states[k]))k++;return {shaded:false,untilMin:null,nextShadeMin:k<tl.states.length?at(k):null}
}

/** カードに出す理由の一言（APIなしで作る。Gemini は詳細の中で任意） */
export function arrivalReason(p:{shade:ShadeState;preferShade:boolean;seat:number;walkMin:number}){
 const shade=p.shade==='building'?'着くころは建物の影':p.shade==='tree'?'着くころは木陰':p.shade==='roof'?'屋根の下':p.shade==='night'?'日没後':p.shade==='cloud'?'くもりで日差しなし':p.preferShade?'着くころは日なた（近くに日陰の候補が少ない）':'着くころは日なたで暖かい'
 const seat=p.seat>=.7?'空いている見込み':p.seat>=.4?'座れるかは五分五分':'混んでいる見込み'
 return `${shade}・${seat}・徒歩${p.walkMin}分`
}

/** 現地での答え合わせ（日陰だった／日なただった）と予測の一致率 */
export function hitRate(checks:ShadeCheck[]):{total:number;hits:number;ratio:number|null}{const hits=checks.filter(c=>c.observed===c.predicted).length;return {total:checks.length,hits,ratio:checks.length?hits/checks.length:null}}

/** 候補を散らす: 上位の候補から minM 未満の近さにある候補は同じ場所とみなして外す（同じ公園のベンチが並ばないように） */
export function spreadPicks(picks:ArrivalPick[],minM=80,limit=5):ArrivalPick[]{const out:ArrivalPick[]=[];for(const p of picks){if(out.some(q=>haversineM(q.spot.position,p.spot.position)<minM))continue;out.push(p);if(out.length>=limit)break}return out}
