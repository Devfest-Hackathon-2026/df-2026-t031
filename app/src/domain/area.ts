// デモエリア（横浜・みなとみらい）の基準点と範囲
import type {LatLng} from './types.ts'
/** 地図と計算の原点（みなとみらい中心部）。PLATEAU の切り出し（public/data/plateau-nishi.json の origin）と同じ点にそろえる */
export const AREA_CENTER:LatLng={lat:35.45765,lng:139.6356}
/** 位置情報が使えないときに「現在地」とみなす場所（桜木町駅前） */
export const DEMO_USER_LOCATION:LatLng={lat:35.4509,lng:139.6311}
/** 地点データを取る範囲（南, 西, 北, 東） */
export const AREA_BOUNDS={south:35.4440,west:139.6180,north:35.4700,east:139.6460}
export const AREA_NAME='横浜・みなとみらい'
export const inArea=(p:LatLng,b=AREA_BOUNDS)=>p.lat>=b.south&&p.lat<=b.north&&p.lng>=b.west&&p.lng<=b.east
/** 投稿できる範囲（デモエリアの少し外まで） */
export const inBounds=(p:{lat:number;lng:number})=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&inArea(p,{south:AREA_BOUNDS.south-.01,west:AREA_BOUNDS.west-.01,north:AREA_BOUNDS.north+.01,east:AREA_BOUNDS.east+.01})
/** 最初に表示する場所（臨港パーク〜グランモール公園のあたり）。最初に選ぶベンチもここに近いものにする */
export const EXPLORER_FOCUS={lat:35.4585,lng:139.6345}
