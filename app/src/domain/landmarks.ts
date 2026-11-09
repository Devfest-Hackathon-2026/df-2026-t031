import type {LatLng} from './types.ts'

/**
 * 3D 地図で名前の札を出す目印の建物。位置は同梱 OSM データの外形の中心、高さは OSM の height タグ
 * （PLATEAU で置き換わる建物は PLATEAU 2024 の高さ）。label は札に出す短い名前。
 */
export interface Landmark{label:string;position:LatLng;height:number;rank:1|2}
export const LANDMARKS:Landmark[]=[
 {label:'ランドマークタワー',position:{lat:35.454578,lng:139.631422},height:296,rank:1},
 {label:'コスモクロック21',position:{lat:35.455365,lng:139.636756},height:113,rank:1},
 {label:'赤レンガ倉庫',position:{lat:35.452144,lng:139.643324},height:20,rank:1},
 {label:'クイーンズスクエア',position:{lat:35.455835,lng:139.633146},height:177,rank:1},
 {label:'インターコンチネンタル',position:{lat:35.457611,lng:139.637427},height:144,rank:1},
 {label:'日本丸',position:{lat:35.45374,lng:139.632317},height:40,rank:1},
 {label:'桜木町駅',position:{lat:35.451238,lng:139.630749},height:15,rank:1},
 {label:'パシフィコ横浜',position:{lat:35.461718,lng:139.633956},height:37,rank:2},
 {label:'横浜美術館',position:{lat:35.457022,lng:139.630585},height:45,rank:2},
 {label:'MARK IS',position:{lat:35.457918,lng:139.631735},height:42,rank:2},
 {label:'ぴあアリーナMM',position:{lat:35.455737,lng:139.628408},height:51,rank:2},
 {label:'ザ・タワー横浜北仲',position:{lat:35.451257,lng:139.635908},height:212,rank:2},
 {label:'横浜アイランドタワー',position:{lat:35.450098,lng:139.635542},height:119,rank:2},
 {label:'ワールドポーターズ',position:{lat:35.453768,lng:139.63901},height:21,rank:2},
 {label:'カップヌードルミュージアム',position:{lat:35.455516,lng:139.638768},height:17,rank:2},
]
/** 観覧車（コスモクロック21）として形を作り直す建物の名前。外形の箱は作らない */
export const FERRIS_WHEEL_NAME='コスモクロック21'
