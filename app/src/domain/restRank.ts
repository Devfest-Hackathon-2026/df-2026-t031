import {isShaded} from './shade.ts'
import {reachableMeters,type RestNeed,type RestWish,WISH_LABEL} from './restNeed.ts'
import type {SeatReportValue,ShadeState,Spot} from './types.ts'

/**
 * 休憩候補の順位付け（RC-3）と理由（RC-4）。ルールベースの純粋関数で、同じ入力なら必ず同じ順位になる。
 * Gemini には順位を作らせない。重みは REST_RANK_MODEL の 1 か所にまとめる（現地での試用後に調整）。
 *
 * 理由の状態（RC-4）:
 *  confirmed = データで確かめられる（OSM のタグ・現地確認） / report = 利用者の投稿（未検証）
 *  estimated = 計算した予測（日陰・空席） / unknown = 情報がない（未確認。「利用可能」と断定しない）
 */
export type ReasonStatus='confirmed'|'report'|'estimated'|'unknown'
export interface RestReason{key:string;label:string;status:ReasonStatus;ok:boolean|null}
export const STATUS_LABEL:Record<ReasonStatus,string>={confirmed:'確認済み',report:'投稿',estimated:'推定',unknown:'未確認'}

/** 順位付けに使う 1 地点分の材料（着く時刻の日陰・空席は arrival.ts で計算済みのもの） */
export interface RestItem{spot:Spot;walkMin:number;arriveMin:number;shade:ShadeState;seat:number;toiletM:number;waterM:number;reports:{value:SeatReportValue;minutesAgo:number}[]}
export interface RankContext{wbgt:number;cold:boolean}
export interface RankedRest{item:RestItem;score:number;reasons:RestReason[];mustUnknown:boolean}

export const REST_RANK_MODEL={
 /** 疲れ具合ごとに歩ける上限（分）。休める時間で行き来できる距離も上限にする */
 walkCap:{slight:15,heavy:8,limit:5} as Record<RestNeed['fatigue'],number>,
 /** 徒歩 1 分ごとの減点。疲れているほど遠い候補を強く減らす */
 walkPenalty:{slight:.012,heavy:.03,limit:.06} as Record<RestNeed['fatigue'],number>,
 seat:1,
 /** 「できれば」の希望を満たしたとき／未確認のとき */
 wishMet:.3,wishUnknown:.06,
 /** 「必須」の希望が未確認のときの減点（除外はしない） */
 mustUnknown:.35,
 /** 暑いとき（暑さ指数 25 以上）の日陰・冷房の加点、日なたの減点 */
 hotWbgt:25,hotShade:.2,hotSun:.2,
 /** 寒い日は日なたを少し加点 */
 coldSun:.1,
 /** 24 時間以内の「設備が使えなかった」投稿、1 時間以内の「座れた」投稿 */
 facility:.6,recentSat:.08,
 /** 歩数・活動時間が多い日は、近さの減点を強める（疲れや体調の判定には使わない） */
 activeSteps:10000,activeMinutes:90,activeFactor:1.3,
 /** 「トイレ近く」「給水」の距離（m） */
 nearM:150,
}
const M=REST_RANK_MODEL

const sourceStatus=(s:Spot):ReasonStatus=>s.origin==='user'?'report':'confirmed'
/** 希望 1 つについて、その場所が合うか（ok=null は分からない） */
export function wishReason(w:RestWish,it:RestItem):RestReason{
 const s=it.spot,src=sourceStatus(s),label=WISH_LABEL[w],shaded=isShaded(it.shade)
 switch(w){
  case 'cool':return s.kind==='indoor'||s.cooling==='yes'?{key:w,label:'冷房・屋内あり',status:s.verifiedAt?'confirmed':src,ok:true}:s.cooling==='no'?{key:w,label:'冷房なし',status:src,ok:false}:shaded?{key:w,label:'日陰で涼しめ（冷房は未確認）',status:'estimated',ok:true}:{key:w,label:'涼しい場所かは未確認',status:'unknown',ok:null}
  case 'shade':return it.shade==='night'?{key:w,label:'日没後',status:'estimated',ok:true}:{key:w,label:it.shade==='cloud'?'くもりで日差しなし':shaded?'着く時は日陰':'着く時は日なた',status:'estimated',ok:shaded}
  case 'roof':return s.roof==='yes'?{key:w,label:'屋根あり',status:s.roofSource==='inside-building'||s.roofSource==='roof-polygon'?'estimated':src,ok:true}:s.roof==='no'?{key:w,label:'屋根なし',status:src,ok:false}:{key:w,label:'屋根は未確認',status:'unknown',ok:null}
  case 'seat':return {key:w,label:`座れる見込み ${Math.round(it.seat*100)}%`,status:'estimated',ok:it.seat>=.5}
  case 'backrest':return s.backrest==='yes'?{key:w,label:'背もたれあり',status:src,ok:true}:s.backrest==='no'?{key:w,label:'背もたれなし',status:src,ok:false}:{key:w,label:'背もたれは未確認',status:'unknown',ok:null}
  case 'toilet':return Number.isFinite(it.toiletM)&&it.toiletM<=M.nearM?{key:w,label:`トイレまで ${Math.round(it.toiletM/10)*10}m`,status:'confirmed',ok:true}:{key:w,label:'近くにトイレなし',status:'confirmed',ok:false}
  case 'water':return Number.isFinite(it.waterM)&&it.waterM<=M.nearM?{key:w,label:`給水まで ${Math.round(it.waterM/10)*10}m`,status:'confirmed',ok:true}:{key:w,label:'近くに給水なし',status:'confirmed',ok:false}
  case 'barrierFree':{const sf=s.stepFree??(s.wheelchair==='yes'?'yes':s.wheelchair==='no'?'no':'unknown')
   return sf==='yes'?{key:w,label:'段差なし',status:src,ok:true}:sf==='no'?{key:w,label:'段差あり',status:src,ok:false}:{key:w,label:s.wheelchair==='limited'?'段差は一部のみ対応':'段差なしかは未確認',status:'unknown',ok:null}}
 }
 return {key:w,label,status:'unknown',ok:null}
}

