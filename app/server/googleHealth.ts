/**
 * Google ログインと Google Health API（RC-8）。
 * OAuth はサーバーで行い、トークンはこのプロセスのメモリにだけ置く（画面・localStorage・Gemini には渡さない）。
 * 画面に返すのは「今日の歩数・活動時間・昨夜の睡眠時間・心拍の区分」の集計値だけ。時系列や生の心拍は返さない。
 */
import {createHash,randomBytes} from 'node:crypto'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {publicOrigin,secureCookie} from './hosting.ts'
import {heartCategory,type HealthItem,type HealthSummary,type HeartCategory} from '../src/domain/restNeed.ts'

const AUTH_URL='https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL='https://oauth2.googleapis.com/token'
const REVOKE_URL='https://oauth2.googleapis.com/revoke'
const HEALTH_BASE='https://health.googleapis.com/v4/users/me/dataTypes'
const SCOPE_BASE='https://www.googleapis.com/auth/googlehealth.'
/** 画面で選べる項目と、それぞれに必要な読み取り専用スコープ */
export const HEALTH_SCOPES={
 activity:SCOPE_BASE+'activity_and_fitness.readonly',
 sleep:SCOPE_BASE+'sleep.readonly',
 heart:SCOPE_BASE+'health_metrics_and_measurements.readonly',
} as const
export type HealthScopeKey=keyof typeof HEALTH_SCOPES
const SCOPE_KEYS=Object.keys(HEALTH_SCOPES) as HealthScopeKey[]
const SESSION_COOKIE='epoku_sid',STATE_COOKIE='epoku_oauth'
const SESSION_TTL=8*3600_000,PENDING_TTL=10*60_000

interface Session{access:string;refresh?:string;expiresAt:number;granted:Set<HealthScopeKey>;name:string|null;createdAt:number}
const sessions=new Map<string,Session>()
const pending=new Map<string,{verifier:string;redirectUri:string;at:number}>()

type Json=(res:ServerResponse,status:number,data:unknown)=>void
const token=()=>randomBytes(32).toString('base64url')
function cookies(req:IncomingMessage){const out:Record<string,string>={};for(const part of (req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim())}return out}
const cookie=(name:string,value:string,maxAge:number)=>`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie()?'; Secure':''}`
function redirect(res:ServerResponse,location:string,setCookie:string[]=[]){res.writeHead(302,{Location:location,'Cache-Control':'no-store','Set-Cookie':setCookie});res.end()}
export const oauthConfigured=()=>!!(process.env.GOOGLE_OAUTH_CLIENT_ID&&process.env.GOOGLE_OAUTH_CLIENT_SECRET)
/** リダイレクトURIは環境変数が優先。次に公開オリジン（Cloud Run）、無ければ今開いているホスト（127.0.0.1 / localhost）に合わせる */
function redirectUriFor(req:IncomingMessage){return process.env.GOOGLE_OAUTH_REDIRECT_URI||`${publicOrigin()||`http://${req.headers.host}`}/api/auth/google/callback`}
function sweep(){const t=Date.now();for(const [k,v] of pending)if(t-v.at>PENDING_TTL)pending.delete(k);for(const [k,v] of sessions)if(t-v.createdAt>SESSION_TTL)sessions.delete(k)}
function sessionOf(req:IncomingMessage){sweep();const sid=cookies(req)[SESSION_COOKIE];return sid?{sid,session:sessions.get(sid)}:{sid:null,session:undefined}}
function grantedFrom(scope:unknown){const list=typeof scope==='string'?scope.split(/\s+/):[];return new Set(SCOPE_KEYS.filter(k=>list.includes(HEALTH_SCOPES[k])))}
/** id_token は Google のトークンエンドポイントから TLS で直接受け取ったものなので、表示名を取り出すだけに使う（メール・IDは保持しない） */
function displayName(idToken:unknown){if(typeof idToken!=='string')return null;try{const p=JSON.parse(Buffer.from(idToken.split('.')[1]||'','base64url').toString('utf8'));const n=typeof p.given_name==='string'?p.given_name:typeof p.name==='string'?p.name:null;return n?n.slice(0,40):null}catch{return null}}

async function tokenRequest(params:Record<string,string>){
 const r=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_OAUTH_CLIENT_ID||'',client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET||'',...params}),signal:AbortSignal.timeout(15000)})
 if(!r.ok)throw Object.assign(Error('token'),{status:r.status})
 return r.json() as Promise<{access_token?:string;refresh_token?:string;expires_in?:number;scope?:string;id_token?:string}>
}
async function accessToken(s:Session){
 if(Date.now()<s.expiresAt-60_000)return s.access
 if(!s.refresh)throw Object.assign(Error('expired'),{status:401})
 const t=await tokenRequest({grant_type:'refresh_token',refresh_token:s.refresh})
 if(!t.access_token)throw Object.assign(Error('expired'),{status:401})
 s.access=t.access_token;s.expiresAt=Date.now()+(t.expires_in||3600)*1000;if(t.scope)s.granted=grantedFrom(t.scope);return s.access
}

