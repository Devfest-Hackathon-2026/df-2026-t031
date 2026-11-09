import {describe,it,expect} from 'vitest'
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
