import type {SeatReport,ShadeCheck,Spot,SpotFlag} from '../domain/types.ts'
import {inBounds} from '../domain/area.ts'
export interface SavedData {version:1;favorites:string[];reports:SeatReport[];spots:Spot[];flags:SpotFlag[];checks:ShadeCheck[]}
export const EMPTY:SavedData={version:1,favorites:[],reports:[],spots:[],flags:[],checks:[]}
const FLAG_REASONS=['missing','moved','wrong-items','spam']
const optionalText=(v:unknown,max:number)=>v===undefined||typeof v==='string'&&v.length<=max
const KEY='epoku:v1'
export function validateSaved(v:unknown):SavedData{
 if(!v||typeof v!=='object')throw Error('epokuのバックアップではありません。')
 const x=v as SavedData
 if(x.version!==1||!Array.isArray(x.favorites)||!Array.isArray(x.reports)||!Array.isArray(x.spots)||x.spots.length>1000||x.reports.length>10000||x.favorites.length>2000)throw Error('バックアップの形式・件数を確認してください。')
 if(x.favorites.some(id=>typeof id!=='string'||id.length>150))throw Error('保存先の形式が不正です。')
 for(const r of x.reports)if(!r||typeof r.id!=='string'||r.id.length>150||typeof r.spotId!=='string'||r.spotId.length>150||!['sat','full','missing'].includes(r.value)||!Number.isFinite(Date.parse(r.reportedAt))||Date.parse(r.reportedAt)>Date.now()+60000||r.origin!=='local')throw Error('投稿データの形式が不正です。')
 for(const s of x.spots)if(!s||typeof s.id!=='string'||s.id.length>150||typeof s.name!=='string'||!s.name.trim()||s.name.length>80||!['bench','shelter','picnic','toilet','trash','water'].includes(s.kind)||!s.position||!Number.isFinite(s.position.lat)||!Number.isFinite(s.position.lng)||!inBounds(s.position)||!['yes','no','unknown'].includes(s.roof)||s.origin!=='user'||!(s.seats===null||Number.isInteger(s.seats)&&s.seats>0&&s.seats<=100)||!optionalText(s.note,160)||!optionalText(s.description,300)||!(s.createdAt===undefined||Number.isFinite(Date.parse(s.createdAt))))throw Error('地点データの形式が不正です。')
 const flags=x.flags===undefined?[]:x.flags
 if(!Array.isArray(flags)||flags.length>5000)throw Error('通報データの形式・件数を確認してください。')
 for(const f of flags)if(!f||typeof f.id!=='string'||f.id.length>150||typeof f.spotId!=='string'||f.spotId.length>150||!FLAG_REASONS.includes(f.reason)||!Number.isFinite(Date.parse(f.flaggedAt)))throw Error('通報データの形式が不正です。')
 // 答え合わせ（checks）は後から追加した項目。古いバックアップには無いので空として読む
 const checks=x.checks===undefined?[]:x.checks
 if(!Array.isArray(checks)||checks.length>5000)throw Error('答え合わせデータの形式・件数を確認してください。')
 for(const c of checks)if(!c||typeof c.id!=='string'||c.id.length>150||typeof c.spotId!=='string'||c.spotId.length>150||!['shade','sun'].includes(c.observed)||!['shade','sun'].includes(c.predicted)||!Number.isFinite(Date.parse(c.checkedAt)))throw Error('答え合わせデータの形式が不正です。')
 return {version:1,checks:checks.map(c=>({id:c.id,spotId:c.spotId,observed:c.observed,predicted:c.predicted,checkedAt:c.checkedAt})),favorites:[...new Set(x.favorites)],reports:x.reports.map(r=>({id:r.id,spotId:r.spotId,value:r.value,reportedAt:r.reportedAt,origin:'local'})),spots:x.spots.map(s=>({id:s.id,name:s.name,kind:s.kind,position:{...s.position},origin:'user',roof:s.roof,roofSource:'user',seats:s.seats,backrest:'unknown',wheelchair:'unknown',...(s.note?{note:s.note}:{}),...(s.description?{description:s.description}:{}),...(s.createdAt?{createdAt:s.createdAt}:{})})),flags:flags.map(f=>({id:f.id,spotId:f.spotId,reason:f.reason,flaggedAt:f.flaggedAt}))}
}
export function readSaved():{data:SavedData;error?:string}{try{const text=localStorage.getItem(KEY);return {data:text?validateSaved(JSON.parse(text)):structuredClone(EMPTY)}}catch{return {data:structuredClone(EMPTY),error:'保存データを読み取れませんでした。初期状態で表示しています。'}}}
export function persist(data:SavedData){try{localStorage.setItem(KEY,JSON.stringify(validateSaved(data)))}catch{throw Error('保存できませんでした。ブラウザーの保存設定や空き容量をご確認ください。')}}
export function exportSaved(data:SavedData){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='epoku-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
