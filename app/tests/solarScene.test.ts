import {describe,it,expect} from 'vitest'
import {solarVector,solarTrack,solarMoments,shadowRatio} from '../src/domain/solarScene.ts'
import {createCity,createContext,disposeObject,worldPoint} from '../src/components/cityGeometry.ts'
import {AREA_CENTER} from '../src/domain/area.ts'
import {LocalProjection} from '../src/domain/geo.ts'
import * as T from 'three'
describe('3Dの太陽座標',()=>{
 it('北を-Z、東を+X、上空を+Yとして光源と表示の座標を統一する',()=>{expect(solarVector({azimuth:0,altitude:0}).z).toBeCloseTo(-1);expect(solarVector({azimuth:90,altitude:0}).x).toBeCloseTo(1);expect(solarVector({azimuth:0,altitude:90}).y).toBeCloseTo(1)})
 it('南西の光は北東側に影を作る向きになる',()=>{const p=solarVector({azimuth:225,altitude:30});expect(p.x).toBeLessThan(0);expect(p.z).toBeGreaterThan(0);expect(p.y).toBeCloseTo(.5)})
 it('太陽軌道の点を地平線より上だけにし、半径を保つ',()=>{const track=solarTrack('2026-11-05',AREA_CENTER,145);expect(track.length).toBeGreaterThan(50);for(const p of track){expect(p.point.y).toBeGreaterThanOrEqual(0);expect(Math.hypot(p.point.x,p.point.y,p.point.z)).toBeCloseTo(145)}})
 it('時間帯を実際のJSTの天文計算から順序どおり取得する',()=>{const t=solarMoments('2026-11-05',AREA_CENTER);expect(t.dawn!).toBeLessThan(t.sunrise!);expect(t.sunrise!).toBeLessThan(t.goldenMorningEnd!);expect(t.goldenMorningEnd!).toBeLessThan(t.noon);expect(t.noon).toBeLessThan(t.goldenEveningStart!);expect(t.goldenEveningStart!).toBeLessThan(t.sunset!);expect(t.sunset!).toBeLessThan(t.dusk!)})
 it('影の倍率を高度から計算し、夜には表示しない',()=>{expect(shadowRatio(45)).toBeCloseTo(1);expect(shadowRatio(30)).toBeCloseTo(Math.sqrt(3));expect(shadowRatio(-10)).toBeNull();expect(shadowRatio(1)).toBeNull()})
})
describe('3Dモデルの構築',()=>{
 it('緯度経度を元の日陰計算と同じ投影で変換する',()=>{const p={lat:35.455,lng:139.64},xy=new LocalProjection(AREA_CENTER).toXY(p),world=worldPoint(p,12);expect(world.x).toBeCloseTo(xy.x);expect(world.z).toBeCloseTo(-xy.y);expect(world.y).toBe(12)})
 it('道路の面を上に向け、照明と影を受けられるようにする',()=>{const context=createContext({features:[{id:1,kind:'road',roadType:'residential',points:[[35.455,139.63],[35.455,139.632]]}]});expect(context.children.length).toBe(2);for(const child of context.children){const mesh=child as T.Mesh;expect(mesh.receiveShadow).toBe(true);expect(mesh.geometry.getAttribute('normal').getY(0)).toBeGreaterThan(.9)}disposeObject(context)})
 it('建物の数に比例した描画命令を作らず、まとめて描画する',()=>{const p=(x:number,y:number)=>new LocalProjection(AREA_CENTER).toLatLng({x,y});const buildings=Array.from({length:24},(_,i)=>({id:String(i),kind:'building' as const,footprint:[p(i*20,0),p(i*20+10,0),p(i*20+10,10),p(i*20,10)],height:15,minHeight:0,heightSource:'measured' as const}));const root=createCity({buildings,trees:[],parks:[],spots:[],attractors:[],meta:{sourceLabel:'test',attribution:'',asOf:null,live:false}});expect(root.children.length).toBeLessThan(12);let disposed=0;root.traverse(o=>{if(o instanceof T.Mesh)o.geometry.addEventListener('dispose',()=>disposed++)});disposeObject(root);expect(disposed).toBeGreaterThan(0)})
})
