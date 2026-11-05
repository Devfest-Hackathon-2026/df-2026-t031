import {describe,it,expect} from 'vitest'
import {buildWalkingGraph,findWalkingRoute,type RouteContext} from '../src/domain/routes.ts'
import {matchesSeatFilter,nearestToiletDistance} from '../src/domain/spotFilters.ts'
import type {Spot} from '../src/domain/types.ts'
import {withPlateau} from '../src/domain/plateau.ts'
import {parseOsm} from '../src/domain/osm.ts'
import {AREA_CENTER} from '../src/domain/area.ts'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {estimateWbgt} from '../src/domain/wbgt.ts'
import {predictSeat} from '../src/domain/seat.ts'
import {demoWeather} from '../src/lib/weather.ts'
import {jstDate} from '../src/domain/time.ts'
const point=(lat:number,lng:number)=>({lat,lng})
const spot=(kind:Spot['kind'],lat=35,lng=139):Spot=>({id:kind,kind,name:null,position:point(lat,lng),origin:'osm',seats:null,roof:'unknown',roofSource:null,backrest:'unknown',wheelchair:'unknown'})
describe('offline route',()=>{
 it('follows connected walking geometry instead of drawing a shortcut',()=>{
  const context:RouteContext={features:[{id:1,kind:'road',roadType:'footway',points:[[35,139],[35.002,139],[35.002,139.002],[35,139.002]]}]}
  const r=findWalkingRoute(buildWalkingGraph(context),point(35,139),point(35,139.002))
  expect(r.kind).toBe('network');expect(r.points).toContainEqual(point(35.002,139));expect(r.distanceM).toBeGreaterThan(500)
 })
 it('does not turn a motorway into a walking route',()=>{
  const graph=buildWalkingGraph({features:[{id:2,kind:'road',roadType:'motorway',points:[[35,139],[35,139.002]]}]})
  expect(graph).toHaveLength(0);expect(findWalkingRoute(graph,point(35,139),point(35,139.002)).kind).toBe('estimate')
 })
 it('labels disconnected and distant endpoints as direct estimates',()=>{
  const graph=buildWalkingGraph({features:[{id:1,kind:'road',roadType:'footway',points:[[35,139],[35,139.0001]]},{id:2,kind:'road',roadType:'footway',points:[[35.003,139],[35.003,139.0001]]}]})
  expect(findWalkingRoute(graph,point(35,139),point(35.003,139)).kind).toBe('estimate')
  expect(findWalkingRoute(graph,point(36,139),point(35,139)).kind).toBe('estimate')
 })
})
describe('rest filters',()=>{
 it('only includes seats at or above the displayed threshold',()=>{expect(matchesSeatFilter(spot('bench'),.7)).toBe(true);expect(matchesSeatFilter(spot('bench'),.699)).toBe(false);expect(matchesSeatFilter(spot('water'),.99)).toBe(false)})
 it('measures toilets, ignoring other nearby equipment',()=>{expect(nearestToiletDistance(spot('bench'),[spot('water'),spot('toilet',35.001)])).toBeGreaterThan(100);expect(nearestToiletDistance(spot('bench'),[])).toBe(Infinity)})
})
describe('PLATEAU integration',()=>{
 const subset=JSON.parse(readFileSync('public/data/plateau-nishi.json','utf8')),dataset=parseOsm(JSON.parse(readFileSync('public/data/area-osm.json','utf8')),{origin:AREA_CENTER,live:false})
 it('ships a bounded real LOD2 subset with matching geometry hash',()=>{
  const binary=readFileSync('public/data/plateau-nishi.glb')
  expect(subset.year).toBe(2024);expect(subset.lod).toBe(2);expect(subset.buildings).toHaveLength(142)
  expect(createHash('sha256').update(binary).digest('hex')).toBe(subset.sha256)
  expect(binary.toString('ascii',0,4)).toBe('glTF');expect(binary.length).toBeLessThan(2000000)
  expect(subset.tileRecords.every((r:{url:string})=>r.url.startsWith('https://assets.cms.plateau.reearth.io/'))).toBe(true)
 })
 it('preserves POIs and trees while replacing overlapping OSM volumes',()=>{
  const merged=withPlateau(dataset,subset)
  expect(merged.spots).toBe(dataset.spots);expect(merged.trees).toBe(dataset.trees)
  expect(merged.buildings.filter(b=>b.heightSource==='plateau')).toHaveLength(142)
  expect(merged.buildings.filter(b=>b.heightSource!=='plateau').length).toBeLessThan(dataset.buildings.length)
  expect(withPlateau(dataset,{...subset,origin:{lat:0,lng:0}})).toBe(dataset)
 })
})
it('connects hot sunny conditions to the existing shade-sensitive seat model',()=>{
 const time=jstDate('2026-08-05',840),weather=demoWeather('2026-08-05',840,35,'clear'),wbgt=estimateWbgt(weather,60)
 const base={spot:spot('bench'),time,now:time,dayType:'weekday' as const,weather,wbgt,events:[],location:{multiplier:1,nearest:null},reports:[]}
 const shade=predictSeat({...base,shade:'building'}),sun=predictSeat({...base,shade:'sun'})
 expect(shade.factors.some(f=>f.key==='heat')).toBe(true);expect(shade.ai).toBeLessThan(sun.ai)
})
