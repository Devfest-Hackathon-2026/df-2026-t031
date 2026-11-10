import {describe,it,expect} from 'vitest'
import {weatherShade,isShaded,OVERCAST} from '../src/domain/shade.ts'
import {skyPalette,weatherPalette} from '../src/domain/skyPalette.ts'
import {arrivalReason} from '../src/domain/arrival.ts'
import {validateSaved,EMPTY} from '../src/lib/storage.ts'

describe('天気を日陰に反映',()=>{
 it('くもり・雨・霧・雪は日なたも「くもり（日差しなし）」にし、日陰として扱う',()=>{for(const c of ['cloudy','rain','heavy-rain','fog','snow'] as const){expect(weatherShade('sun',c)).toBe('cloud')}expect(isShaded('cloud')).toBe(true)})
 it('晴れ・晴れ時々くもりはそのまま。屋根・夜は天気で変えない',()=>{expect(weatherShade('sun','clear')).toBe('sun');expect(weatherShade('sun','partly-cloudy')).toBe('sun');expect(weatherShade('night','rain')).toBe('night');expect(weatherShade('roof','cloudy')).toBe('roof');expect(weatherShade('building','rain')).toBe('cloud');expect(weatherShade('building','clear')).toBe('building');expect(OVERCAST.has('partly-cloudy')).toBe(false)})
 it('理由文と保存データがくもりを扱える',()=>{expect(arrivalReason({shade:'cloud',preferShade:true,seat:.8,walkMin:3})).toContain('くもり');const d={...structuredClone(EMPTY),reports:[{id:'1',spotId:'s',value:'sat' as const,reportedAt:new Date().toISOString(),origin:'local' as const,features:{hour:12,dayType:'weekday' as const,temperatureC:20,wbgt:null,condition:'cloudy' as const,shade:'cloud' as const,roof:false,aiProbability:.5}}]};expect(validateSaved(d).reports[0].features?.shade).toBe('cloud')})
})
describe('天気で街の明るさを変える',()=>{
 const noon=skyPalette(40)
 it('くもりは日差しを弱め、影を出さず、空を灰色に寄せる',()=>{const p=weatherPalette(noon,'cloudy');expect(p.sunIntensity).toBeLessThan(noon.sunIntensity*.2);expect(p.look.shadows).toBe(false);expect(p.sky).not.toBe(noon.sky)})
 it('雨はくもりより暗く、雨粒を出す。強い雨はさらに暗い',()=>{const c=weatherPalette(noon,'cloudy'),r=weatherPalette(noon,'rain'),h=weatherPalette(noon,'heavy-rain');expect(r.exposure).toBeLessThan(c.exposure);expect(h.exposure).toBeLessThan(r.exposure);expect(r.look.precip).toBe('rain');expect(h.look.precipAmount).toBeGreaterThan(r.look.precipAmount)})
 it('晴れは時刻の色のまま',()=>{const p=weatherPalette(noon,'clear');expect(p.sunIntensity).toBe(noon.sunIntensity);expect(p.sky).toBe(noon.sky);expect(p.look.precip).toBeNull()})
})
