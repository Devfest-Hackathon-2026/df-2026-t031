import {describe,it,expect} from 'vitest'
import {maxWalkFor,wantMatches,careBonus,restNudge} from '../src/domain/care.ts'
import type {Spot} from '../src/domain/types.ts'

const spot=(o:Partial<Spot>={}):Spot=>({id:'s',kind:'bench',name:'s',position:{lat:35.45,lng:139.63},origin:'osm',seats:null,roof:'unknown',roofSource:null,backrest:'unknown',wheelchair:'unknown',...o} as Spot)
describe('いまの状態に合わせた候補',()=>{
 it('疲れているほど歩く上限を短くし、メニューの上限は超えない',()=>{expect(maxWalkFor('ok',20)).toBe(20);expect(maxWalkFor('tired',20)).toBe(15);expect(maxWalkFor('very',20)).toBe(8);expect(maxWalkFor('tired',10)).toBe(10)})
 it('希望ごとに合うかを返し、情報がないものは合うにしない',()=>{const m=wantMatches(spot({roof:'yes',backrest:'unknown'}),'building',90,['shade','roof','backrest','toilet','stepFree']);expect(m.map(x=>x.ok)).toEqual([true,true,false,true,false]);expect(wantMatches(spot(),'sun',500,['shade','toilet']).map(x=>x.ok)).toEqual([false,false])})
 it('希望に合う数だけ順位を上げる',()=>{expect(careBonus([{ok:true},{ok:true},{ok:false}])).toBeCloseTo(.5);expect(careBonus([])).toBe(0)})
})
describe('休憩のきっかけ（目安）',()=>{
 it('暑さ指数が高く歩いた時間が長いと休憩をすすめ、涼しく短いときはすすめない',()=>{expect(restNudge({walkedMin:20,wbgt:29,fatigue:'ok'})!.level).toBe('warn');expect(restNudge({walkedMin:20,wbgt:29,fatigue:'ok'})!.text).toContain('厳重警戒');expect(restNudge({walkedMin:30,wbgt:26,fatigue:'ok'})!.level).toBe('info');expect(restNudge({walkedMin:10,wbgt:18,fatigue:'ok'})).toBeNull()})
 it('かなり疲れているときは、暑さに関係なく座って休むようすすめる',()=>{const n=restNudge({walkedMin:0,wbgt:15,fatigue:'very'})!;expect(n.level).toBe('warn');expect(n.text).toContain('無理をせず')})
 it('診断の言葉を使わない（「目安」と書く）',()=>{expect(restNudge({walkedMin:40,wbgt:30,fatigue:'ok'})!.text).toContain('目安')})
})
