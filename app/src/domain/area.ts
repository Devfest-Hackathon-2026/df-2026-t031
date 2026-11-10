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
