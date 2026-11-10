// 計算部分のテスト。2026-11-10 に書き直し（期間中に足した「空席予測 v1」のテストはそのまま）
import {describe,it,expect} from 'vitest'
import {AREA_CENTER,inBounds} from '../src/domain/area.ts'
import {LocalProjection,haversineM,pointInRing,walkMinutes,formatDistance} from '../src/domain/geo.ts'
import {jstDate,jstParts,dayTypeOf,formatTime,formatDateJa} from '../src/domain/time.ts'
import {sunPosition,sunTimes,directionLabel} from '../src/domain/sun.ts'
import {estimateWbgt,wbgtLevel} from '../src/domain/wbgt.ts'
import {parseOsm,type SlimOsm} from '../src/domain/osm.ts'
import {demoWeather,wmoCondition,weatherAt} from '../src/lib/weather.ts'
import type {SeatReport,Spot} from '../src/domain/types.ts'
const proj=new LocalProjection(AREA_CENTER),position=(x:number,y:number)=>proj.toLatLng({x,y})
const spot:Spot={id:'a',name:'テストのベンチ',kind:'bench',position:position(0,25),origin:'osm',seats:4,roof:'no',roofSource:'tag',backrest:'yes',wheelchair:'unknown',description:''}
import {predictSeat,postsApply,postWeight,historyOffset,hoursSinceRain,seatNeighborMap,confidenceOf} from '../src/domain/seat.ts'
import {validateSaved,validFeatures,EMPTY} from '../src/lib/storage.ts'
describe('座標と距離',()=>{
 it('平面座標と緯度経度を往復できる',()=>{const p=position(120,-80),q=proj.toXY(p);expect(q.x).toBeCloseTo(120,6);expect(q.y).toBeCloseTo(-80,6)})
 it('平面の距離と大円距離がほぼ一致する',()=>{expect(haversineM(position(0,0),position(300,400))).toBeGreaterThan(498);expect(haversineM(position(0,0),position(300,400))).toBeLessThan(502)})
 it('多角形の内外を判定する',()=>{const sq=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];expect(pointInRing({x:5,y:5},sq)).toBe(true);expect(pointInRing({x:15,y:5},sq)).toBe(false)})
 it('徒歩の分数と距離の表示',()=>{expect(walkMinutes(800)).toBe(10);expect(walkMinutes(10)).toBe(1);expect(formatDistance(1234)).toBe('1.2km');expect(formatDistance(347)).toBe('350m')})
 it('デモエリアの内外',()=>{expect(inBounds(AREA_CENTER)).toBe(true);expect(inBounds({lat:35.68,lng:139.76})).toBe(false)})
})
describe('日本時間',()=>{
 it('端末のタイムゾーンに関係なく JST で日付と時刻を作る',()=>{const t=jstDate('2026-11-10',9*60+5);expect(t.toISOString()).toBe('2026-11-10T00:05:00.000Z');const p=jstParts(t);expect(p.dateKey).toBe('2026-11-10');expect(p.hour).toBe(9);expect(p.minute).toBe(5)})
 it('平日・土日・祝日を分ける',()=>{expect(dayTypeOf(jstDate('2026-11-10',600))).toBe('weekday');expect(dayTypeOf(jstDate('2026-11-14',600))).toBe('weekend');expect(dayTypeOf(jstDate('2026-11-23',600))).toBe('holiday')})
 it('表示の形',()=>{expect(formatTime(545)).toBe('9:05');expect(formatTime(1445)).toBe('0:05');expect(formatDateJa('2026-11-10')).toBe('11月10日（火）')})
})
describe('太陽',()=>{
 it('横浜の11月の昼は南の空、夜は地平線の下',()=>{const noon=sunPosition(jstDate('2026-11-10',690),AREA_CENTER);expect(noon.altitude).toBeGreaterThan(30);expect(noon.altitude).toBeLessThan(45);expect(noon.azimuth).toBeGreaterThan(150);expect(noon.azimuth).toBeLessThan(200);expect(sunPosition(jstDate('2026-11-10',1380),AREA_CENTER).altitude).toBeLessThan(0)})
 it('日の出・日の入りが朝と夕方にある',()=>{const t=sunTimes('2026-11-10',AREA_CENTER);expect(t.sunriseMin!).toBeGreaterThan(5*60);expect(t.sunriseMin!).toBeLessThan(7*60);expect(t.sunsetMin!).toBeGreaterThan(16*60);expect(t.sunsetMin!).toBeLessThan(17*60+30)})
 it('方位の名前',()=>{expect(directionLabel(0)).toBe('北');expect(directionLabel(180)).toBe('南');expect(directionLabel(359)).toBe('北')})
})
describe('暑さ指数（推定）',()=>{
 it('暑い晴れの昼は高く、涼しいくもりは低い',()=>{const hot=estimateWbgt({temperatureC:34,condition:'clear',humidity:65},70),cool=estimateWbgt({temperatureC:18,condition:'cloudy',humidity:60},30);expect(hot).toBeGreaterThan(28);expect(cool).toBeLessThan(21);expect(wbgtLevel(hot)).toMatch(/severe|danger/);expect(wbgtLevel(cool)).toBe('safe')})
})
describe('天気',()=>{
 it('デモの天気は昼に暖かく、指定した値を使える',()=>{const a=demoWeather('2026-11-10',300),b=demoWeather('2026-11-10',840);expect(b.temperatureC).toBeGreaterThan(a.temperatureC);expect(demoWeather('2026-11-10',840,30,'rain')).toMatchObject({temperatureC:30,condition:'rain'})})
 it('天気コードを区分に分ける',()=>{expect(wmoCondition(0)).toBe('clear');expect(wmoCondition(3)).toBe('cloudy');expect(wmoCondition(61)).toBe('rain');expect(wmoCondition(95)).toBe('heavy-rain');expect(wmoCondition(73)).toBe('snow')})
 it('予報から時刻を含む1時間を選ぶ',()=>{const h=(m:number,t:number)=>({...demoWeather('2026-11-10',m,t),time:jstDate('2026-11-10',m).toISOString()});const f={source:'open-meteo' as const,sourceLabel:'x',fetchedAt:'',hours:[h(600,10),h(660,11)]};expect(weatherAt(f,jstDate('2026-11-10',630))?.temperatureC).toBe(10);expect(weatherAt(f,jstDate('2026-11-10',800))).toBe(null)})
})
describe('OSM の変換',()=>{
 const g=(pts:[number,number][]):[number,number][]=>[...pts,pts[0]].map(([x,y])=>{const p=position(x,y);return [p.lat,p.lng]})
 const raw:SlimOsm={version:2,source:'test',fetchedAt:'2026-11-10T00:00:00Z',osmBase:'2026-11-10T00:00:00Z',elements:[
  {t:'w',id:1,tags:{building:'yes','building:levels':'5'},g:g([[-10,-10],[10,-10],[10,10],[-10,10]])},
  {t:'n',id:2,tags:{amenity:'bench',seats:'3',backrest:'yes'},...(()=>{const p=position(0,0);return {lat:p.lat,lng:p.lng}})()},
  {t:'n',id:3,tags:{amenity:'bench',covered:'yes'},...(()=>{const p=position(50,0);return {lat:p.lat,lng:p.lng}})()},
  {t:'n',id:4,tags:{amenity:'toilets',wheelchair:'yes'},...(()=>{const p=position(80,0);return {lat:p.lat,lng:p.lng}})()},
  {t:'n',id:5,tags:{natural:'tree',height:'10'},...(()=>{const p=position(0,40);return {lat:p.lat,lng:p.lng}})()},
  {t:'n',id:6,tags:{railway:'station',name:'テスト駅'},...(()=>{const p=position(200,0);return {lat:p.lat,lng:p.lng}})()},
 ]}
 const d=parseOsm(raw,{origin:AREA_CENTER,live:false})
 it('地点・建物・樹木・駅を取り出す',()=>{expect(d.spots.map(s=>s.kind)).toEqual(['bench','bench','toilet']);expect(d.buildings).toHaveLength(1);expect(d.trees).toHaveLength(1);expect(d.attractors[0].name).toBe('テスト駅')})
 it('階数から高さを推定し、出どころを数える',()=>{expect(d.buildings[0].heightSource).toBe('levels');expect(d.buildings[0].height).toBeGreaterThan(15);expect(d.meta.heightSources.levels).toBe(1)})
 it('建物の中の地点は屋根あり（推定）、タグがあればタグを使う',()=>{expect(d.spots[0]).toMatchObject({roof:'yes',roofSource:'inside-building',seats:3,backrest:'yes'});expect(d.spots[1]).toMatchObject({roof:'yes',roofSource:'tag'});expect(d.spots[2].wheelchair).toBe('yes')})
 it('データの時点を残す',()=>{expect(d.meta.asOf).toBe('2026-11-10T00:00:00Z');expect(d.meta.live).toBe(false)})
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
describe('同梱データ（2026-11-10 に取得）',()=>{
 it('取り直した OSM データを読み、休憩スポットと建物がある',async()=>{const {readFileSync}=await import('node:fs');const raw=JSON.parse(readFileSync('public/data/area-osm.json','utf8')) as SlimOsm;expect(raw.version).toBe(2);expect(Date.parse(raw.fetchedAt)).toBeGreaterThanOrEqual(Date.parse('2026-11-05T01:00:00Z'));const d=parseOsm(raw,{origin:AREA_CENTER,live:false});expect(d.spots.filter(s=>s.kind==='bench').length).toBeGreaterThan(30);expect(d.buildings.length).toBeGreaterThan(300)})
})
// 型だけ使う（未使用の警告を避ける）
export type {SeatReport}

