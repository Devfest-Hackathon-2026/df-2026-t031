import {describe,it,expect} from 'vitest'
import {seatLevel,nearestDistanceMap,TOILET_NEAR_M} from '../src/domain/seat.ts'
import type {Spot} from '../src/domain/types.ts'

const spot=(id:string,kind:Spot['kind'],lat:number,lng:number):Spot=>({id,kind,name:id,position:{lat,lng},origin:'osm',seats:null,roof:'unknown',roofSource:null,backrest:'unknown',wheelchair:'unknown'} as Spot)
describe('ピンの色分けと絞り込み',()=>{
 it('空席確率を 緑（70%以上）・黄（40%以上）・赤 の3段階に分ける',()=>{expect(seatLevel(.7)).toBe('high');expect(seatLevel(.69)).toBe('mid');expect(seatLevel(.4)).toBe('mid');expect(seatLevel(.39)).toBe('low')})
 it('いちばん近いトイレまでの距離を求め、トイレがなければ Infinity',()=>{const bench=spot('b','bench',35.45,139.63),near=spot('t1','toilet',35.4509,139.63),far=spot('t2','toilet',35.46,139.63)
  const m=nearestDistanceMap([bench,near],[near,far]);expect(m.get('b')!).toBeGreaterThan(90);expect(m.get('b')!).toBeLessThan(TOILET_NEAR_M);expect(m.get('t1')).toBe(0);expect(nearestDistanceMap([bench],[]).get('b')).toBe(Infinity)})
})