/** 1 地点分の理由（徒歩・着く時の日陰・空席・希望・投稿）。表示用で、順位の点数と同じ材料を使う */
export function restReasons(it:RestItem,need:RestNeed):RestReason[]{
 const out:RestReason[]=[{key:'walk',label:`徒歩 ${it.walkMin}分`,status:'estimated',ok:null}]
 if(!need.wishes.includes('shade'))out.push(wishReason('shade',it))
 if(!need.wishes.includes('seat')&&it.spot.kind!=='indoor')out.push(wishReason('seat',it))
 for(const w of need.wishes)out.push({...wishReason(w,it),...(need.must?.includes(w)?{key:w+':must'}:{})})
 const fac=it.reports.find(r=>r.value==='facility'&&r.minutesAgo<=1440),sat=it.reports.find(r=>r.value==='sat'&&r.minutesAgo<=60)
 if(fac)out.push({key:'facility',label:`設備が使えなかった（${ago(fac.minutesAgo)}）`,status:'report',ok:false})
 else if(sat)out.push({key:'sat',label:`座れた（${ago(sat.minutesAgo)}）`,status:'report',ok:true})
 return out
}
const ago=(m:number)=>m<1?'たった今':m<60?`${m}分前`:`${Math.floor(m/60)}時間前`

/** 疲れ具合と休める時間から、歩いてよい上限（分） */
export function walkLimit(need:RestNeed){return Math.min(M.walkCap[need.fatigue],Math.max(1,Math.floor(reachableMeters(need.available)/80)))}

export function rankRestSpots(items:RestItem[],need:RestNeed,ctx:RankContext):RankedRest[]{
 const limit=walkLimit(need),active=(need.steps?.value??0)>=M.activeSteps||(need.activeMinutes?.value??0)>=M.activeMinutes
 const per=M.walkPenalty[need.fatigue]*(active?M.activeFactor:1),hot=ctx.wbgt>=M.hotWbgt,must=new Set(need.must??[])
 const ranked=items.map(it=>{
  const wishes=need.wishes.map(w=>({w,r:wishReason(w,it)}))
  // 必須の希望を満たさないことがはっきりしている地点は外す。未確認なら残して下げる
  if(wishes.some(x=>must.has(x.w)&&x.r.ok===false))return null
  const mustUnknown=wishes.some(x=>must.has(x.w)&&x.r.ok===null)
  let score=(it.spot.kind==='indoor'?.7:it.seat)*M.seat-it.walkMin*per
  for(const x of wishes)score+=x.r.ok===true?M.wishMet:x.r.ok===null?(must.has(x.w)?-M.mustUnknown:M.wishUnknown):0
  const shaded=isShaded(it.shade)||it.spot.kind==='indoor'||it.spot.cooling==='yes'
  if(hot&&it.shade!=='night')score+=shaded?M.hotShade:-M.hotSun
  if(ctx.cold&&it.shade==='sun')score+=M.coldSun
  if(it.reports.some(r=>r.value==='facility'&&r.minutesAgo<=1440))score-=M.facility
  else if(it.reports.some(r=>r.value==='sat'&&r.minutesAgo<=60))score+=M.recentSat
  return {item:it,score:Math.round(score*1000)/1000,reasons:restReasons(it,need),mustUnknown}
 }).filter((x):x is RankedRest=>!!x)
 const sort=(a:RankedRest,b:RankedRest)=>b.score-a.score||a.item.walkMin-b.item.walkMin||(a.item.spot.id<b.item.spot.id?-1:1)
 const within=ranked.filter(r=>r.item.walkMin<=limit)
 // 上限の中に候補がなければ、近い順の候補を出す（何も出さないよりよい）
 return (within.length?within:[...ranked].sort((a,b)=>a.item.walkMin-b.item.walkMin)).sort(sort)
}
