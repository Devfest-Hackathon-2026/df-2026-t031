/**
 * Gemini の呼び出し口。GEMINI_API_KEY があれば Gemini API、無くて GOOGLE_CLOUD_PROJECT があれば Vertex AI（キー不要）。
 * Vertex AI の認証は、Vercel では OIDC トークンを Workload Identity 連携でサービスアカウントのトークンに交換する（GCP_* の環境変数）。
 * それ以外（Cloud Run など）はメタデータサーバーから実行サービスアカウントのトークンを取る。
 * GEMINI_HOURLY_LIMIT を置くと、サーバー全体で 1 時間あたりの呼び出し回数を絞る（料金の上限代わり）。
 */
type Env=Record<string,string|undefined>
export type GeminiProvider='api-key'|'vertex'
export function geminiProvider(env:Env=process.env):GeminiProvider|null{if(env.GEMINI_API_KEY)return 'api-key';if(env.GOOGLE_CLOUD_PROJECT)return 'vertex';return null}
export function geminiModel(env:Env=process.env){const model=env.GEMINI_MODEL||'gemini-3.8-flash';if(!/^[a-zA-Z0-9._-]+$/.test(model))throw Error('モデル名を確認してください。');return model}
/** 呼び出し先の URL。location が global なら地域なしのホスト */
export function geminiEndpoint(env:Env=process.env){
 const model=geminiModel(env)
 if(geminiProvider(env)==='api-key')return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
 const project=env.GOOGLE_CLOUD_PROJECT||'',location=env.GOOGLE_CLOUD_LOCATION||'global'
 if(!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)||!/^[a-z0-9-]+$/.test(location))throw Error('GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION を確認してください。')
 const host=location==='global'?'aiplatform.googleapis.com':`${location}-aiplatform.googleapis.com`
 return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`
}

let token:{value:string;until:number}|null=null
/** Workload Identity 連携の設定がそろっていれば、その値 */
export function workloadIdentity(env:Env=process.env){
 const number=env.GCP_PROJECT_NUMBER,pool=env.GCP_WORKLOAD_IDENTITY_POOL_ID,provider=env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,account=env.GCP_SERVICE_ACCOUNT_EMAIL
 if(!number||!pool||!provider||!account)return null
 if(!/^\d+$/.test(number)||!/^[a-z0-9-]+$/.test(pool)||!/^[a-z0-9-]+$/.test(provider)||!/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(account))throw Error('GCP_* の Workload Identity 設定を確認してください。')
 return {audience:`//iam.googleapis.com/projects/${number}/locations/global/workloadIdentityPools/${pool}/providers/${provider}`,account}
}
/** Vercel の OIDC トークン（STS で Google のトークンに交換する）→ サービスアカウントになりすましたアクセストークン */
async function federatedToken(wif:{audience:string;account:string},env:Env){
 const oidc=env.VERCEL_OIDC_TOKEN;if(!oidc)throw Error('Vercel の OIDC トークンがありません（プロジェクト設定で OIDC Federation を有効にしてください）。')
 const sts=await fetch('https://sts.googleapis.com/v1/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audience:wif.audience,grantType:'urn:ietf:params:oauth:grant-type:token-exchange',requestedTokenType:'urn:ietf:params:oauth:token-type:access_token',scope:'https://www.googleapis.com/auth/cloud-platform',subjectTokenType:'urn:ietf:params:oauth:token-type:jwt',subjectToken:oidc}),signal:AbortSignal.timeout(5000)})
 if(!sts.ok)throw Error(`Workload Identity の交換に失敗しました（HTTP ${sts.status}）。`)
 const federated=(await sts.json() as {access_token:string}).access_token
 const r=await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(wif.account)}:generateAccessToken`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${federated}`},body:JSON.stringify({scope:['https://www.googleapis.com/auth/cloud-platform'],lifetime:'3600s'}),signal:AbortSignal.timeout(5000)})
 if(!r.ok)throw Error(`サービスアカウントのトークンを取れませんでした（HTTP ${r.status}）。`)
 const d=await r.json() as {accessToken:string;expireTime:string}
 return {access_token:d.accessToken,expires_in:Math.max(0,(Date.parse(d.expireTime)-Date.now())/1000)}
}
/** Cloud Run などのメタデータサーバーから実行サービスアカウントのアクセストークンを取る */
async function metadataToken(){
 const r=await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(3000)}).catch(()=>null)
 if(!r?.ok)throw Error('Vertex AI の認証情報を取れませんでした（GCP_* の Workload Identity 設定か GEMINI_API_KEY を使ってください）。')
 return await r.json() as {access_token:string;expires_in:number}
}
/** Vertex AI 用のアクセストークン（期限の 1 分前まで使い回す） */
async function vertexToken(env:Env){
 if(token&&Date.now()<token.until)return token.value
 const wif=workloadIdentity(env),d=wif?await federatedToken(wif,env):await metadataToken()
 token={value:d.access_token,until:Date.now()+Math.max(0,d.expires_in-60)*1000};return token.value
}

let calls:number[]=[]
/** 1 時間の上限に達していれば true（数えるのは通した呼び出しだけ） */
export function overHourlyLimit(env:Env=process.env,now=Date.now()){
 const max=Number(env.GEMINI_HOURLY_LIMIT);if(!Number.isFinite(max)||max<=0)return false
 calls=calls.filter(t=>now-t<3600000);if(calls.length>=max)return true;calls.push(now);return false
}
export const resetGeminiState=()=>{calls=[];token=null}

/** generateContent を呼んで本文を返す。上流の失敗は HTTP 番号だけを持つ Error にする（キーや本文は返さない） */
export class GeminiHttpError extends Error{status:number;constructor(status:number){super(`Gemini HTTP ${status}`);this.status=status}}
export async function generateText(request:object,env:Env=process.env):Promise<string>{
 const provider=geminiProvider(env);if(!provider)throw Error('Geminiは未接続です。')
 const headers:Record<string,string>={'Content-Type':'application/json'}
 if(provider==='api-key')headers['x-goog-api-key']=env.GEMINI_API_KEY!;else headers.Authorization=`Bearer ${await vertexToken(env)}`
 const upstream=await fetch(geminiEndpoint(env),{method:'POST',headers,body:JSON.stringify(request),signal:AbortSignal.timeout(18000)})
 if(!upstream.ok)throw new GeminiHttpError(upstream.status)
 const data=await upstream.json();return data.candidates?.[0]?.content?.parts?.map((p:{text?:string})=>p.text||'').join('')||''
}
