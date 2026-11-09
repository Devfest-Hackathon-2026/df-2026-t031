import type {BannerState,RestWish} from '../domain/restNeed.ts'
import {WISHES,SNOOZE_MINUTES} from '../domain/restNeed.ts'

/** 休憩まわりの端末内設定。健康データの値は保存しない（11.2）。validateSaved とは別のキーにする */
const KEY='epoku:rest:v1'
export interface RestPrefs{lastWishes:RestWish[];bannerDisabled:boolean;snoozedUntil:number|null;healthConsent:boolean;log:{at:number;action:'accept'|'snooze'|'disable'}[]}
const EMPTY:RestPrefs={lastWishes:[],bannerDisabled:false,snoozedUntil:null,healthConsent:false,log:[]}

export function loadRestPrefs():RestPrefs{
 try{const raw=JSON.parse(localStorage.getItem(KEY)||'null');if(!raw||typeof raw!=='object')return {...EMPTY}
  return {lastWishes:Array.isArray(raw.lastWishes)?raw.lastWishes.filter((w:unknown)=>WISHES.includes(w as RestWish)):[],bannerDisabled:raw.bannerDisabled===true,snoozedUntil:typeof raw.snoozedUntil==='number'?raw.snoozedUntil:null,healthConsent:raw.healthConsent===true,log:Array.isArray(raw.log)?raw.log.filter((l:any)=>l&&typeof l.at==='number'&&['accept','snooze','disable'].includes(l.action)).slice(-50):[]}
 }catch{return {...EMPTY}}
}
export function saveRestPrefs(p:RestPrefs){try{localStorage.setItem(KEY,JSON.stringify({...p,log:p.log.slice(-50)}))}catch{/* 保存できなくても動かす */}}
export const bannerState=(p:RestPrefs):BannerState=>({disabled:p.bannerDisabled,snoozedUntil:p.snoozedUntil})
export const snooze=(p:RestPrefs,now:number):RestPrefs=>({...p,snoozedUntil:now+SNOOZE_MINUTES*60_000,log:[...p.log,{at:now,action:'snooze'}]})