/* ---------- Google Health のデータ点の読み取り ---------- */

class NotLinked extends Error{}
type Point=Record<string,unknown>
const isObj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const toNum=(v:unknown)=>{const n=typeof v==='string'?Number(v):v;return typeof n==='number'&&Number.isFinite(n)?n:null}
/** データ点の中身（steps / sleep / heartRate など、データ型ごとに名前が違う）を取り出す */
export function payloadOf(p:Point){for(const [k,v] of Object.entries(p))if(!['name','dataSource','metadata'].includes(k)&&isObj(v))return v;return {} as Record<string,unknown>}
const timeOf=(v:unknown)=>{const t=typeof v==='string'?Date.parse(v):NaN;return Number.isFinite(t)?t:null}
function startOf(p:Record<string,unknown>){const i=p.interval;if(isObj(i))return timeOf(i.startTime)??timeOf(i.civilStartTime);const s=p.sampleTime;if(isObj(s))return timeOf(s.physicalTime);return timeOf(p.date)}
function endOf(p:Record<string,unknown>){const i=p.interval;return isObj(i)?timeOf(i.endTime)??startOf(p):startOf(p)}

/**
 * dataPoints.list を最大5ページまで読む。filter で 400 になったときは filter なしで読み直して手元で絞る
 * （filter のフィールド名は公式例のある steps 以外は未確認のため）。
 */
async function listPoints(access:string,type:string,filter:string|null,since:number){
 const read=async(withFilter:boolean)=>{
  const out:Point[]=[];let pageToken=''
  for(let page=0;page<5;page++){
   const url=new URL(`${HEALTH_BASE}/${type}/dataPoints`);url.searchParams.set('pageSize','200');if(pageToken)url.searchParams.set('pageToken',pageToken);if(withFilter&&filter)url.searchParams.set('filter',filter)
   const r=await fetch(url,{headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(15000)})
   if(!r.ok){const text=await r.text().catch(()=>'');if(text.includes('ACCOUNT_NOT_LINKED'))throw new NotLinked();throw Object.assign(Error('health'),{status:r.status})}
   const d=await r.json() as {dataPoints?:Point[];nextPageToken?:string}
   out.push(...(d.dataPoints||[]));if(!d.nextPageToken)break;pageToken=d.nextPageToken
  }
  return out
 }
 let points:Point[]
 try{points=await read(true)}catch(e){if(filter&&(e as {status?:number}).status===400)points=await read(false);else throw e}
 return points.filter(p=>{const t=endOf(payloadOf(p));return t===null||t>=since})
}

/** 日本時間の今日0時（デモエリアが横浜のため） */
export function startOfTodayJst(now:number){const jst=new Date(now+9*3600_000);return Date.UTC(jst.getUTCFullYear(),jst.getUTCMonth(),jst.getUTCDate())-9*3600_000}
const rfc=(t:number)=>new Date(t).toISOString()

