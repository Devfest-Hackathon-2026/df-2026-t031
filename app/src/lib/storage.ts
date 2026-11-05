import type {SeatReport,Spot} from '../domain/types.ts'
import {inBounds} from '../domain/area.ts'
export interface SavedData {version:1;favorites:string[];reports:SeatReport[];spots:Spot[]}
export const EMPTY:SavedData={version:1,favorites:[],reports:[],spots:[]}
const KEY='epoku:v1'
export function validateSaved(v:unknown):SavedData{
 if(!v||typeof v!=='object')throw Error('epokuのバックアップではありません。')
 const x=v as SavedData
 if(x.version!==1||!Array.isArray(x.favorites)||!Array.isArray(x.reports)||!Array.isArray(x.spots)||x.spots.length>1000||x.reports.length>10000||x.favorites.length>2000)throw Error('バックアップの形式・件数を確認してください。')
 if(x.favorites.some(id=>typeof id!=='string'||id.length>150))throw Error('保存先の形式が不正です。')
 for(const r of x.reports)if(!r||typeof r.id!=='string'||r.id.length>150||typeof r.spotId!=='string'||r.spotId.length>150||!['sat','full','missing'].includes(r.value)||!Number.isFinite(Date.parse(r.reportedAt))||Date.parse(r.reportedAt)>Date.now()+60000||r.origin!=='local')throw Error('投稿データの形式が不正です。')
 for(const s of x.spots)if(!s||typeof s.id!=='string'||s.id.length>150||typeof s.name!=='string'||!s.name.trim()||s.name.length>80||!['bench','shelter','picnic','toilet','trash','water'].includes(s.kind)||!s.position||!Number.isFinite(s.position.lat)||!Number.isFinite(s.position.lng)||!inBounds(s.position)||!['yes','no','unknown'].includes(s.roof)||s.origin!=='user'||!(s.seats===null||Number.isInteger(s.seats)&&s.seats>0&&s.seats<=100))throw Error('地点データの形式が不正です。')
 return {version:1,favorites:[...new Set(x.favorites)],reports:x.reports.map(r=>({id:r.id,spotId:r.spotId,value:r.value,reportedAt:r.reportedAt,origin:'local'})),spots:x.spots.map(s=>({id:s.id,name:s.name,kind:s.kind,position:{...s.position},origin:'user',roof:s.roof,roofSource:'user',seats:s.seats,backrest:'unknown',wheelchair:'unknown'}))}
}
export function readSaved():{data:SavedData;error?:string}{try{const text=localStorage.getItem(KEY);return {data:text?validateSaved(JSON.parse(text)):structuredClone(EMPTY)}}catch{return {data:structuredClone(EMPTY),error:'保存データを読み取れませんでした。初期状態で表示しています。'}}}
export function persist(data:SavedData){try{localStorage.setItem(KEY,JSON.stringify(validateSaved(data)))}catch{throw Error('保存できませんでした。ブラウザーの保存設定や空き容量をご確認ください。')}}
export function exportSaved(data:SavedData){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='epoku-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
