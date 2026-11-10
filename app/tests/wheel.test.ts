import {describe,it,expect} from 'vitest'
import {makeWheelClassifier} from '../src/lib/wheel.ts'
const ev=(o:Partial<{deltaX:number;deltaY:number;deltaMode:number;ctrlKey:boolean;timeStamp:number}>)=>({deltaX:0,deltaY:0,deltaMode:0,ctrlKey:false,timeStamp:0,...o})
describe('ホイール操作の見分け（Windows の二本指スライド）',()=>{
 it('トラックパッドの二本指スライド（小さな値・横方向）は移動',()=>{const c=makeWheelClassifier();expect(c(ev({deltaY:6}))).toBe('pan');expect(c(ev({deltaX:-12,deltaY:0,timeStamp:1000}))).toBe('pan')})
 it('ピンチ（ctrlKey 付き）は拡大・縮小',()=>{expect(makeWheelClassifier()(ev({deltaY:3,ctrlKey:true}))).toBe('zoom')})
 it('マウスのホイール（1 目盛り 100、または行単位）は拡大・縮小',()=>{const c=makeWheelClassifier();expect(c(ev({deltaY:100}))).toBe('zoom');expect(c(ev({deltaY:-120,timeStamp:2000}))).toBe('zoom');expect(c(ev({deltaY:3,deltaMode:1,timeStamp:4000}))).toBe('zoom')})
 it('二本指スライドの途中で値が大きくなっても移動のまま、しばらく止まればマウスとして扱う',()=>{const c=makeWheelClassifier();expect(c(ev({deltaY:10,timeStamp:0}))).toBe('pan');expect(c(ev({deltaY:90,timeStamp:100}))).toBe('pan');expect(c(ev({deltaY:100,timeStamp:1000}))).toBe('zoom')})
})
