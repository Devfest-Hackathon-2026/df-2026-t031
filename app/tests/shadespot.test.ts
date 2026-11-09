import {describe,it,expect} from 'vitest'
import {AREA_CENTER} from '../src/domain/area.ts'
import {LocalProjection} from '../src/domain/geo.ts'
import {ShadeEngine,COVERAGE_LABEL} from '../src/domain/shade.ts'
import {solarMoments} from '../src/domain/solarScene.ts'
import {validateSaved,EMPTY} from '../src/lib/storage.ts'
import {shiftDay} from '../src/components/EdgeScrubbers.tsx'
import type {Building,Spot} from '../src/domain/types.ts'

const proj=new LocalProjection(AREA_CENTER)
const at=(x:number,y:number)=>proj.toLatLng({x,y})
// 南に 20m 四方・高さ 20m の建物。真南から高度 45° の光なら、北側 20m まで影になる
const building:Building={id:'b',kind:'building',footprint:[at(-10,-30),at(10,-30),at(10,-10),at(-10,-10)],height:20,minHeight:0,heightSource:'measured'}
const noonSouth={altitude:45,azimuth:180}

describe('日陰の3段階（SHADE SPOT）',()=>{
 const engine=new ShadeEngine([building],[],AREA_CENTER)
 it('影の中なら「日陰の可能性高」',()=>{const c=engine.coverageAtXY({x:0,y:0},noonSouth);expect(c.level).toBe('high');expect(c.ratio).toBe(1);expect(c.state).toBe('building')})
 it('影の端なら「一部日陰」',()=>{const c=engine.coverageAtXY({x:10,y:0},noonSouth);expect(c.level).toBe('partial');expect(c.ratio).toBeGreaterThan(0);expect(c.ratio).toBeLessThan(1)})
 it('影の外なら「日なた」',()=>{const c=engine.coverageAtXY({x:60,y:0},noonSouth);expect(c.level).toBe('sun');expect(c.ratio).toBe(0)})
 it('夜と屋根の下は割合で分けない',()=>{expect(engine.coverageAtXY({x:60,y:0},{altitude:-10,azimuth:0}).level).toBe('night');expect(engine.coverageAtXY({x:60,y:0},noonSouth,true).level).toBe('roof')})
 it('表示名がそろっている',()=>{expect(COVERAGE_LABEL.high).toBe('日陰の可能性高');expect(COVERAGE_LABEL.partial).toBe('一部日陰')})
})

describe('Sunlitt風の時間帯',()=>{
 it('青い時間・黄金時間・最後の光が順番どおり',()=>{const t=solarMoments('2026-11-05',AREA_CENTER)
  expect(t.dawn!).toBeLessThan(t.blueMorningEnd!);expect(t.blueMorningEnd!).toBeLessThan(t.sunrise!);expect(t.sunrise!).toBeLessThan(t.goldenMorningEnd!)
  expect(t.goldenEveningStart!).toBeLessThan(t.sunset!);expect(t.sunset!).toBeLessThan(t.blueEveningStart!);expect(t.blueEveningStart!).toBeLessThan(t.dusk!)
  expect(t.nadir).toBe(t.noon+720);expect(t.dayLength).toBe(t.sunset!-t.sunrise!)})
 it('日付ピルの日付送りが月・年をまたぐ',()=>{expect(shiftDay('2026-11-30',1)).toBe('2026-12-01');expect(shiftDay('2027-01-01',-1)).toBe('2026-12-31')})
})

describe('ゴミ箱の投稿と通報の保存',()=>{
 const trash:Spot={id:'user:t',name:'テスト用ゴミ箱',kind:'trash',position:at(0,0),origin:'user',seats:null,roof:'unknown',roofSource:'user',backrest:'unknown',wheelchair:'unknown',note:'ペットボトル・缶',description:'店舗の利用者のみ / 使えた',createdAt:'2026-11-05T12:00:00.000Z'}
 it('捨てられる物・利用条件・確認日時を保存し直しても残す',()=>{const r=validateSaved({...EMPTY,spots:[trash]});expect(r.spots[0].note).toBe('ペットボトル・缶');expect(r.spots[0].description).toBe('店舗の利用者のみ / 使えた');expect(r.spots[0].createdAt).toBe(trash.createdAt)})
 it('通報を保存し、古いバックアップ（通報なし）も読める',()=>{const flag={id:'f',spotId:'user:t',reason:'moved',flaggedAt:'2026-11-05T12:00:00.000Z'};expect(validateSaved({...EMPTY,flags:[flag]}).flags).toEqual([flag]);const {flags:_unused,...old}=EMPTY;expect(validateSaved(old).flags).toEqual([])})
 it('不正な通報や長すぎるメモを拒否する',()=>{expect(()=>validateSaved({...EMPTY,flags:[{id:'f',spotId:'s',reason:'other',flaggedAt:'2026-11-05T12:00:00.000Z'}]})).toThrow();expect(()=>validateSaved({...EMPTY,spots:[{...trash,note:'x'.repeat(500)}]})).toThrow()})
})
