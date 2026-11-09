import {isShaded} from './shade.ts'
import {wbgtLevel,WBGT_LABEL} from './wbgt.ts'
import type {ShadeState,Spot} from './types.ts'

/**
 * 「いまの状態」（Rest Care 企画書の①入力）と、それに合わせた候補の絞り込み・休憩のきっかけ。
 * 値はすべて本人の手入力（Google Health 未接続）。医療診断・熱中症の危険度判定はしない。
 */
export type Fatigue='ok'|'tired'|'very'
export type Want='shade'|'roof'|'backrest'|'toilet'|'stepFree'
export interface CareState{fatigue:Fatigue;walkedMin:number;wants:Want[]}
export const DEFAULT_CARE:CareState={fatigue:'tired',walkedMin:30,wants:['shade']}
export const FATIGUE_LABEL:Record<Fatigue,string>={ok:'元気',tired:'少し疲れた',very:'かなり疲れた'}
export const WANT_LABEL:Record<Want,string>={shade:'日陰',roof:'屋根',backrest:'背もたれ',toilet:'トイレ近く',stepFree:'段差なし'}
export const WALKED_OPTIONS=[0,15,30,60,90]
/** 「トイレ近く」の距離（m） */
const TOILET_M=150

/** 疲れているほど、歩く上限を短くする（メニューの「歩ける時間」より長くはしない） */
export function maxWalkFor(fatigue:Fatigue,base:number){return fatigue==='very'?Math.min(base,8):fatigue==='tired'?Math.min(base,15):base}

/** 希望ごとに、その場所が合うか。情報がないもの（背もたれ・段差の不明）は「合う」にしない */
export function wantMatches(spot:Spot,shade:ShadeState,toiletM:number,wants:Want[]):{want:Want;ok:boolean}[]{
 return wants.map(want=>({want,ok:want==='shade'?isShaded(shade)||shade==='night':want==='roof'?spot.roof==='yes':want==='backrest'?spot.backrest==='yes':want==='toilet'?toiletM<=TOILET_M:spot.wheelchair==='yes'}))
}
/** 希望に合う数だけ順位を上げる（合わない場所も消さずに下に回す） */
export function careBonus(matches:{ok:boolean}[]){return matches.filter(m=>m.ok).length*.25}

/**
 * 休憩のきっかけ（企画書 012・013 の簡易版。アプリ内の表示だけで、通知はしない）。
 * 歩いた時間・暑さ指数（推定）・本人の疲れ具合から、休憩をすすめる一言を返す。すすめないときは null。
 */
export function restNudge(c:{walkedMin:number;wbgt:number;fatigue:Fatigue}):{level:'info'|'warn';text:string}|null{
 const lv=wbgtLevel(c.wbgt),label=WBGT_LABEL[lv]
 if(c.fatigue==='very')return {level:'warn',text:'かなり疲れているときは、近くで座って休みましょう。体調がすぐれないときは無理をせず、周りの人に声をかけてください。'}
 if((lv==='danger'||lv==='severe')&&c.walkedMin>=15)return {level:'warn',text:`暑さ指数 ${Math.round(c.wbgt)}（${label}の目安）で ${c.walkedMin}分歩いています。日陰で休みませんか？`}
 if(lv==='warning'&&c.walkedMin>=30)return {level:'info',text:`暑さ指数 ${Math.round(c.wbgt)}（${label}の目安）で ${c.walkedMin}分歩いています。そろそろ休憩しませんか？`}
 if(c.walkedMin>=60)return {level:'info',text:`${c.walkedMin}分歩いています。少し座って休みませんか？`}
 if(c.fatigue==='tired'&&c.walkedMin>=30)return {level:'info',text:'少し疲れているようです。近くの座れる場所で休みませんか？'}
 return null
}