export function sumSteps(points:Point[]){let total=0,found=false;for(const p of points){const n=toNum(payloadOf(p).count);if(n!==null){total+=n;found=true}}return found?Math.round(total):null}
/** active-minutes の項目名は未確認のため、分を表しそうな数値を広めに拾う */
export function sumActiveMinutes(points:Point[]){
 let total=0,found=false
 for(const p of points){const v=payloadOf(p);let n:number|null=null;for(const k of ['activeMinutes','minutes','count','value'])if(n===null)n=toNum(v[k])
  if(n===null)for(const [k,x] of Object.entries(v))if(/minute/i.test(k)){if(isObj(x)){for(const y of Object.values(x)){const m=toNum(y);if(m!==null)n=(n??0)+m}}else{const m=toNum(x);if(m!==null)n=(n??0)+m}}
  if(n!==null){total+=n;found=true}}
 return found?Math.round(total):null
}
/** 昨夜の睡眠：主な睡眠（mainSleep）を優先し、いちばん新しいものの睡眠時間（分→時間、0.5刻み） */
export function lastNightSleepHours(points:Point[]){
 const items=points.map(p=>{const v=payloadOf(p);const meta=isObj(p.metadata)?p.metadata:isObj(v.metadata)?v.metadata:{};const summary=isObj(v.summary)?v.summary:{};const end=endOf(v),start=startOf(v);const asleep=toNum(summary.minutesAsleep)??(start!==null&&end!==null?(end-start)/60000:null);return {end:end??0,main:meta.mainSleep===true,asleep}}).filter(x=>x.asleep!==null&&x.asleep>0)
 if(!items.length)return null
 items.sort((a,b)=>Number(b.main)-Number(a.main)||b.end-a.end)
 return Math.round(items[0].asleep!/30)/2
}
export function heartFrom(recent:Point[],resting:Point[]):HeartCategory|null{
 const bpm=recent.map(p=>toNum(payloadOf(p).beatsPerMinute)).filter((n):n is number=>n!==null)
 const latest=resting.map(p=>{const v=payloadOf(p);return {t:startOf(v)??0,bpm:toNum(v.beatsPerMinute)}}).filter(x=>x.bpm!==null).sort((a,b)=>b.t-a.t)[0]
 return heartCategory(bpm.length?bpm.reduce((a,b)=>a+b,0)/bpm.length:null,latest?.bpm??null)
}

async function item<T>(granted:boolean,fn:()=>Promise<T|null>):Promise<HealthItem<T>>{
 if(!granted)return {status:'noConsent'}
 try{const value=await fn();return value===null?{status:'noData'}:{status:'ok',value}}catch(e){if(e instanceof NotLinked)throw e;return {status:'error'}}
}
export async function healthSummary(access:string,granted:Set<HealthScopeKey>,now=Date.now()):Promise<HealthSummary>{
 const today=startOfTodayJst(now),fetchedAt=new Date(now).toISOString()
 try{
  const [steps,activeMinutes,sleepHours,heart]=await Promise.all([
   item(granted.has('activity'),async()=>sumSteps(await listPoints(access,'steps',`steps.interval.start_time >= "${rfc(today)}"`,today))),
   item(granted.has('activity'),async()=>sumActiveMinutes(await listPoints(access,'active-minutes',`active_minutes.interval.start_time >= "${rfc(today)}"`,today))),
   item(granted.has('sleep'),async()=>lastNightSleepHours(await listPoints(access,'sleep',`sleep.interval.end_time >= "${rfc(now-24*3600_000)}"`,now-24*3600_000))),
   item(granted.has('heart'),async()=>heartFrom(await listPoints(access,'heart-rate',`heart_rate.sample_time.physical_time >= "${rfc(now-30*60_000)}"`,now-30*60_000),await listPoints(access,'daily-resting-heart-rate',null,now-8*86400_000))),
  ])
  return {linked:true,steps,activeMinutes,sleepHours,heart,fetchedAt}
 }catch(e){
  if(!(e instanceof NotLinked))throw e
  const none={status:'error' as const};return {linked:false,steps:none,activeMinutes:none,sleepHours:none,heart:none,fetchedAt}
 }
}

/* ---------- ルート ---------- */

