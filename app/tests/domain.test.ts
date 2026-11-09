import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {AREA_CENTER} from '../src/domain/area.ts'
import {LocalProjection,pointInRing} from '../src/domain/geo.ts'
import {sunPosition,sunTimes} from '../src/domain/sun.ts'
import {jstDate,jstParts,dayTypeOf} from '../src/domain/time.ts'
import {ShadeEngine} from '../src/domain/shade.ts'
import {buildingShadowXY} from '../src/domain/shadowPolygons.ts'
import {parseOsm} from '../src/domain/osm.ts'
import {predictSeat,postsApply,postWeight,historyOffset,hoursSinceRain,seatNeighborMap,confidenceOf} from '../src/domain/seat.ts'
import {validateSaved,validFeatures,EMPTY} from '../src/lib/storage.ts'
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
describe('空席予測 v1（学習・要因・確からしさ）',()=>{
 const now=jstDate('2026-11-04',720),base={spot,time:now,now,dayType:dayTypeOf(now),weather:demoWeather('2026-11-04',720),wbgt:null,shade:'sun' as const,events:[],location:{multiplier:1,nearest:null},reports:[] as SeatReport[]}
 const old=(value:'sat'|'full',daysAgo:number,ai:number,i=0):SeatReport=>({id:'h'+value+daysAgo+i,spotId:spot.id,value,reportedAt:new Date(now.getTime()-daysAgo*86400000).toISOString(),origin:'local',features:{hour:12,dayType:'weekday',temperatureC:20,wbgt:null,condition:'clear',shade:'sun',roof:false,aiProbability:ai}})
 it('過去に「座れた」が多いと予測を上げ、「満席」が多いと下げる',()=>{const r=predictSeat(base).rule;const up=predictSeat({...base,reports:[1,2,3,4].map(d=>old('sat',d,.2))});const down=predictSeat({...base,reports:[1,2,3,4].map(d=>old('full',d,.9))});expect(up.ai).toBeGreaterThan(r);expect(down.ai).toBeLessThan(r);expect(up.rule).toBe(r);expect(up.history?.n).toBeGreaterThan(0)})
 it('投稿時の入力がない投稿・直近の投稿は学習に使わない',()=>{const bare={...old('full',3,.9),features:undefined};expect(historyOffset(spot.id,[bare],now,now,'weekday')).toBe(null);const recent={...old('full',0,.9),reportedAt:new Date(now.getTime()-10*60000).toISOString()};expect(historyOffset(spot.id,[recent],now,now,'weekday')).toBe(null)})
 it('件数が少ないうちは補正を小さくする',()=>{const one=historyOffset(spot.id,[old('full',1,.9)],now,now,'weekday')!;expect(Math.abs(one.offset)).toBeLessThan(.9/3)})
 it('近くの地点の投稿は投稿込みの値だけを動かす',()=>{const r:SeatReport={id:'n',spotId:'b2',value:'full',reportedAt:now.toISOString(),origin:'local'};const p=predictSeat({...base,neighbors:[{spotId:'b2',distanceM:50}],reports:[r]});const q=predictSeat({...base,neighbors:[{spotId:'b2',distanceM:50}]});expect(p.ai).toBe(q.ai);expect(p.combined).toBeLessThan(q.combined);expect(p.nearbyPosts).toBe(1)})
 it('80m以内のほかの座れる場所は人が分散して座りやすくなる',()=>{const p=predictSeat({...base,neighbors:[{spotId:'x',distanceM:30},{spotId:'y',distanceM:60},{spotId:'z',distanceM:120}]});expect(p.factors.find(f=>f.key==='nearby')?.multiplier).toBe(.9);expect(p.ai).toBeGreaterThan(predictSeat(base).ai)})
 it('近くの地点を150m以内で求める',()=>{const other={...spot,id:'c',position:position(0,125)},far={...spot,id:'d',position:position(0,400)};const m=seatNeighborMap([spot,other,far]);expect(m.get('a')?.map(n=>n.spotId)).toEqual(['c']);expect(m.get('a')![0].distanceM).toBeGreaterThan(95);expect(m.get('a')![0].distanceM).toBeLessThan(105)})
 it('雨上がりの経過時間を求め、屋根なしの座面がぬれている間は座る人が減る',()=>{const h=(min:number,c:'rain'|'clear')=>({...demoWeather('2026-11-04',min),time:jstDate('2026-11-04',min).toISOString(),condition:c});const hours=[h(600,'rain'),h(660,'clear'),h(720,'clear')];expect(hoursSinceRain(hours,jstDate('2026-11-04',690))).toBe(.5);expect(hoursSinceRain(hours,jstDate('2026-11-04',630))).toBe(null);const wet=predictSeat({...base,hoursSinceRain:.5});expect(wet.factors.find(f=>f.key==='wet')?.multiplier).toBe(.5);expect(wet.ai).toBeGreaterThan(predictSeat(base).ai);expect(predictSeat({...base,hoursSinceRain:.5,shade:'roof'}).factors.some(f=>f.key==='wet')).toBe(false)})
 it('日没後の屋根なしは暗さの要因が付く',()=>{expect(predictSeat({...base,shade:'night'}).factors.some(f=>f.key==='dark')).toBe(true);expect(predictSeat({...base,shade:'night',spot:{...spot,roof:'yes'}}).factors.some(f=>f.key==='dark')).toBe(false)})
 it('確からしさは仮定が多いと低く、投稿があると高く、幅は0〜1に収まる',()=>{const c={seatsAssumed:true,weatherIsDemo:true,hoursAhead:8,historyN:0,liveWeight:0,applies:false};const low=confidenceOf(.5,c);expect(low.level).toBe('low');expect(low.notes).toEqual(expect.arrayContaining(['席数は仮定','天気はデモの値','先の時刻の予測']));const high=confidenceOf(.5,{...c,seatsAssumed:false,weatherIsDemo:false,hoursAhead:0,liveWeight:2,applies:true});expect(high.level).toBe('high');expect(high.high-high.low).toBeLessThan(low.high-low.low);const edge=confidenceOf(.99,c);expect(edge.low).toBeGreaterThanOrEqual(0);expect(edge.high).toBeLessThanOrEqual(1)})
 it('予測の結果に確からしさとモデル名が入る',()=>{const p=predictSeat({...base,weatherIsDemo:true});expect(p.method).toBe('rule-v1');expect(p.confidence.low).toBeLessThanOrEqual(p.combined);expect(p.confidence.high).toBeGreaterThanOrEqual(p.combined);expect(p.confidence.notes).toContain('天気はデモの値')})
 it('投稿時の入力を検証して保存し、不正な値は捨てる',()=>{const f=old('sat',1,.4).features!;expect(validFeatures(f)).toEqual(f);expect(validFeatures({...f,aiProbability:2})).toBe(undefined);expect(validFeatures({...f,dayType:'x'})).toBe(undefined);const saved=validateSaved({...EMPTY,reports:[old('sat',1,.4),{...old('full',1,.4),features:{bad:1}}]});expect(saved.reports[0].features).toEqual(f);expect(saved.reports[1]).not.toHaveProperty('features')})
})
describe('同梱データとバックアップ',()=>{
 it('実データの変換と日陰判定が完了する',()=>{const raw=JSON.parse(readFileSync('public/data/area-osm.json','utf8'));const d=parseOsm(raw,{origin:AREA_CENTER,live:false});expect(d.spots.length).toBe(256);expect(d.buildings.length).toBeGreaterThan(1000);const engine=new ShadeEngine(d.buildings,d.trees,AREA_CENTER);for(const s of d.spots)expect(['sun','roof','building','tree','night']).toContain(engine.stateAt(s.position,jstDate('2026-11-04',780),s.roof==='yes'))})
 it('不正なバックアップを拒否する',()=>{expect(()=>validateSaved({})).toThrow();expect(()=>validateSaved({...EMPTY,spots:[{...spot,origin:'user',position:{lat:0,lng:0}}]})).toThrow();expect(()=>validateSaved({...EMPTY,reports:[{id:'r',spotId:'s',value:'sat',reportedAt:'invalid',origin:'local'}]})).toThrow()})
 it('復元時に不要なデータを持ち込まない',()=>{const result=validateSaved({...EMPTY,favorites:['a','a'],unexpected:'x'});expect(result.favorites).toEqual(['a']);expect(result).not.toHaveProperty('unexpected')})
 it('取得した天気の対象外はnull',()=>{expect(weatherAt({sourceLabel:'test',isDemo:false,fetchedAt:'',hours:[demoWeather('2026-11-04',720)]},jstDate('2026-11-05',720))).toBe(null)})
})
