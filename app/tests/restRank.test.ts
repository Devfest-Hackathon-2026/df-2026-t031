import {describe,it,expect} from 'vitest'
import {rankRestSpots,wishReason,restReasons,walkLimit,REST_RANK_MODEL,type RestItem} from '../src/domain/restRank.ts'
import {DEFAULT_NEED,type RestNeed} from '../src/domain/restNeed.ts'
import {validateSaved,EMPTY} from '../src/lib/storage.ts'
import {predictSeat} from '../src/domain/seat.ts'
import type {Spot,ShadeState} from '../src/domain/types.ts'

const spot=(id:string,o:Partial<Spot>={}):Spot=>({id,kind:'bench',name:id,position:{lat:35.45,lng:139.63},origin:'osm',seats:null,roof:'unknown',roofSource:null,backrest:'unknown',wheelchair:'unknown',...o} as Spot)
const item=(id:string,o:Partial<RestItem>={},s:Partial<Spot>={}):RestItem=>({spot:spot(id,s),walkMin:5,arriveMin:900,shade:'sun' as ShadeState,seat:.6,toiletM:Infinity,waterM:Infinity,reports:[],...o})
const need=(o:Partial<RestNeed>={}):RestNeed=>({...DEFAULT_NEED,...o})
const ctx={wbgt:22,cold:false}

describe('休憩候補の順位付け（RC-3）',()=>{
 it('同じ入力なら必ず同じ順位（同点は近い順、次に id）',()=>{const items=[item('b'),item('a'),item('c',{walkMin:3})];const n=need({fatigue:'slight',available:30}),a=rankRestSpots(items,n,ctx).map(r=>r.item.spot.id),b=rankRestSpots([...items].reverse(),n,ctx).map(r=>r.item.spot.id);expect(a).toEqual(b);expect(a).toEqual(['c','a','b'])})
 it('疲れているほど歩ける上限が短く、休める時間（片道は3割）でも上限が決まる',()=>{expect(walkLimit(need({fatigue:'slight',available:30}))).toBe(8);expect(walkLimit(need({fatigue:'heavy',available:30}))).toBe(8);expect(walkLimit(need({fatigue:'limit',available:30}))).toBe(5);expect(walkLimit(need({fatigue:'slight',available:5}))).toBeLessThan(5)
  const r=rankRestSpots([item('near',{walkMin:4}),item('far',{walkMin:12,seat:.95})],need({fatigue:'heavy',available:30}),ctx);expect(r.map(x=>x.item.spot.id)).toEqual(['near'])})
 it('上限の中に候補がないときは、近い順に出す（空にしない）',()=>{const r=rankRestSpots([item('a',{walkMin:20}),item('b',{walkMin:14})],need({fatigue:'limit'}),ctx);expect(r.length).toBe(2)})
 it('「できれば」の希望を満たすほど上に、暑い日は日陰を上に',()=>{const r=rankRestSpots([item('plain'),item('roof',{},{roof:'yes'})],need({fatigue:'slight',available:30,wishes:['roof']}),ctx);expect(r[0].item.spot.id).toBe('roof')
  const h=rankRestSpots([item('sun'),item('shade',{shade:'building'})],need({fatigue:'slight',available:30}),{wbgt:29,cold:false});expect(h[0].item.spot.id).toBe('shade')})
})
describe('必須／できれば（RC-2）と未確認（RC-4）',()=>{
 it('必須の希望を満たさないとはっきりしている地点は外し、未確認なら下げて残す',()=>{const n=need({fatigue:'slight',available:30,wishes:['backrest'],must:['backrest']})
  const r=rankRestSpots([item('no',{},{backrest:'no'}),item('unk'),item('yes',{},{backrest:'yes'})],n,ctx);expect(r.map(x=>x.item.spot.id)).toEqual(['yes','unk']);expect(r[1].mustUnknown).toBe(true)})
 it('段差なしが未確認の地点を「段差なし」と表示しない',()=>{const w=wishReason('barrierFree',item('x'));expect(w.ok).toBeNull();expect(w.status).toBe('unknown');expect(w.label).toContain('未確認');expect(wishReason('barrierFree',item('y',{},{wheelchair:'yes'})).label).toBe('段差なし')})
 it('予測・確認済み・投稿を区別して理由を返す',()=>{const rs=restReasons(item('x',{toiletM:80,reports:[{value:'sat',minutesAgo:5}]},{roof:'yes'}),need({wishes:['toilet','roof']}));const by=(k:string)=>rs.find(r=>r.key===k)!
  expect(by('shade').status).toBe('estimated');expect(by('toilet').status).toBe('confirmed');expect(by('roof').status).toBe('confirmed');expect(by('sat').status).toBe('report')})
 it('ユーザー登録の地点の設備は「投稿」（未検証）として扱う',()=>{expect(wishReason('roof',item('u',{},{origin:'user',roof:'yes'})).status).toBe('report')})
})
describe('設備が使えなかった（RC-6）',()=>{
 it('24時間以内の「設備が使えなかった」投稿で順位を下げ、理由に出す',()=>{const r=rankRestSpots([item('bad',{reports:[{value:'facility',minutesAgo:30}]}),item('ok')],need({fatigue:'slight',available:30}),ctx);expect(r[0].item.spot.id).toBe('ok');expect(r[1].reasons.some(x=>x.key==='facility')).toBe(true);expect(REST_RANK_MODEL.facility).toBeGreaterThan(0)})
 it('「設備が使えなかった」は空席の計算に使わず、保存・復元できる',()=>{const now=new Date('2026-08-14T05:00:00Z'),s=spot('s'),base={spot:s,time:now,now,dayType:'weekday' as const,weather:{temperatureC:30,condition:'clear' as const,precipitationProbability:0,humidity:60,windSpeed:2,solarRadiation:null},wbgt:27,shade:'building' as ShadeState,events:[],location:{multiplier:1,nearest:null},reports:[]}
  const a=predictSeat(base as never),b=predictSeat({...base,reports:[{id:'1',spotId:'s',value:'facility',reportedAt:now.toISOString(),origin:'local'}]} as never);expect(b.combined).toBeCloseTo(a.combined)
  const d={...structuredClone(EMPTY),reports:[{id:'1',spotId:'s',value:'facility' as const,reportedAt:new Date().toISOString(),origin:'local' as const}]};expect(validateSaved(d).reports[0].value).toBe('facility')})
 it('屋内休憩所と冷房などの項目を保存でき、古いデータも読める',()=>{const d={...structuredClone(EMPTY),spots:[{...spot('user:1',{origin:'user',kind:'indoor',cooling:'yes',stepFree:'unknown'}),position:{lat:35.455,lng:139.635}}]};const v=validateSaved(d);expect(v.spots[0].kind).toBe('indoor');expect(v.spots[0].cooling).toBe('yes');expect(validateSaved({version:1,favorites:[],reports:[],spots:[],flags:[]}).spots).toEqual([])})
})
