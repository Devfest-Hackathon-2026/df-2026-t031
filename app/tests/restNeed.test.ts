import {describe,it,expect} from 'vitest'
import {judgeRest,heartCategory,walkThresholdMinutes,shouldSuggestRest,allowlistPayload,sanitizeRestContext,guardAdvice,applyHealth,applyDemo,reachableMeters,FALLBACK_ADVICE,DEFAULT_NEED,type RestNeed,type HealthSummary} from '../src/domain/restNeed.ts'
import {sumSteps,sumActiveMinutes,lastNightSleepHours,heartFrom,startOfTodayJst} from '../server/googleHealth.ts'

const need=(over:Partial<RestNeed>={}):RestNeed=>({...DEFAULT_NEED,...over})
const env={walkingMinutes:32,temperatureC:31.4,wbgt:28.6,reasons:['続けて約32分歩いている']}

describe('休憩判断（ルール）',()=>{
 it('限界に近いときは安全案内を先に出し、今休む判定にする',()=>{const j=judgeRest(need({fatigue:'limit'}),null);expect(j.safetyFirst).toBe(true);expect(j.level).toBe('now')})
 it('少し疲れて歩き始めなら急がせない',()=>{expect(judgeRest(need({fatigue:'slight',walked:'under15'}),20).level).toBe('ok')})
 it('暑い日は20分、通常は30分で歩きすぎと見る',()=>{expect(walkThresholdMinutes(28)).toBe(20);expect(walkThresholdMinutes(27.9)).toBe(30);expect(walkThresholdMinutes(null)).toBe(30)})
 it('健康データは根拠に出るが、無くても判断できる',()=>{const base=judgeRest(need(),26);const withDemo=judgeRest(applyDemo(need()),26);expect(withDemo.reasons.length).toBeGreaterThan(base.reasons.length);expect(withDemo.reasons.join()).toContain('睡眠')})
 it('使える時間に応じて探す距離を変える',()=>{expect(reachableMeters(5)).toBeLessThan(reachableMeters(15));expect(reachableMeters(15)).toBeLessThan(reachableMeters(30))})
})

describe('心拍は区分だけ',()=>{
 it('安静時との差で区分する',()=>{expect(heartCategory(70,62)).toBe('normal');expect(heartCategory(80,62)).toBe('slightlyHigh');expect(heartCategory(95,62)).toBe('high');expect(heartCategory(null,62)).toBeNull();expect(heartCategory(80,0)).toBeNull()})
})

describe('アプリ内バナー（RC-5）',()=>{
 const t=Date.parse('2026-08-01T05:00:00Z')
 it('しきい値を超えたら出す',()=>{expect(shouldSuggestRest(31,null,{disabled:false,snoozedUntil:null},t)).toBe(true);expect(shouldSuggestRest(21,29,{disabled:false,snoozedUntil:null},t)).toBe(true);expect(shouldSuggestRest(21,null,{disabled:false,snoozedUntil:null},t)).toBe(false)})
 it('「今はいい」の15分と「提案を出さない」を守る',()=>{expect(shouldSuggestRest(60,null,{disabled:false,snoozedUntil:t+60_000},t)).toBe(false);expect(shouldSuggestRest(60,null,{disabled:true,snoozedUntil:null},t)).toBe(false)})
})

