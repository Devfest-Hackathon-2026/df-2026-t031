import {it,expect,afterEach} from 'vitest'
import {createApiServer} from '../server/index.ts'
import type {AddressInfo} from 'node:net'
const servers:ReturnType<typeof createApiServer>[]=[]
async function start(){const server=createApiServer();servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address() as AddressInfo).port}`}
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>(resolve=>s.close(()=>resolve()))))})
it('秘密鍵を返さずAPI設定の有無を確認できる',async()=>{const url=await start();const r=await fetch(url+'/api/health');expect(r.status).toBe(200);const d=await r.json();expect(typeof d.gemini).toBe('boolean');expect(Object.keys(d).sort()).toEqual(['gemini','weather'])})
it('外部OriginからのAPI呼び出しを拒否する',async()=>{const url=await start();const r=await fetch(url+'/api/health',{headers:{Origin:'https://example.com'}});expect(r.status).toBe(403)})
it('未設定のGeminiで成功を装わない',async()=>{const prev=process.env.GEMINI_API_KEY;delete process.env.GEMINI_API_KEY;try{const url=await start();const r=await fetch(url+'/api/explain',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});expect(r.status).toBe(503);expect((await r.json()).error).toContain('未接続')}finally{if(prev)process.env.GEMINI_API_KEY=prev}})
import {vi} from 'vitest'
import {resetGoogleSessions,HEALTH_SCOPES} from '../server/googleHealth.ts'
import {allowlistPayload,applyDemo,DEFAULT_NEED} from '../src/domain/restNeed.ts'
/** Google の外部APIだけを差し替え、ローカルAPIへの呼び出しは本物の fetch を通す */
function stubGoogle(handler:(url:string,init?:RequestInit)=>Response|undefined){const real=globalThis.fetch;const calls:{url:string;init?:RequestInit}[]=[];vi.stubGlobal('fetch',async(input:string|URL|Request,init?:RequestInit)=>{const url=String(input instanceof Request?input.url:input);if(url.startsWith('http://127.0.0.1'))return real(input,init);calls.push({url,init});return handler(url,init)??new Response('{}',{status:404})});return calls}
const withEnv=async(vars:Record<string,string>,fn:()=>Promise<void>)=>{const prev=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);try{await fn()}finally{for(const [k,v] of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v}vi.unstubAllGlobals();resetGoogleSessions()}}
const OAUTH={GOOGLE_OAUTH_CLIENT_ID:'test-client',GOOGLE_OAUTH_CLIENT_SECRET:'test-secret'}
it('Googleログイン未設定なら接続できないことを返す',async()=>{const prev=process.env.GOOGLE_OAUTH_CLIENT_ID;delete process.env.GOOGLE_OAUTH_CLIENT_ID;try{const url=await start();const s=await (await fetch(url+'/api/auth/status')).json();expect(s).toEqual({configured:false,connected:false,name:null,granted:[]});const r=await fetch(url+'/api/google-health/summary');expect(r.status).toBe(401)}finally{if(prev)process.env.GOOGLE_OAUTH_CLIENT_ID=prev}})
it('stateが合わないコールバックではセッションを作らない',()=>withEnv(OAUTH,async()=>{const url=await start();const r=await fetch(url+'/api/auth/google/callback?code=x&state=forged',{redirect:'manual'});expect(r.headers.get('location')).toBe('/?health=state-error');expect(r.headers.get('set-cookie')).not.toContain('epoku_sid=')}))
it('OAuthはサーバーで完結し、同意した項目だけを集計値で返す',()=>withEnv(OAUTH,async()=>{
 const calls=stubGoogle(url=>{
  if(url.startsWith('https://oauth2.googleapis.com/token'))return Response.json({access_token:'ACCESS-SECRET',refresh_token:'REFRESH-SECRET',expires_in:3600,scope:`openid ${HEALTH_SCOPES.activity}`,id_token:'x.'+Buffer.from(JSON.stringify({given_name:'海翔',email:'kaito@example.com'})).toString('base64url')+'.y'})
  if(url.includes('/dataTypes/steps/'))return Response.json({dataPoints:[{steps:{interval:{startTime:new Date().toISOString(),endTime:new Date().toISOString()},count:'4321'}}]})
  if(url.includes('/dataTypes/active-minutes/'))return Response.json({dataPoints:[]})
  if(url.startsWith('https://oauth2.googleapis.com/revoke'))return new Response('',{status:200})
 })
 const url=await start()
 const s=await fetch(url+'/api/auth/google/start?items=activity,sleep',{redirect:'manual'});expect(s.status).toBe(302)
 const auth=new URL(s.headers.get('location')!);expect(auth.origin).toBe('https://accounts.google.com');expect(auth.searchParams.get('code_challenge_method')).toBe('S256');expect(auth.searchParams.get('scope')).toContain(HEALTH_SCOPES.sleep);expect(auth.searchParams.get('scope')).not.toContain(HEALTH_SCOPES.heart)
 const stateCookie=s.headers.get('set-cookie')!.split(';')[0]
 const cb=await fetch(url+`/api/auth/google/callback?code=abc&state=${auth.searchParams.get('state')}`,{redirect:'manual',headers:{Cookie:stateCookie}})
 expect(cb.headers.get('location')).toBe('/?health=connected');const sid=cb.headers.getSetCookie().find(c=>c.startsWith('epoku_sid='))!;expect(sid).toContain('HttpOnly');const cookie=sid.split(';')[0]
 expect(String(calls[0].init?.body)).toContain('code_verifier=')
 const status=await (await fetch(url+'/api/auth/status',{headers:{Cookie:cookie}})).text();expect(status).not.toMatch(/SECRET|kaito@example\.com/);expect(JSON.parse(status)).toMatchObject({connected:true,name:'海翔',granted:['activity']})
 const sumRes=await fetch(url+'/api/google-health/summary',{headers:{Cookie:cookie}});const sumText=await sumRes.text();expect(sumText).not.toContain('SECRET')
 const sum=JSON.parse(sumText);expect(sum.steps).toEqual({status:'ok',value:4321});expect(sum.activeMinutes.status).toBe('noData');expect(sum.sleepHours.status).toBe('noConsent');expect(sum.heart.status).toBe('noConsent')
 expect(calls.filter(c=>c.url.includes('health.googleapis.com')).every(c=>new Headers(c.init?.headers).get('authorization')==='Bearer ACCESS-SECRET')).toBe(true)
 const out=await fetch(url+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie}});expect(out.status).toBe(200);expect(calls.some(c=>c.url.startsWith('https://oauth2.googleapis.com/revoke'))).toBe(true)
 expect((await (await fetch(url+'/api/auth/status',{headers:{Cookie:cookie}})).json()).connected).toBe(false)
}))
it('Google Healthアプリ未連携（ACCOUNT_NOT_LINKED）を区別して返す',()=>withEnv(OAUTH,async()=>{
 stubGoogle(url=>{if(url.startsWith('https://oauth2.googleapis.com/token'))return Response.json({access_token:'A',expires_in:3600,scope:HEALTH_SCOPES.sleep});if(url.includes('health.googleapis.com'))return Response.json({error:{status:'FAILED_PRECONDITION',details:[{reason:'ACCOUNT_NOT_LINKED'}]}},{status:400})})
 const url=await start();const s=await fetch(url+'/api/auth/google/start?items=sleep',{redirect:'manual'});const state=new URL(s.headers.get('location')!).searchParams.get('state')
 const cb=await fetch(url+`/api/auth/google/callback?code=c&state=${state}`,{redirect:'manual',headers:{Cookie:s.headers.get('set-cookie')!.split(';')[0]}});const cookie=cb.headers.getSetCookie().find(c=>c.startsWith('epoku_sid='))!.split(';')[0]
 const sum=await (await fetch(url+'/api/google-health/summary',{headers:{Cookie:cookie}})).json();expect(sum.linked).toBe(false)
}))
it('休憩の一言はallowlistの値だけをGeminiへ送り、同意なしでは健康データを送らない',()=>withEnv({GEMINI_API_KEY:'gemini-test'},async()=>{
 const sent:string[]=[];stubGoogle((url,init)=>{if(url.includes('generativelanguage.googleapis.com')){sent.push(String(init?.body));return Response.json({candidates:[{content:{parts:[{text:sent.length===1?'暑い中30分歩いたので、日陰でひと休みしませんか。':'熱中症の危険があります。'}]}}]})}})
 const url=await start();const need=applyDemo({...DEFAULT_NEED,wishes:['shade']})
 const rest={...allowlistPayload(need,{walkingMinutes:31,temperatureC:31,wbgt:28.4,reasons:['続けて約31分歩いている']},true),email:'kaito@example.com',lat:35.4567}
 const post=(healthConsent:boolean)=>fetch(url+'/api/explain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'rest',rest,healthConsent})})
 const a=await (await post(false)).json();expect(a).toEqual({text:'暑い中30分歩いたので、日陰でひと休みしませんか。',replaced:false})
 const data=JSON.parse(JSON.parse(sent[0]).contents[0].parts[0].text);expect(Object.keys(data).sort()).toEqual(['available','fatigue','reasons','temperatureC','walkingMinutes','wbgt','wishes']);expect(sent[0]).not.toMatch(/example\.com|35\.4567|8600/)
 const b=await (await post(true)).json();expect(b.replaced).toBe(true);expect(b.text).not.toContain('熱中症の危険')
 const data2=JSON.parse(JSON.parse(sent[1]).contents[0].parts[0].text);expect(data2.steps).toBe(8600);expect(data2.heart).toBe('slightlyHigh');expect(sent[1]).not.toMatch(/example\.com|35\.4567/)
}))
