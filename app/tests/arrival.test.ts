import {describe,it,expect} from 'vitest'
import {rankArrival,spreadPicks,shadeSpan,arrivalReason,hitRate,preferShadeFor,walkMinutesFor,DETOUR,type ArrivalPick} from '../src/domain/arrival.ts'
import {routeShade} from '../src/domain/route.ts'
import {validateSaved,EMPTY} from '../src/lib/storage.ts'
import {LocalProjection} from '../src/domain/geo.ts'
import {AREA_CENTER} from '../src/domain/area.ts'
import type {ShadeState,Spot} from '../src/domain/types.ts'

const spot=(id:string):Spot=>({id,kind:'bench',name:id,position:{lat:35.45,lng:139.63},origin:'osm',seats:null,roof:'unknown',roofSource:null,backrest:'unknown',wheelchair:'unknown'} as Spot)
describe('着いたとき日陰で座れるベンチ',()=>{
 it('今ではなく着く時刻の日陰で順位を付ける（今は日なたでも、着くころ日陰なら上に）',()=>{
  // a は近いが着くころ日なた、b は少し遠いが着くころ日陰（日陰は 15:10 から）
  const shadeAt=(s:Spot,m:number):ShadeState=>s.id==='b'&&m>=910?'building':'sun'
  const r=rankArrival([{spot:spot('a'),distanceM:200},{spot:spot('b'),distanceM:600}],{departMin:900,preferShade:true,shadeAt,seatAt:()=>.7})
  expect(r[0].spot.id).toBe('b');expect(r[0].arriveMin).toBe(900+walkMinutesFor(600*DETOUR));expect(r[0].shade).toBe('building');expect(shadeAt(spot('b'),900)).toBe('sun')})
 it('寒い日は日なたを優先する',()=>{const shadeAt=(s:Spot):ShadeState=>s.id==='a'?'building':'sun';const r=rankArrival([{spot:spot('a'),distanceM:300},{spot:spot('b'),distanceM:300}],{departMin:720,preferShade:preferShadeFor(12),shadeAt,seatAt:()=>.6});expect(r[0].spot.id).toBe('b');expect(preferShadeFor(24)).toBe(true)})
 it('日陰がいつまで続くか、日なたなら次に日陰になる時刻を返す',()=>{const tl={spotId:'x',dateKey:'2026-08-14',startMin:600,stepMin:15,states:['sun','sun','building','building','tree','sun'] as ShadeState[]}
  expect(shadeSpan(tl,630)).toEqual({shaded:true,untilMin:675,nextShadeMin:null});expect(shadeSpan(tl,600)).toEqual({shaded:false,untilMin:null,nextShadeMin:630});expect(shadeSpan(tl,690).nextShadeMin).toBeNull();expect(shadeSpan(tl,2000).shaded).toBe(false)})
 it('理由の一言を日陰・空席・徒歩から作る',()=>{expect(arrivalReason({shade:'building',preferShade:true,seat:.75,walkMin:9})).toBe('着くころは建物の影・空いている見込み・徒歩9分');expect(arrivalReason({shade:'sun',preferShade:false,seat:.2,walkMin:3})).toContain('暖かい')})
})
describe('答え合わせと日なたを歩く時間',()=>{
 it('答え合わせの一致率を返し、0件なら null',()=>{const c=(o:'shade'|'sun',p:'shade'|'sun')=>({id:o+p+Math.random(),spotId:'x',observed:o,predicted:p,checkedAt:new Date().toISOString()});const r=hitRate([c('shade','shade'),c('sun','sun'),c('sun','shade')]);expect(r.hits).toBe(2);expect(r.ratio).toBeCloseTo(2/3);expect(hitRate([]).ratio).toBeNull()})
 it('答え合わせを保存でき、checks のない古いバックアップも読める',()=>{const old={version:1,favorites:[],reports:[],spots:[],flags:[]};expect(validateSaved(old).checks).toEqual([]);const d={...structuredClone(EMPTY),checks:[{id:'1',spotId:'s',observed:'shade',predicted:'sun',checkedAt:new Date().toISOString()}]};expect(validateSaved(d).checks).toHaveLength(1);expect(()=>validateSaved({...d,checks:[{id:'1',spotId:'s',observed:'rain',predicted:'sun',checkedAt:new Date().toISOString()}]})).toThrow()})
 it('ルートの日なたの距離を数え、歩いた距離に応じた時刻で判定できる',()=>{const proj=new LocalProjection(AREA_CENTER),a=proj.toLatLng({x:0,y:0}),b=proj.toLatLng({x:160,y:0})
  const s=routeShade([a,b],(_p,along)=>along<80?'sun':'building',proj,10);expect(s.sunM).toBeGreaterThan(70);expect(s.sunM).toBeLessThan(90);expect(s.totalM).toBeCloseTo(160,0)})
})
describe('歩く距離の上限',()=>{
 it('20分より遠い候補は、近くに候補があるときは出さない',()=>{const r=rankArrival([{spot:spot('far'),distanceM:2500},{spot:spot('near'),distanceM:300}],{departMin:840,preferShade:true,shadeAt:(s:Spot):ShadeState=>s.id==='far'?'tree':'sun',seatAt:()=>.9});expect(r.map(p=>p.spot.id)).toEqual(['near']);expect(rankArrival([{spot:spot('far'),distanceM:2500}],{departMin:840,preferShade:true,shadeAt:()=>'tree',seatAt:()=>.9})).toHaveLength(1)})
})
describe('歩ける時間の選択',()=>{
 it('歩ける時間を短くすると、その範囲の候補だけになる',()=>{const items=[{spot:spot('m10'),distanceM:600},{spot:spot('m4'),distanceM:250}];const o={departMin:840,preferShade:true,shadeAt:()=>'tree' as ShadeState,seatAt:()=>.8};expect(rankArrival(items,{...o,maxWalkMin:5}).map(p=>p.spot.id)).toEqual(['m4']);expect(rankArrival(items,{...o,maxWalkMin:20})).toHaveLength(2)})
})
describe('候補を散らす',()=>{
 it('上位から80m未満の候補は外し、違う場所を5件まで並べる',()=>{const at=(id:string,lat:number):ArrivalPick=>({spot:{...spot(id),position:{lat,lng:139.63}},walkMin:5,arriveMin:900,shade:'tree',seat:.8,score:1})
  const r=spreadPicks([at('a',35.45),at('a2',35.4502),at('b',35.452),at('c',35.454)],80);expect(r.map(p=>p.spot.id)).toEqual(['a','b','c'])})
})
describe('日没まで日陰',()=>{
 it('日陰のまま日が沈むときは untilDark を付ける',()=>{const tl={spotId:'x',dateKey:'2026-11-09',startMin:960,stepMin:15,states:['building','building','night'] as ShadeState[]};expect(shadeSpan(tl,960).untilDark).toBe(true);expect(shadeSpan({...tl,states:['building','sun','night']},960).untilDark).toBeUndefined()})
})
