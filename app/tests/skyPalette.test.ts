import {describe,it,expect} from 'vitest'
import {skyPalette} from '../src/domain/skyPalette.ts'

const rgb=(c:string)=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16))
const lightness=(c:string)=>rgb(c).reduce((a,b)=>a+b,0)
describe('時刻による空と光の色',()=>{
 it('昼は明るく、夜は濃紺（青が赤より強く暗い）',()=>{const day=skyPalette(40),night=skyPalette(-20);expect(lightness(day.sky)).toBeGreaterThan(lightness(night.sky)*3);const [r,,b]=rgb(night.sky);expect(b).toBeGreaterThan(r);expect(night.sunIntensity).toBe(0);expect(day.tintOpacity).toBe(0)})
 it('日の出・日没の前後は橙寄り（赤が青より強い）',()=>{for(const alt of [0,3]){const [r,,b]=rgb(skyPalette(alt).sun);expect(r).toBeGreaterThan(b+60)}const [r,,b]=rgb(skyPalette(1).sky);expect(r).toBeGreaterThan(b)})
 it('高度を少し変えても色が急に変わらない（なめらかにつながる）',()=>{for(let a=-14;a<20;a+=.5){const p=skyPalette(a),q=skyPalette(a+.5);const diff=rgb(p.sky).reduce((s,v,i)=>s+Math.abs(v-rgb(q.sky)[i]),0);expect(diff).toBeLessThan(60);expect(Math.abs(p.hemiIntensity-q.hemiIntensity)).toBeLessThan(.2)}})
})
