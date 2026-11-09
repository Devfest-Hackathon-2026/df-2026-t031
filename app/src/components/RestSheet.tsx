import {useEffect,useMemo,useState} from 'react'
import {ShieldAlert,HeartPulse,Sparkles,MapPin,Link2,Unlink,FlaskConical,Info} from 'lucide-react'
import {FATIGUE_LABEL,WALKED_LABEL,AVAILABLE_OPTIONS,WISH_LABEL,WISHES,SOURCE_LABEL,HEART_LABEL,MEDICAL_NOTICE,SAFETY_GUIDANCE,REST_LEVEL_LABEL,DEFAULT_NEED,judgeRest,applyDemo,applyHealth,allowlistPayload,reachableMeters,type RestNeed,type Fatigue,type WalkedBand,type AvailableMinutes,type RestWish,type HealthSummary,type Sourced} from '../domain/restNeed.ts'
import {apiUrl} from '../lib/api.ts'
import type {RestPrefs} from '../lib/restPrefs.ts'

/** Google ログインの状態（サーバーの /api/auth/status。トークンはサーバーから出ない） */
export interface GoogleStatus{configured:boolean;connected:boolean;name:string|null;granted:HealthKey[]}
export type HealthKey='activity'|'sleep'|'heart'
const HEALTH_ITEMS:{key:HealthKey;label:string;note:string}[]=[{key:'activity',label:'歩数・活動時間',note:'今日の合計だけ'},{key:'sleep',label:'睡眠時間',note:'昨夜の合計だけ'},{key:'heart',label:'心拍',note:'平常との比較の区分だけ（数値は出しません）'}]