/** 扱ったリクエストなら true。index.ts から呼ぶ */
export async function handleGoogleRoutes(req:IncomingMessage,res:ServerResponse,json:Json):Promise<boolean>{
 const url=new URL(req.url||'/','http://local')
 if(url.pathname==='/api/auth/status'&&req.method==='GET'){
  const {session}=sessionOf(req)
  json(res,200,{configured:oauthConfigured(),connected:!!session,name:session?.name??null,granted:session?SCOPE_KEYS.filter(k=>session.granted.has(k)):[]});return true
 }
 if(url.pathname==='/api/auth/google/start'&&req.method==='GET'){
  if(!oauthConfigured()){json(res,503,{error:'Googleログインは未接続です。サーバーのGOOGLE_OAUTH_CLIENT_IDとGOOGLE_OAUTH_CLIENT_SECRETを設定してください。'});return true}
  const wanted=(url.searchParams.get('items')||'').split(',').filter((k):k is HealthScopeKey=>SCOPE_KEYS.includes(k as HealthScopeKey))
  sweep();const state=token(),verifier=token(),redirectUri=redirectUriFor(req)
  pending.set(state,{verifier,redirectUri,at:Date.now()})
  const auth=new URL(AUTH_URL);auth.search=new URLSearchParams({client_id:process.env.GOOGLE_OAUTH_CLIENT_ID!,redirect_uri:redirectUri,response_type:'code',scope:['openid','profile',...wanted.map(k=>HEALTH_SCOPES[k])].join(' '),access_type:'offline',prompt:'consent',include_granted_scopes:'true',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString()
  redirect(res,auth.toString(),[cookie(STATE_COOKIE,state,600)]);return true
 }
 if(url.pathname==='/api/auth/google/callback'&&req.method==='GET'){
  const state=url.searchParams.get('state')||'',code=url.searchParams.get('code'),p=pending.get(state)
  const clear=cookie(STATE_COOKIE,'',0)
  if(!state||!p||cookies(req)[STATE_COOKIE]!==state){if(state)pending.delete(state);redirect(res,'/?health=state-error',[clear]);return true}
  pending.delete(state)
  if(!code){redirect(res,'/?health=denied',[clear]);return true}
  try{
   const t=await tokenRequest({grant_type:'authorization_code',code,redirect_uri:p.redirectUri,code_verifier:p.verifier})
   if(!t.access_token)throw Error('token')
   const sid=token();sessions.set(sid,{access:t.access_token,refresh:t.refresh_token,expiresAt:Date.now()+(t.expires_in||3600)*1000,granted:grantedFrom(t.scope),name:displayName(t.id_token),createdAt:Date.now()})
   const old=cookies(req)[SESSION_COOKIE];if(old)sessions.delete(old)
   redirect(res,'/?health=connected',[clear,cookie(SESSION_COOKIE,sid,SESSION_TTL/1000)])
  }catch{redirect(res,'/?health=error',[clear])}
  return true
 }
 if(url.pathname==='/api/auth/logout'&&req.method==='POST'){
  const {sid,session}=sessionOf(req)
  if(sid)sessions.delete(sid)
  if(session){const t=session.refresh||session.access;await fetch(REVOKE_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:t}),signal:AbortSignal.timeout(10000)}).catch(()=>{})}
  res.setHeader('Set-Cookie',cookie(SESSION_COOKIE,'',0));json(res,200,{connected:false});return true
 }
 if(url.pathname==='/api/google-health/summary'&&req.method==='GET'){
  const {sid,session}=sessionOf(req)
  if(!session){json(res,401,{error:'Google Healthに接続していません。'});return true}
  try{json(res,200,await healthSummary(await accessToken(session),session.granted))}
  catch(e){const status=(e as {status?:number}).status;if(status===401){if(sid)sessions.delete(sid);res.setHeader('Set-Cookie',cookie(SESSION_COOKIE,'',0));json(res,401,{error:'接続の有効期限が切れました。もう一度接続してください。'})}else json(res,502,{error:'Google Healthから読み取れませんでした。手入力で続けられます。'})}
  return true
 }
 return false
}
/** テスト用 */
export function resetGoogleSessions(){sessions.clear();pending.clear()}
