import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {AREA_CENTER} from '../src/domain/area.ts'
import {LocalProjection,pointInRing} from '../src/domain/geo.ts'
import {sunPosition,sunTimes} from '../src/domain/sun.ts'
import {jstDate,jstParts,dayTypeOf} from '../src/domain/time.ts'
import {ShadeEngine} from '../src/domain/shade.ts'
import {buildingShadowXY} from '../src/domain/shadowPolygons.ts'
import {parseOsm} from '../src/domain/osm.ts'
import {predictSeat,postsApply,postWeight} from '../src/domain/seat.ts'
import {validateSaved,EMPTY} from '../src/lib/storage.ts'
import {demoWeather,weatherAt} from '../src/lib/weather.ts'
import type {Spot,Building,SeatReport} from '../src/domain/types.ts'
const proj=new LocalProjection(AREA_CENTER)
const position=(x:number,y:number)=>proj.toLatLng({x,y})
const building:Building={id:'b',kind:'building',footprint:[position(-10,-10),position(10,-10),position(10,10),position(-10,10)],height:20,minHeight:0,heightSource:'measured'}
const spot:Spot={id:'a',name:'検証地点',kind:'bench',position:position(0,25),origin:'osm',seats:3,roof:'no',roofSource:'tag',backrest:'yes',wheelchair:'unknown'}
describe('JSTと太陽位置',()=>{
 it('JSTの日付を端末のタイムゾーンと独立に扱う',()=>{expect(jstDate('2026-11-04',0).toISOString()).toBe('2026-11-03T15:00:00.000Z');expect(jstParts(jstDate('2026-11-04',780)).minutesOfDay).toBe(780)})
 it('横浜の昼間と夜を判定する',()=>{const noon=sunPosition(jstDate('2026-11-04',720),AREA_CENTER);expect(noon.altitude).toBeGreaterThan(30);expect(noon.azimuth).toBeGreaterThan(150);expect(noon.azimuth).toBeLessThan(220);expect(sunPosition(jstDate('2026-11-04',0),AREA_CENTER).altitude).toBeLessThan(0)})
 it('日の出・日の入りをJSTの分で返す',()=>{const t=sunTimes('2026-11-04',AREA_CENTER);expect(t.sunriseMin).toBeGreaterThan(300);expect(t.sunriseMin).toBeLessThan(420);expect(t.sunsetMin).toBeGreaterThan(960);expect(t.sunsetMin).toBeLessThan(1080)})
})
describe('日陰の幾何と描画の一致',()=>{
 const engine=new ShadeEngine([building],[],AREA_CENTER)
 it('南の太陽なら北側が日陰',()=>{expect(engine.stateAtXY({x:0,y:25},{altitude:45,azimuth:180})).toBe('building');expect(engine.stateAtXY({x:0,y:-25},{altitude:45,azimuth:180})).toBe('sun')})
 it('描いた影も北側へ伸びる',()=>{const ring=building.footprint.map(p=>proj.toXY(p));const shapes=buildingShadowXY(ring,20,0,{altitude:45,azimuth:180});expect(shapes.some(p=>pointInRing({x:0,y:25},p))).toBe(true);expect(shapes.some(p=>pointInRing({x:0,y:-25},p))).toBe(false)})
 it('低い太陽による長い影も判定と描画が一致する',()=>{const tall={...building,height:200},sun={altitude:5,azimuth:180};const engine=new ShadeEngine([tall],[],AREA_CENTER);expect(engine.stateAtXY({x:0,y:1400},sun)).toBe('building');const shapes=buildingShadowXY(tall.footprint.map(p=>proj.toXY(p)),200,0,sun);expect(shapes.some(ring=>pointInRing({x:0,y:1400},ring))).toBe(true)})
 it('日差しがない時間に影を描かない',()=>{expect(engine.stateAtXY({x:0,y:25},{altitude:-5,azimuth:0})).toBe('night');expect(buildingShadowXY([{x:0,y:0},{x:2,y:0},{x:2,y:2}],5,0,{altitude:-5,azimuth:0})).toEqual([])})
 it('光線が高い屋根の下を通れる',()=>{const roof=new ShadeEngine([{...building,kind:'roof',height:25,minHeight:20}],[],AREA_CENTER);expect(roof.stateAtXY({x:0,y:5},{altitude:45,azimuth:180})).toBe('sun')})
})
describe('空席予測と実投稿',()=>{
 const now=jstDate('2026-11-04',720),base={spot,time:now,now,dayType:dayTypeOf(now),weather:demoWeather('2026-11-04',720),wbgt:null,shade:'sun' as const,events:[],location:{multiplier:1,nearest:null},reports:[] as SeatReport[]}
 it('同じ入力なら同じ確率、0〜1の範囲',()=>{const p=predictSeat(base);expect(p).toEqual(predictSeat(base));expect(p.ai).toBeGreaterThanOrEqual(0);expect(p.ai).toBeLessThanOrEqual(1)})
 it('満席の投稿は補正値を下げ、元の予測を変えない',()=>{const p=predictSeat({...base,reports:[{id:'r',spotId:spot.id,value:'full',reportedAt:now.toISOString(),origin:'local'}]});expect(p.ai).toBe(predictSeat(base).ai);expect(p.combined).toBeLessThan(p.ai);expect(p.posts[0].origin).toBe('local')})
 it('未来の時刻には現在の投稿を反映しない',()=>{const time=new Date(now.getTime()+2*3600000);const p=predictSeat({...base,time,reports:[{id:'r',spotId:spot.id,value:'full',reportedAt:now.toISOString(),origin:'local'}]});expect(p.combined).toBe(p.ai);expect(postsApply(time,now)).toBe(false)})
 it('投稿の重みが20分で半分になる',()=>expect(postWeight(20)).toBe(.5))
 it('90分を超えた投稿は除外する',()=>{const p=predictSeat({...base,reports:[{id:'r',spotId:spot.id,value:'full',reportedAt:new Date(now.getTime()-91*60000).toISOString(),origin:'local'}]});expect(p.posts).toEqual([]);expect(p.combined).toBe(p.ai)})
})
describe('同梱データとバックアップ',()=>{
 it('実データの変換と日陰判定が完了する',()=>{const raw=JSON.parse(readFileSync('public/data/area-osm.json','utf8'));const d=parseOsm(raw,{origin:AREA_CENTER,live:false});expect(d.spots.length).toBe(256);expect(d.buildings.length).toBeGreaterThan(1000);const engine=new ShadeEngine(d.buildings,d.trees,AREA_CENTER);for(const s of d.spots)expect(['sun','roof','building','tree','night']).toContain(engine.stateAt(s.position,jstDate('2026-11-04',780),s.roof==='yes'))})
 it('不正なバックアップを拒否する',()=>{expect(()=>validateSaved({})).toThrow();expect(()=>validateSaved({...EMPTY,spots:[{...spot,origin:'user',position:{lat:0,lng:0}}]})).toThrow();expect(()=>validateSaved({...EMPTY,reports:[{id:'r',spotId:'s',value:'sat',reportedAt:'invalid',origin:'local'}]})).toThrow()})
 it('復元時に不要なデータを持ち込まない',()=>{const result=validateSaved({...EMPTY,favorites:['a','a'],unexpected:'x'});expect(result.favorites).toEqual(['a']);expect(result).not.toHaveProperty('unexpected')})
 it('取得した天気の対象外はnull',()=>{expect(weatherAt({sourceLabel:'test',isDemo:false,fetchedAt:'',hours:[demoWeather('2026-11-04',720)]},jstDate('2026-11-05',720))).toBe(null)})
})
