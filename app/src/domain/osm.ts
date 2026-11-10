// OpenStreetMap のデータ（scripts/fetch-osm.ts が作る軽量形式）をアプリのデータに変換する。2026-11-10 に書き直し
import {LocalProjection,pointInRing} from './geo.ts'
import type {AreaDataset,Attractor,Building,LatLng,Park,Spot,SpotKind,Tree,TriState,XY} from './types.ts'

/** 軽量形式。n = 点（lat/lng）、w = 線・面（g に座標の列） */
export interface SlimElement{t:'n'|'w';id:number;tags:Record<string,string>;lat?:number;lng?:number;g?:[number,number][]}
export interface SlimOsm{version:2;source:string;fetchedAt:string;osmBase:string|null;elements:SlimElement[]}

const tri=(v:string|undefined):TriState=>v==='yes'?'yes':v==='no'?'no':'unknown'
const num=(v:string|undefined)=>{if(!v)return null;const n=parseFloat(v.replace(',','.'));return Number.isFinite(n)?n:null}
const ringOf=(e:SlimElement):LatLng[]=>(e.g??[]).map(([lat,lng])=>({lat,lng}))
const centerOf=(e:SlimElement):LatLng|null=>{if(e.t==='n'&&e.lat!==undefined&&e.lng!==undefined)return {lat:e.lat,lng:e.lng};const g=e.g??[];if(!g.length)return null;return {lat:g.reduce((n,p)=>n+p[0],0)/g.length,lng:g.reduce((n,p)=>n+p[1],0)/g.length}}

function spotKind(t:Record<string,string>):SpotKind|null{
 if(t.leisure==='picnic_table')return 'picnic'
 switch(t.amenity){
  case 'bench':return t.indoor==='yes'?'indoor':'bench'
  case 'shelter':return 'shelter'
  case 'toilets':return 'toilet'
  case 'waste_basket':case 'recycling':case 'waste_disposal':return 'trash'
  case 'drinking_water':case 'water_point':return 'water'
  case 'library':case 'community_centre':case 'lounge':return 'indoor'
 }
 return null
}
/** 建物の高さ（m）と出どころ */
function heightOf(t:Record<string,string>):{height:number;min:number;source:Building['heightSource']}{
 const h=num(t.height),lv=num(t['building:levels']),min=num(t.min_height)??((num(t['building:min_level'])??0)*3.2)
 if(h!==null&&h>0)return {height:h,min,source:'measured'}
 if(lv!==null&&lv>0)return {height:lv*3.2+(t.roof?.includes('pitched')?1.5:0.6),min,source:'levels'}
 const b=t.building??t['building:part']
 return {height:b==='roof'?4:b==='house'||b==='detached'?7:b==='kiosk'||b==='hut'||b==='shed'?3.5:b==='train_station'?14:12,min:b==='roof'?Math.max(min,3):min,source:'assumed'}
}
function attractorOf(e:SlimElement,t:Record<string,string>,p:LatLng):Attractor|null{
 const name=t.name??t['name:ja']??''
 if(t.railway==='station'||t.public_transport==='station')return {id:'osm:'+e.id,name,position:p,weight:3,kind:'station'}
 if(t.shop==='mall'||t.shop==='department_store')return {id:'osm:'+e.id,name,position:p,weight:2,kind:'mall'}
 if(t.tourism)return {id:'osm:'+e.id,name,position:p,weight:t.tourism==='theme_park'?2.5:1.5,kind:'sight'}
 return null
}