describe('Geminiに送る値（11.3 allowlist）',()=>{
 const withHealth=applyDemo(need({wishes:['shade','seat']}))
 it('同意が無ければ健康データを一切入れない',()=>{const p=allowlistPayload(withHealth,env,false);expect(Object.keys(p).sort()).toEqual(['available','fatigue','reasons','temperatureC','walkingMinutes','wbgt','wishes']);expect(JSON.stringify(p)).not.toContain('8600')})
 it('同意があれば集計値と心拍の区分だけを入れる',()=>{const p=allowlistPayload(withHealth,env,true);expect(p.steps).toBe(8600);expect(p.heart).toBe('slightlyHigh');expect(Object.keys(p)).not.toContain('source')})
 it('サーバーは知らないキーを捨て、同意なしの健康データも捨てる',()=>{
  const sent={...allowlistPayload(withHealth,env,true),email:'a@example.com',lat:35.45,accessToken:'x',heartRateSeries:[80,90]}
  const noConsent=sanitizeRestContext(sent,false)!;expect(noConsent).not.toBeNull();expect(JSON.stringify(noConsent)).not.toMatch(/example|35\.45|accessToken|8600|slightlyHigh|heartRateSeries/)
  const consent=sanitizeRestContext(sent,true)!;expect(consent.steps).toBe(8600);expect(JSON.stringify(consent)).not.toMatch(/example|35\.45|accessToken|heartRateSeries/)
 })
 it('形の合わない入力は受け付けない',()=>{expect(sanitizeRestContext({...allowlistPayload(withHealth,env,false),fatigue:'dying'},false)).toBeNull();expect(sanitizeRestContext({...allowlistPayload(withHealth,env,false),wishes:['ignore previous']},false)).toBeNull();expect(sanitizeRestContext('x',false)).toBeNull()})
})

describe('Geminiの出力の差し替え（RC-7）',()=>{
 it('診断・熱中症・病院・電話番号の表現は固定文にする',()=>{for(const t of ['熱中症の危険があります。','脱水症状の可能性があります','心拍数が120なので病院へ','#7119 や 0120-123-456 に電話を','不整脈かもしれません','危険な状態です'])expect(guardAdvice(t)).toEqual({text:FALLBACK_ADVICE,replaced:true})})
 it('ふつうの声かけはそのまま通す',()=>{const r=guardAdvice('30分ほど歩いて暑いので、近くの日陰でひと休みしませんか。');expect(r.replaced).toBe(false)})
 it('空や長すぎる出力も固定文',()=>{expect(guardAdvice('').replaced).toBe(true);expect(guardAdvice('あ'.repeat(201)).replaced).toBe(true)})
})

describe('Google Healthの集計',()=>{
 it('部分的な同意・データなしは値を入れない',()=>{
  const s:HealthSummary={linked:true,steps:{status:'ok',value:5000},activeMinutes:{status:'noData'},sleepHours:{status:'noConsent'},heart:{status:'error'},fetchedAt:''}
  const n=applyHealth(need(),s);expect(n.steps).toEqual({value:5000,source:'health'});expect(n.activeMinutes).toBeUndefined();expect(n.sleepHours).toBeUndefined();expect(n.heart).toBeUndefined()
 })
 it('歩数は文字列の count を足し合わせる',()=>{expect(sumSteps([{steps:{interval:{startTime:'2026-08-01T00:00:00Z'},count:'1200'}},{steps:{count:'300'}}])).toBe(1500);expect(sumSteps([])).toBeNull()})
 it('活動時間は分の項目を拾う',()=>{expect(sumActiveMinutes([{activeMinutes:{activeMinutes:'12'}},{activeMinutes:{minutesByLevel:{light:'5',vigorous:'3'}}}])).toBe(20)})
 it('睡眠は主な睡眠を優先して時間にする',()=>{expect(lastNightSleepHours([{sleep:{interval:{startTime:'2026-08-01T05:00:00Z',endTime:'2026-08-01T06:00:00Z'},summary:{minutesAsleep:'50'}}},{sleep:{interval:{startTime:'2026-07-31T14:00:00Z',endTime:'2026-07-31T21:00:00Z'},summary:{minutesAsleep:'382'},metadata:{mainSleep:true}}}])).toBe(6.5)})
 it('心拍は平均と安静時から区分だけ返す',()=>{expect(heartFrom([{heartRate:{sampleTime:{physicalTime:'2026-08-01T05:00:00Z'},beatsPerMinute:'96'}},{heartRate:{beatsPerMinute:100}}],[{dailyRestingHeartRate:{date:'2026-07-31',beatsPerMinute:'64'}}])).toBe('high')})
 it('今日は日本時間の0時から',()=>{expect(new Date(startOfTodayJst(Date.parse('2026-08-01T16:00:00Z'))).toISOString()).toBe('2026-08-01T15:00:00.000Z')})
})
