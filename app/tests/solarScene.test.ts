// 3D の太陽の位置と時間帯のテスト。2026-11-10 に書き直し
import {describe,it,expect} from 'vitest'
import {solarVector,solarTrack,solarMoments,shadowRatio,nextSolarMoment} from '../src/domain/solarScene.ts'
import {AREA_CENTER} from '../src/domain/area.ts'
import {sunPosition} from '../src/domain/sun.ts'
import {jstDate} from '../src/domain/time.ts'
import {ShadeEngine,shadeWindows} from '../src/domain/shade.ts'
import {LocalProjection} from '../src/domain/geo.ts'
describe('太陽の位置と時間帯',()=>{
 it('太陽の方向の点は半径の長さで、昼は上・南（+z）にある',()=>{const s=sunPosition(jstDate('2026-11-10',690),AREA_CENTER),v=solarVector(s,100);expect(Math.hypot(v.x,v.y,v.z)).toBeCloseTo(100,6);expect(v.y).toBeGreaterThan(0);expect(v.z).toBeGreaterThan(0)})
 it('軌道は地平線より上の点だけで、時刻順',()=>{const t=solarTrack('2026-11-10',AREA_CENTER,50);expect(t.length).toBeGreaterThan(50);expect(t.every(p=>p.sun.altitude>0)).toBe(true);expect(t.every((p,i)=>!i||p.minute>t[i-1].minute)).toBe(true)})
 it('影の長さの比は太陽が低いほど長く、夜は null',()=>{expect(shadowRatio(45)).toBeCloseTo(1,6);expect(shadowRatio(20)!).toBeGreaterThan(2);expect(shadowRatio(-3)).toBe(null)})
 it('次の太陽イベントを返し、日の終わりは翌日の最初の光に回す',()=>{const t=solarMoments('2026-11-05',AREA_CENTER);expect(nextSolarMoment(t,t.sunrise!-1)!.label).toBe('日の出');expect(nextSolarMoment(t,t.noon)!.label).toBe('日没');const late=nextSolarMoment(t,t.dusk!+10)!;expect(late.label).toBe('最初の光');expect(late.at).toBe(t.dawn!+1440);expect(late.inMin).toBeGreaterThan(0)})
 it('建物の北側の地点は、昼に日陰の時間帯がある',()=>{const proj=new LocalProjection(AREA_CENTER),at=(x:number,y:number)=>proj.toLatLng({x,y}),e=new ShadeEngine([{id:'b',kind:'building',footprint:[at(-20,-40),at(20,-40),at(20,-5),at(-20,-5)],height:40,minHeight:0,heightSource:'measured'}],[],AREA_CENTER),tl=e.timeline('p',at(0,0),false,'2026-11-10'),w=shadeWindows(tl);expect(w.length).toBeGreaterThan(0);expect(w[0].startMin).toBeLessThan(720);expect(w.at(-1)!.endMin).toBeGreaterThan(720)})
 it('屋根の下は一日じゅう屋根、夜は日没後',()=>{const e=new ShadeEngine([],[],AREA_CENTER),tl=e.timeline('r',AREA_CENTER,true,'2026-11-10',360,1140,60);expect(tl.states.filter(s=>s==='roof').length).toBeGreaterThan(8);expect(tl.states.at(-1)).toBe('night')})
})