/** OSM の軽量形式から、地点・建物・樹木・公園・人が集まる場所を作る */
export function parseOsm(raw:SlimOsm,opts:{origin:LatLng;live:boolean}):AreaDataset{
 const proj=new LocalProjection(opts.origin),spots:Spot[]=[],buildings:Building[]=[],trees:Tree[]=[],parks:Park[]=[],attractors:Attractor[]=[]
  const s = { measured: 0, levels: 0, assumed: 0, plateau: 0 }
 for(const e of raw.elements??[]){
  const t=e.tags??{}
  if(e.t==='w'&&(t.building||t['building:part'])&&(e.g?.length??0)>=4){
   const h=heightOf(t);s[h.source]++
   buildings.push({id:'osm:'+e.id,kind:t.building==='roof'?'roof':'building',footprint:ringOf(e).slice(0,-1),height:h.height,minHeight:Math.min(h.min,h.height-.5),heightSource:h.source,...(t.name?{name:t.name}:{})})
   const p=centerOf(e);if(p){const a=attractorOf(e,t,p);if(a)attractors.push(a)}
   continue
  }
  if(t.natural==='tree'&&e.t==='n'&&e.lat!==undefined&&e.lng!==undefined){
   const h=num(t.height)??8,crown=num(t.diameter_crown)
   trees.push({id:'osm:'+e.id,position:{lat:e.lat,lng:e.lng},height:Math.min(30,Math.max(3,h)),crownRadius:crown?crown/2:Math.max(2,h*.35)})
   continue
  }
  if(t.natural==='tree_row'&&e.g&&e.g.length>=2){
   // 並木は 8m ごとに 1 本とみなす
   const pts=ringOf(e).map(p=>proj.toXY(p));let k=0
   for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],len=Math.hypot(b.x-a.x,b.y-a.y);for(let d=0;d<len;d+=8){const q={x:a.x+(b.x-a.x)*d/len,y:a.y+(b.y-a.y)*d/len};trees.push({id:`osm:${e.id}:${k++}`,position:proj.toLatLng(q),height:8,crownRadius:2.8})}}
   continue
  }
  if(e.t==='w'&&(t.leisure==='park'||t.leisure==='garden'||t.leisure==='playground'||t.landuse==='grass'||t.landuse==='recreation_ground'||t.landuse==='village_green')&&(e.g?.length??0)>=4){parks.push({id:'osm:'+e.id,ring:ringOf(e).slice(0,-1),...(t.name?{name:t.name}:{})});continue}
  const p=centerOf(e);if(!p)continue
  const kind=spotKind(t)
  if(kind){
   const covered=t.covered??t.shelter
   const roof:TriState=kind==='shelter'||kind==='indoor'?'yes':tri(covered)
   const access=[t.opening_hours?`営業時間 ${t.opening_hours}`:'',t.access&&t.access!=='yes'?`利用: ${t.access}`:''].filter(Boolean).join(' / ')
   spots.push({id:'osm:'+e.id,name:t.name??t['name:ja']??null,kind,position:p,roof,roofSource:roof==='unknown'?null:'tag',seats:num(t.seats)??num(t.capacity),backrest:tri(t.backrest),wheelchair:t.wheelchair==='limited'?'limited':tri(t.wheelchair),...(access?{access}:{}),description:[t.description,t.material?`素材: ${t.material}`:'',kind==='trash'&&t.recycling_type?`分別: ${t.recycling_type}`:''].filter(Boolean).join(' / '),origin:'osm',infoSource:'osm',...(t.indoor==='yes'||kind==='indoor'?{cooling:'unknown' as const}:{})})
   continue
  }
  const a=attractorOf(e,t,p);if(a)attractors.push(a)
 }
 // 屋根が不明な地点: 建物や屋根の外形の中にあれば「屋根あり（推定）」
 const shapes=buildings.map(b=>({b,ring:b.footprint.map(p=>proj.toXY(p))}))
 for(const sp of spots){
  if(sp.roof!=='unknown')continue
  const q:XY=proj.toXY(sp.position),hit=shapes.find(x=>pointInRing(q,x.ring))
  if(hit){sp.roof='yes';sp.roofSource=hit.b.kind==='roof'?'roof-polygon':'inside-building'}
 }
 return {spots,buildings,trees,parks,attractors,meta:{source:raw.source??'OpenStreetMap',sourceLabel:opts.live?'OSM ライブ取得':'OSM 同梱データ',attribution:'© OpenStreetMap contributors (ODbL 1.0)',asOf:raw.osmBase??null,fetchedAt:raw.fetchedAt??null,live:opts.live,heightSources:s}}
}