export async function fetchGoogleStatus():Promise<GoogleStatus|null>{
 try{const r=await fetch(apiUrl('/api/auth/status'),{signal:AbortSignal.timeout(8000)});if(!r.headers.get('content-type')?.includes('application/json'))return null;return await r.json()}catch{return null}
}
export async function disconnectGoogle(){const r=await fetch(apiUrl('/api/auth/logout'),{method:'POST',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('接続を解除できませんでした。')}

const Tag=({source}:{source:Sourced<unknown>['source']})=><span className={'source-tag '+source}>{SOURCE_LABEL[source]}</span>

/** 休憩判断のシート（RC-1・RC-7）。ルール判断が主で、Gemini は任意のひと言だけ */
export function RestSheet({wbgt,temperatureC,walkingMinutes,prefs,setPrefs,google,onGoogleChange,onShowSpots,notify}:{wbgt:number|null;temperatureC:number|null;walkingMinutes:number;prefs:RestPrefs;setPrefs:(p:RestPrefs)=>void;google:GoogleStatus|null;onGoogleChange:()=>void;onShowSpots:(need:RestNeed)=>void;notify:(m:string)=>void}){
 const [need,setNeed]=useState<RestNeed>(()=>({...DEFAULT_NEED,wishes:prefs.lastWishes}))
 const [items,setItems]=useState<HealthKey[]>(['activity','sleep','heart']),[loading,setLoading]=useState(false),[advice,setAdvice]=useState<{text:string;replaced:boolean}|null>(null),[asking,setAsking]=useState(false)
 const judgement=useMemo(()=>judgeRest(need,wbgt,walkingMinutes),[need,wbgt,walkingMinutes])
 const hasHealth=!!(need.steps||need.activeMinutes||need.sleepHours||need.heart)
 const set=<K extends keyof RestNeed>(k:K,v:RestNeed[K])=>{setNeed(n=>({...n,[k]:v}));setAdvice(null)}
 const toggleWish=(w:RestWish)=>set('wishes',need.wishes.includes(w)?need.wishes.filter(x=>x!==w):[...need.wishes,w])
 const clearHealth=()=>{setNeed(n=>({fatigue:n.fatigue,walked:n.walked,available:n.available,wishes:n.wishes}));setAdvice(null)}
 const loadHealth=async()=>{setLoading(true);try{const r=await fetch(apiUrl('/api/google-health/summary'),{signal:AbortSignal.timeout(20000)});const body=await r.json().catch(()=>({}));if(!r.ok){if(r.status===401)onGoogleChange();throw Error(body.error||'Google Healthから読み取れませんでした。')}
  const s=body as HealthSummary;if(!s.linked){notify('Google Healthにデータがありません（Fitbit等の連携が必要です）。手入力で続けられます。');return}
  const next=applyHealth(need,s);setNeed(next);setAdvice(null);const got=['steps','activeMinutes','sleepHours','heart'].filter(k=>next[k as keyof RestNeed]).length;notify(got?`Google Healthから${got}項目を読み込みました。`:'今日の値はまだありませんでした。手入力で続けられます。')}
  catch(e){notify(e instanceof Error?e.message:'読み取れませんでした。')}finally{setLoading(false)}}
 useEffect(()=>{if(google?.connected&&!hasHealth)void loadHealth()},[google?.connected]) // eslint-disable-line react-hooks/exhaustive-deps
 const connect=()=>{if(!items.length){notify('読み取る項目を1つ以上選んでください。');return}location.href=apiUrl('/api/auth/google/start?items='+items.join(','))}
 const ask=async()=>{setAsking(true);try{const consent=prefs.healthConsent&&hasHealth;const r=await fetch(apiUrl('/api/explain'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'rest',rest:allowlistPayload(need,{walkingMinutes,temperatureC,wbgt,reasons:judgement.reasons},consent),healthConsent:consent}),signal:AbortSignal.timeout(20000)});if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Geminiは未接続です。上の判断はそのまま使えます。');const body=await r.json();if(!r.ok)throw Error(body.error||'ひと言を作れませんでした。');setAdvice({text:body.text,replaced:!!body.replaced})}catch(e){notify(e instanceof Error?e.message:'ひと言を作れませんでした。')}finally{setAsking(false)}}
 const show=()=>{setPrefs({...prefs,lastWishes:need.wishes,log:[...prefs.log,{at:Date.now(),action:'accept'}]});onShowSpots(need)}
 return <div className="modal-body rest-sheet">
  {judgement.safetyFirst?<p className="rest-safety" role="alert"><ShieldAlert size={18}/><span>{SAFETY_GUIDANCE}</span></p>:null}
  <section className="setting-section"><h3>いまの状態</h3>
   <fieldset className="chip-field"><legend>疲れ</legend><div className="chip-row">{(Object.keys(FATIGUE_LABEL) as Fatigue[]).map(f=><button key={f} aria-pressed={need.fatigue===f} onClick={()=>set('fatigue',f)}>{FATIGUE_LABEL[f]}</button>)}</div></fieldset>
   <fieldset className="chip-field"><legend>歩いた時間 <small>アプリを開いてから約{walkingMinutes}分</small></legend><div className="chip-row">{(Object.keys(WALKED_LABEL) as WalkedBand[]).map(w=><button key={w} aria-pressed={need.walked===w} onClick={()=>set('walked',w)}>{WALKED_LABEL[w]}</button>)}</div></fieldset>
   <fieldset className="chip-field"><legend>休める時間</legend><div className="chip-row">{AVAILABLE_OPTIONS.map(a=><button key={a} aria-pressed={need.available===a} onClick={()=>set('available',a as AvailableMinutes)}>{a}分</button>)}</div></fieldset>
   <fieldset className="chip-field"><legend>ほしいもの <small>いくつでも</small></legend><div className="chip-row">{WISHES.map(w=><button key={w} aria-pressed={need.wishes.includes(w)} onClick={()=>toggleWish(w)}>{WISH_LABEL[w]}</button>)}</div></fieldset>
  </section>
  <section className="setting-section"><h3><HeartPulse size={17}/>健康データ <small>任意・なくても判断できます</small></h3>
   {hasHealth?<ul className="health-values">{need.steps?<li>歩数 <b>{need.steps.value.toLocaleString()}歩</b><Tag source={need.steps.source}/></li>:null}{need.activeMinutes?<li>活動時間 <b>{need.activeMinutes.value}分</b><Tag source={need.activeMinutes.source}/></li>:null}{need.sleepHours?<li>睡眠 <b>{need.sleepHours.value}時間</b><Tag source={need.sleepHours.source}/></li>:null}{need.heart?<li>心拍 <b>{HEART_LABEL[need.heart.value]}</b><Tag source={need.heart.source}/></li>:null}</ul>:<p className="field-note">健康データは使っていません。上の手入力だけで判断します。</p>}
   <div className="button-row"><button onClick={()=>{setNeed(n=>applyDemo(n));setAdvice(null)}}><FlaskConical size={14}/>デモ値を入れる</button>{google?.connected?<button disabled={loading} onClick={()=>void loadHealth()}>{loading?'読み込み中…':'Google Healthから再読み込み'}</button>:null}{hasHealth?<button onClick={clearHealth}>健康データを外す</button>:null}</div>
   {google?.connected?<p className="field-note">Google（{google.name||'接続中'}）から {google.granted.map(k=>HEALTH_ITEMS.find(i=>i.key===k)?.label).join('・')||'項目なし'} を読み取れます。解除は設定から。</p>
   :<details className="google-connect"><summary><Link2 size={14}/>Googleでログインして Google Health から読み込む</summary>
    {google?.configured===false||google===null?<p className="field-note">{google===null?'サーバーに接続できません（ローカルでは npm run dev:all で起動）。':'このサーバーではGoogleログインが未設定です（GOOGLE_OAUTH_CLIENT_ID）。'}デモ値か手入力で試せます。</p>:<>
    <ul className="consent-list"><li><b>使い道</b>：この画面の休憩判断と、Geminiのひと言（下で同意したときだけ）</li><li><b>読み取るもの</b>：選んだ項目の当日の集計値だけ。位置・心拍の時系列は読みません</li><li><b>保存</b>：アプリにもサーバーにも健康データは保存しません。ログインの鍵はサーバーのメモリにだけ置き、最長8時間で消えます</li><li><b>解除</b>：設定の「Googleとの接続を解除」でいつでも取り消せます</li></ul>
    {HEALTH_ITEMS.map(i=><label key={i.key} className="check-row"><input type="checkbox" checked={items.includes(i.key)} onChange={e=>setItems(v=>e.target.checked?[...v,i.key]:v.filter(k=>k!==i.key))}/>{i.label}<small>（{i.note}）</small></label>)}
    <div className="button-row"><button className="primary" onClick={connect}><Link2 size={14}/>同意してGoogleでログイン</button></div></>}
   </details>}
   {hasHealth?<label className="check-row"><input type="checkbox" checked={prefs.healthConsent} onChange={e=>setPrefs({...prefs,healthConsent:e.target.checked})}/>Geminiのひと言に健康データ（集計値と心拍の区分）を使ってよい</label>:null}
  </section>
  <section className={'rest-result level-'+judgement.level} aria-live="polite"><h3>{REST_LEVEL_LABEL[judgement.level]}</h3>
   <ul>{judgement.reasons.map(r=><li key={r}>{r}</li>)}</ul>
   {advice?<p className="rest-advice"><Sparkles size={14}/>{advice.text}{advice.replaced?<small>（安全のため定型文に置き換えました）</small>:null}</p>:null}
   <div className="button-row"><button className="primary" onClick={show}><MapPin size={14}/>{reachableMeters(need.available)}m以内の候補を見る</button><button disabled={asking} onClick={()=>void ask()}><Sparkles size={14}/>{asking?'考え中…':'Geminiのひと言'}</button></div>
   <p className="medical-notice"><Info size={13}/>{MEDICAL_NOTICE}。判断はこの画面の入力と推定値（暑さ指数 {wbgt??'—'}）によるものです。</p>
  </section>
 </div>
}

/** 設定画面の「休憩の提案とGoogle」欄 */
export function RestSettings({prefs,setPrefs,google,onGoogleChange,notify,onWalkDemo}:{prefs:RestPrefs;setPrefs:(p:RestPrefs)=>void;google:GoogleStatus|null;onGoogleChange:()=>void;notify:(m:string)=>void;onWalkDemo:()=>void}){
 const [busy,setBusy]=useState(false)
 const off=async()=>{setBusy(true);try{await disconnectGoogle();notify('Googleとの接続を解除しました。読み込んだ値も画面から消えます。');onGoogleChange()}catch(e){notify(e instanceof Error?e.message:'解除できませんでした。')}finally{setBusy(false)}}
 return <section className="setting-section"><h3><HeartPulse size={17}/>休憩の提案とGoogle Health</h3>
  <label className="check-row"><input type="checkbox" checked={!prefs.bannerDisabled} onChange={e=>setPrefs({...prefs,bannerDisabled:!e.target.checked,snoozedUntil:null})}/>歩き続けたら休憩を提案する（暑い日は20分、ふだんは30分）</label>
  <label className="check-row"><input type="checkbox" checked={prefs.healthConsent} onChange={e=>setPrefs({...prefs,healthConsent:e.target.checked})}/>Geminiに健康データの集計値を送ってよい</label>
  <p className="field-note">{google?.connected?`Googleに接続中（${google.name||'名前なし'}）。読み取り：${google.granted.map(k=>HEALTH_ITEMS.find(i=>i.key===k)?.label).join('・')||'なし'}`:google?.configured?'Googleには接続していません。休憩シートから接続できます。':'Googleログインはこの環境では未設定です。'}</p>
  <div className="button-row"><button onClick={onWalkDemo}>デモ：30分歩いたことにする</button>{google?.connected?<button className="danger-button" disabled={busy} onClick={()=>void off()}><Unlink size={14}/>Googleとの接続を解除</button>:null}</div>
 </section>
}
