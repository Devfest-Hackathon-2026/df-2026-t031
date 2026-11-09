import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {buildWalkGraph,findWalkRoute,routeShade,shadeFirstCost,type WalkFeature} from '../src/domain/route.ts'
import {LocalProjection} from '../src/domain/geo.ts'
import {AREA_CENTER,DEMO_USER_LOCATION} from '../src/domain/area.ts'
import type {ShadeState,XY} from '../src/domain/types.ts'

const proj=new LocalProjection(AREA_CENTER)
const ll=(x:number,y:number):[number,number]=>{const p=proj.toLatLng({x,y});return [p.lat,p.lng]}
const at=(x:number,y:number)=>proj.toLatLng({x,y})
// 正方形の道: 下の辺（y=0）と、上を回る道（y=100）
const square:WalkFeature[]=[
 {kind:'road',roadType:'footway',points:[ll(0,0),ll(100,0),ll(200,0)]},
 {kind:'road',roadType:'footway',points:[ll(0,0),ll(0,100),ll(200,100),ll(200,0)]},
 {kind:'road',roadType:'motorway',points:[ll(0,0),ll(0,-50),ll(200,-50),ll(200,0)]},
]
describe('アプリ内の徒歩ルート',()=>{
 it('道をつないだ最短経路を通り、高速道路は使わない',()=>{const g=buildWalkGraph(square,proj),r=findWalkRoute(g,at(0,-5),at(200,-5));expect(r.fallback).toBe(false);expect(r.distance).toBeCloseTo(210,0);expect(r.points.every(p=>proj.toXY(p).y>-10)).toBe(true)})
 it('道から遠い地点や道がないときは直線に戻す',()=>{const g=buildWalkGraph(square,proj);expect(findWalkRoute(g,at(0,0),at(5000,5000)).fallback).toBe(true);expect(findWalkRoute(buildWalkGraph([],proj),at(0,0),at(10,0)).fallback).toBe(true)})
 it('日陰優先では、日なたの近道より日陰の回り道を選ぶ',()=>{const g=buildWalkGraph(square,proj),stateAt=(p:XY):ShadeState=>p.y>50?'building':'sun'
  const fast=findWalkRoute(g,at(0,0),at(200,0)),cool=findWalkRoute(g,at(0,0),at(200,0),shadeFirstCost(g,stateAt,3))
  expect(fast.distance).toBeCloseTo(200,0);expect(cool.distance).toBeCloseTo(400,0);expect(routeShade(cool.points,stateAt,proj).shadedRatio!).toBeGreaterThan(.4)})
 it('ルートの日陰の割合と、同じ状態の区間のまとまりを返す',()=>{const stateAt=(p:XY):ShadeState=>p.x<50?'tree':'sun',s=routeShade([at(0,0),at(100,0)],stateAt,proj,10);expect(s.shadedRatio!).toBeCloseTo(.5,1);expect(s.segments.map(x=>x.state)).toEqual(['shade','sun']);expect(routeShade([at(0,0),at(100,0)],()=>'night',proj).shadedRatio).toBeNull()})
 it('同梱の道路データで桜木町から赤レンガ倉庫付近まで道沿いのルートが見つかる',()=>{const context=JSON.parse(readFileSync(new URL('../public/data/area-context.json',import.meta.url),'utf8'));const g=buildWalkGraph(context.features,proj),to={lat:35.4527,lng:139.6425},r=findWalkRoute(g,DEMO_USER_LOCATION,to)
  expect(r.fallback).toBe(false);expect(r.points.length).toBeGreaterThan(10);const straight=findWalkRoute(buildWalkGraph([],proj),DEMO_USER_LOCATION,to).distance;expect(r.distance).toBeGreaterThan(straight);expect(r.distance).toBeLessThan(straight*1.8)})
})
