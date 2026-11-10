import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest'
import {geminiProvider,geminiEndpoint,overHourlyLimit,generateText,resetGeminiState,GeminiHttpError} from '../server/gemini.ts'

describe('Gemini の接続先',()=>{
 it('キーがあれば Gemini API、無くてプロジェクトがあれば Vertex AI、どちらも無ければ未接続',()=>{expect(geminiProvider({GEMINI_API_KEY:'k',GOOGLE_CLOUD_PROJECT:'my-proj-1'})).toBe('api-key');expect(geminiProvider({GOOGLE_CLOUD_PROJECT:'my-proj-1'})).toBe('vertex');expect(geminiProvider({})).toBeNull()})
 it('Vertex AI の URL（global は地域なし、それ以外は地域付きのホスト）',()=>{
  expect(geminiEndpoint({GOOGLE_CLOUD_PROJECT:'utility-node-514209-c7',GOOGLE_CLOUD_LOCATION:'global',GEMINI_MODEL:'gemini-3.8-flash'})).toBe('https://aiplatform.googleapis.com/v1/projects/utility-node-514209-c7/locations/global/publishers/google/models/gemini-3.8-flash:generateContent')
  expect(geminiEndpoint({GOOGLE_CLOUD_PROJECT:'my-proj-1',GOOGLE_CLOUD_LOCATION:'asia-northeast1'})).toContain('https://asia-northeast1-aiplatform.googleapis.com/v1/projects/my-proj-1/locations/asia-northeast1/')
  expect(()=>geminiEndpoint({GOOGLE_CLOUD_PROJECT:'x/../../evil'})).toThrow()
  expect(()=>geminiEndpoint({GEMINI_API_KEY:'k',GEMINI_MODEL:'a/b'})).toThrow()
 })
})

describe('1時間の上限',()=>{
 beforeEach(()=>resetGeminiState())
 it('上限に達したら止め、1時間たてば戻る',()=>{const env={GEMINI_HOURLY_LIMIT:'2'};expect(overHourlyLimit(env,0)).toBe(false);expect(overHourlyLimit(env,1)).toBe(false);expect(overHourlyLimit(env,2)).toBe(true);expect(overHourlyLimit(env,3600001)).toBe(false)})
 it('未設定なら制限しない',()=>{for(let i=0;i<500;i++)expect(overHourlyLimit({},i)).toBe(false)})
})

describe('呼び出し',()=>{
 beforeEach(()=>resetGeminiState())
 afterEach(()=>vi.unstubAllGlobals())
 it('Vertex AI はメタデータサーバーのトークンで呼び、トークンを使い回す',async()=>{
  const seen:{url:string;auth?:string}[]=[]
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{const h=(init?.headers||{}) as Record<string,string>;seen.push({url:String(url),auth:h.Authorization})
   if(String(url).includes('metadata.google.internal')){expect(h['Metadata-Flavor']).toBe('Google');return new Response(JSON.stringify({access_token:'tok',expires_in:3600}))}
   return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'ひと'},{text:'休み'}]}}]}))}))
  const env={GOOGLE_CLOUD_PROJECT:'my-proj-1'}
  expect(await generateText({},env)).toBe('ひと休み');expect(await generateText({},env)).toBe('ひと休み')
  expect(seen.filter(s=>s.url.includes('metadata')).length).toBe(1);expect(seen.filter(s=>s.url.includes('aiplatform')).every(s=>s.auth==='Bearer tok')).toBe(true)
 })
 it('上流の失敗は HTTP 番号だけ',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('secret detail',{status:403})));await expect(generateText({},{GEMINI_API_KEY:'k'})).rejects.toEqual(new GeminiHttpError(403))})
 it('Cloud Run 以外で Vertex AI の認証が取れなければ分かる言葉で失敗',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>{throw TypeError('fetch failed')}));await expect(generateText({},{GOOGLE_CLOUD_PROJECT:'my-proj-1'})).rejects.toThrow('Vertex AI')})
})
