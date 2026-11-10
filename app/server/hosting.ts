/**
 * 公開時の設定。PUBLIC_ORIGIN も Vercel の環境変数も無ければ従来どおりローカル開発専用（127.0.0.1 / localhost だけ受け付ける）。
 * PUBLIC_ORIGIN=https://epoku.example のように置くと、そのホストだけを受け付ける（Node サーバー単体で動かすときは画面 dist も同じオリジンから配る）。
 * Vercel では PUBLIC_ORIGIN が無くても、本番ドメイン（VERCEL_PROJECT_PRODUCTION_URL）を公開オリジンとして扱い、
 * そのデプロイ自身の URL（VERCEL_URL / VERCEL_BRANCH_URL）も受け付ける。
 */
import type {IncomingMessage,ServerResponse} from 'node:http'
import {readFile,stat} from 'node:fs/promises'
import {extname,join,normalize,resolve,sep} from 'node:path'
import {fileURLToPath} from 'node:url'

/** 末尾の / を除いた公開オリジン。形式が不正なら null（ローカル扱い） */
export function publicOrigin(env=process.env):string|null{
 const raw=env.PUBLIC_ORIGIN?.trim()||(env.VERCEL_PROJECT_PRODUCTION_URL?`https://${env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`:'')
 if(!raw)return null;try{const u=new URL(raw);return (u.protocol==='https:'||u.protocol==='http:')&&u.pathname==='/'&&!u.search?u.origin:null}catch{return null}
}
const HOST_NAME=/^[a-z0-9.-]+$/i
/** 公開オリジンのほかに受け付けるオリジン。Vercel が付けるそのデプロイ自身の URL（プレビューを含む） */
export function extraOrigins(env=process.env):string[]{return ['VERCEL_URL','VERCEL_BRANCH_URL'].map(k=>env[k]?.trim()||'').filter(h=>HOST_NAME.test(h)).map(h=>`https://${h.toLowerCase()}`)}
const LOCAL_HOST=/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/
const LOCAL_NAMES=['127.0.0.1','localhost','[::1]']
/** Host と Origin の確認。公開時は公開オリジン（と Vercel のデプロイ URL）と一致するものだけ、開発時はローカルだけ */
export function allowedRequest(req:IncomingMessage,origin=publicOrigin(),extra=extraOrigins()){
 const host=req.headers.host||'',sent=req.headers.origin
 if(origin){const match=[origin,...extra].find(o=>new URL(o).host===host);if(!match)return false;return !sent||sent===match}
 if(!LOCAL_HOST.test(host))return false;if(!sent)return true;try{return LOCAL_NAMES.includes(new URL(sent).hostname)}catch{return false}
}
/** 回数制限のキー。Cloud Run や Vercel では前段が X-Forwarded-For の末尾に接続元を足す（または上書きする）ので末尾を使う（先頭は利用者が偽れる） */
export function clientKey(req:IncomingMessage,origin=publicOrigin()){if(origin){const xff=String(req.headers['x-forwarded-for']||'').split(',').map(s=>s.trim()).filter(Boolean);if(xff.length)return xff[xff.length-1]}return req.socket.remoteAddress||'local'}
/** https で公開しているときだけ Cookie に Secure を付ける */
export const secureCookie=(origin=publicOrigin())=>!!origin?.startsWith('https:')

const TYPES:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.glb':'model/gltf-binary','.bin':'application/octet-stream','.wasm':'application/wasm','.txt':'text/plain; charset=utf-8'}
export const STATIC_DIR=resolve(process.env.STATIC_DIR||fileURLToPath(new URL('../dist',import.meta.url)))
async function isFile(p:string){try{return (await stat(p)).isFile()}catch{return false}}
/** dist を配る。/api は扱わない。拡張子の無いパスは index.html（1画面アプリ）。dist が無ければ false を返して API 側に任せる */
export async function serveStatic(req:IncomingMessage,res:ServerResponse,root=STATIC_DIR):Promise<boolean>{
 if(req.method!=='GET'&&req.method!=='HEAD')return false
 let path:string;try{path=decodeURIComponent(new URL(req.url||'/','http://local').pathname)}catch{return false}
 if(path.startsWith('/api/')||path==='/api'||path.includes('\0'))return false
 const index=join(root,'index.html');if(!await isFile(index))return false
 let file=normalize(join(root,path));if(file!==root&&!file.startsWith(root+sep))return false
 if(!await isFile(file)){if(extname(path)){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end('Not found');return true}file=index}
 const name=file.slice(root.length+1).split(sep).join('/')
 const cache=name.startsWith('assets/')?'public, max-age=31536000, immutable':name==='index.html'||name==='sw.js'?'no-cache':'public, max-age=3600'
 const data=await readFile(file)
 res.writeHead(200,{'Content-Type':TYPES[extname(file).toLowerCase()]||'application/octet-stream','Content-Length':data.length,'Cache-Control':cache,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'})
 res.end(req.method==='HEAD'?undefined:data);return true
}
