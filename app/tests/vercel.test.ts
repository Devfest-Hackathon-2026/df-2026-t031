import {describe,it,expect,afterEach,vi} from 'vitest'
import {createServer,type IncomingMessage} from 'node:http'
import type {AddressInfo} from 'node:net'
import handler from '../server/vercel.ts'
import {publicOrigin,extraOrigins,allowedRequest} from '../server/hosting.ts'
import {workloadIdentity,generateText,resetGeminiState} from '../server/gemini.ts'
import {createApiServer} from '../server/index.ts'
import {oauthConfigured,resetGoogleSessions} from '../server/googleHealth.ts'

// Vercel で動かすための部分（公開オリジン・関数の入り口・状態を持たないログイン・Workload Identity）

const req=(headers:Record<string,string>)=>({headers,socket:{remoteAddress:'10.0.0.1'}}) as unknown as IncomingMessage
const servers:{close(cb:()=>void):void}[]=[]
afterEach(async()=>{vi.unstubAllGlobals();await Promise.all(servers.splice(0).map(s=>new Promise<void>(r=>s.close(()=>r()))))})
async function listen(server:ReturnType<typeof createServer>){servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${(server.address() as AddressInfo).port}`}
const withEnv=async(vars:Record<string,string|undefined>,fn:()=>Promise<void>|void)=>{const prev=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));for(const [k,v] of Object.entries(vars)){if(v===undefined)delete process.env[k];else process.env[k]=v}try{await fn()}finally{for(const [k,v] of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v}}}

describe('公開オリジン（Vercel）',()=>{
 it('PUBLIC_ORIGIN が無ければ本番ドメインを使う（PUBLIC_ORIGIN が優先）',()=>{
  expect(publicOrigin({VERCEL_PROJECT_PRODUCTION_URL:'epoku.vercel.app'})).toBe('https://epoku.vercel.app')
  expect(publicOrigin({VERCEL_PROJECT_PRODUCTION_URL:'epoku.vercel.app',PUBLIC_ORIGIN:'https://epoku.example.jp'})).toBe('https://epoku.example.jp')
 })
 it('デプロイ自身の URL（プレビュー・ブランチ）も受け付ける。ほかのホストやオリジンは拒否',()=>{
  const env={VERCEL_URL:'epoku-git-abc-team.vercel.app',VERCEL_BRANCH_URL:'epoku-git-feature-team.vercel.app'}
  const extra=extraOrigins(env);expect(extra).toEqual(['https://epoku-git-abc-team.vercel.app','https://epoku-git-feature-team.vercel.app'])
  const origin='https://epoku.vercel.app'
  expect(allowedRequest(req({host:'epoku.vercel.app'}),origin,extra)).toBe(true)
  expect(allowedRequest(req({host:'epoku-git-abc-team.vercel.app',origin:'https://epoku-git-abc-team.vercel.app'}),origin,extra)).toBe(true)
  expect(allowedRequest(req({host:'epoku-git-abc-team.vercel.app',origin:'https://epoku.vercel.app'}),origin,extra)).toBe(false)
  expect(allowedRequest(req({host:'evil.vercel.app'}),origin,extra)).toBe(false)
  expect(extraOrigins({VERCEL_URL:'bad host/../x'})).toEqual([])
 })
})

describe('関数の入り口（server/vercel.ts）',()=>{
 it('__path から元のパスとクエリを組み直して API に渡す',async()=>{
  const url=await listen(createServer(handler))
  const r=await fetch(url+'/api/index?__path=health');expect(r.status).toBe(200);expect(Object.keys(await r.json())).toContain('gemini')
  const s=await fetch(url+'/api/index?__path=auth/google/callback&code=x&state=forged',{redirect:'manual'});expect(s.headers.get('location')).toBe('/?health=state-error')
 })
})

describe('Googleログイン（サーバーに状態を持たない）',()=>{
 const OAUTH={GOOGLE_OAUTH_CLIENT_ID:'test-client',GOOGLE_OAUTH_CLIENT_SECRET:'test-secret'}
 it('Vercel では SESSION_SECRET が無いと未設定扱い',()=>withEnv({...OAUTH,VERCEL:'1',SESSION_SECRET:undefined},()=>{expect(oauthConfigured()).toBe(false);process.env.SESSION_SECRET='s'.repeat(32);expect(oauthConfigured()).toBe(true)}))
 it('別インスタンスでもコールバックとセッションが通り、改ざんした Cookie は通らない',()=>withEnv({...OAUTH,SESSION_SECRET:'x'.repeat(40)},async()=>{
  const real=globalThis.fetch
  vi.stubGlobal('fetch',async(input:string|URL|Request,init?:RequestInit)=>{const u=String(input instanceof Request?input.url:input);if(u.startsWith('https://oauth2.googleapis.com/token'))return Response.json({access_token:'A',expires_in:3600,scope:'openid',id_token:'x.'+Buffer.from(JSON.stringify({given_name:'テスト'})).toString('base64url')+'.y'});return real(input,init)})
  const a=await listen(createApiServer())
  const s=await fetch(a+'/api/auth/google/start?items=activity',{redirect:'manual'});const state=new URL(s.headers.get('location')!).searchParams.get('state')
  resetGoogleSessions() // インスタンスが変わったつもり（メモリの中身は消える）
  const b=await listen(createApiServer())
  const cb=await fetch(b+`/api/auth/google/callback?code=c&state=${state}`,{redirect:'manual',headers:{Cookie:s.headers.get('set-cookie')!.split(';')[0]}})
  expect(cb.headers.get('location')).toBe('/?health=connected')
  const cookie=cb.headers.getSetCookie().find(c=>c.startsWith('epoku_sid='))!.split(';')[0]
  expect(cookie).not.toMatch(/"A"|テスト/)
  resetGoogleSessions()
  expect((await (await fetch(a+'/api/auth/status',{headers:{Cookie:cookie}})).json()).connected).toBe(true)
  const tampered=cookie.slice(0,-2)+(cookie.endsWith('A')?'BB':'AA')
  expect((await (await fetch(a+'/api/auth/status',{headers:{Cookie:tampered}})).json()).connected).toBe(false)
  process.env.SESSION_SECRET='y'.repeat(40)
  expect((await (await fetch(a+'/api/auth/status',{headers:{Cookie:cookie}})).json()).connected).toBe(false)
 }))
})

describe('Workload Identity 連携の設定',()=>{
 const ok={GCP_PROJECT_NUMBER:'123456789',GCP_WORKLOAD_IDENTITY_POOL_ID:'vercel',GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID:'vercel',GCP_SERVICE_ACCOUNT_EMAIL:'epoku-vertex@demo-1.iam.gserviceaccount.com'}
 it('4つそろえば audience を作る。欠けていれば使わない',()=>{
  expect(workloadIdentity(ok)).toEqual({audience:'//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel',account:ok.GCP_SERVICE_ACCOUNT_EMAIL})
  expect(workloadIdentity({...ok,GCP_PROJECT_NUMBER:''})).toBeNull()
 })
 it('形のおかしい値は使わない',()=>{expect(()=>workloadIdentity({...ok,GCP_PROJECT_NUMBER:'demo-1'})).toThrow();expect(()=>workloadIdentity({...ok,GCP_SERVICE_ACCOUNT_EMAIL:'a@gmail.com'})).toThrow()})
 it('Vercel の OIDC トークンを STS → サービスアカウントのトークンに換えて Vertex AI を呼ぶ',async()=>{
  resetGeminiState()
  const calls:{url:string;init?:RequestInit}[]=[]
  vi.stubGlobal('fetch',async(input:string|URL|Request,init?:RequestInit)=>{const url=String(input);calls.push({url,init})
   if(url==='https://sts.googleapis.com/v1/token')return Response.json({access_token:'FED'})
   if(url.startsWith('https://iamcredentials.googleapis.com/'))return Response.json({accessToken:'SA-TOKEN',expireTime:new Date(Date.now()+3600_000).toISOString()})
   if(url.includes('aiplatform.googleapis.com'))return Response.json({candidates:[{content:{parts:[{text:'ok'}]}}]})
   return new Response('',{status:404})})
  const env={...ok,GOOGLE_CLOUD_PROJECT:'demo-1',VERCEL_OIDC_TOKEN:'OIDC'}
  expect(await generateText({contents:[]},env)).toBe('ok')
  const sts=JSON.parse(String(calls[0].init?.body));expect(sts.subjectToken).toBe('OIDC');expect(sts.audience).toContain('/workloadIdentityPools/vercel/providers/vercel')
  expect(calls[1].url).toContain(encodeURIComponent(ok.GCP_SERVICE_ACCOUNT_EMAIL));expect(new Headers(calls[1].init?.headers).get('authorization')).toBe('Bearer FED')
  expect(new Headers(calls[2].init?.headers).get('authorization')).toBe('Bearer SA-TOKEN')
  await generateText({contents:[]},env);expect(calls.length).toBe(4) // トークンは使い回す
  resetGeminiState()
 })
})
