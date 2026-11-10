import {describe,it,expect,afterAll} from 'vitest'
import {createServer,request,type IncomingMessage} from 'node:http'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {AddressInfo} from 'node:net'
import {publicOrigin,allowedRequest,clientKey,secureCookie,serveStatic} from '../server/hosting.ts'

const req=(headers:Record<string,string>,remote='10.0.0.1')=>({headers,socket:{remoteAddress:remote}}) as unknown as IncomingMessage
const RUN='https://epoku-abc-an.a.run.app'

describe('公開オリジン（Cloud Run）',()=>{
 it('PUBLIC_ORIGIN は https/http のオリジンだけ受け付ける',()=>{expect(publicOrigin({PUBLIC_ORIGIN:RUN+'/'})).toBe(RUN);expect(publicOrigin({})).toBeNull();expect(publicOrigin({PUBLIC_ORIGIN:'epoku.run.app'})).toBeNull();expect(publicOrigin({PUBLIC_ORIGIN:RUN+'/app'})).toBeNull();expect(publicOrigin({PUBLIC_ORIGIN:'ftp://x.example'})).toBeNull()})
 it('公開時は自分のホスト・オリジンだけを通す',()=>{
  expect(allowedRequest(req({host:'epoku-abc-an.a.run.app'}),RUN)).toBe(true)
  expect(allowedRequest(req({host:'epoku-abc-an.a.run.app',origin:RUN}),RUN)).toBe(true)
  expect(allowedRequest(req({host:'epoku-abc-an.a.run.app',origin:'https://evil.example'}),RUN)).toBe(false)
  expect(allowedRequest(req({host:'evil.example'}),RUN)).toBe(false)
  expect(allowedRequest(req({host:'127.0.0.1:8080'}),RUN)).toBe(false)
 })
 it('未設定ならローカルだけ（従来どおり）',()=>{expect(allowedRequest(req({host:'127.0.0.1:8787',origin:'http://localhost:5188'}),null)).toBe(true);expect(allowedRequest(req({host:'epoku-abc-an.a.run.app'}),null)).toBe(false)})
 it('回数制限は X-Forwarded-For の末尾（前段が足した接続元）で数える',()=>{expect(clientKey(req({'x-forwarded-for':'1.1.1.1, 203.0.113.9'}),RUN)).toBe('203.0.113.9');expect(clientKey(req({'x-forwarded-for':'1.1.1.1'}),null)).toBe('10.0.0.1')})
 it('https で公開するときだけ Cookie に Secure',()=>{expect(secureCookie(RUN)).toBe(true);expect(secureCookie('http://127.0.0.1:8080')).toBe(false);expect(secureCookie(null)).toBe(false)})
})

describe('画面（dist）の配信',()=>{
 const root=mkdtempSync(join(tmpdir(),'epoku-dist-'))
 mkdirSync(join(root,'assets'));writeFileSync(join(root,'index.html'),'<!doctype html><title>epoku</title>');writeFileSync(join(root,'assets','app-abc.js'),'console.log(1)');writeFileSync(join(root,'sw.js'),'//sw')
 writeFileSync(join(tmpdir(),'epoku-secret.txt'),'secret')
 const server=createServer(async(rq,rs)=>{if(!await serveStatic(rq,rs,root)){rs.writeHead(418);rs.end('api')}})
 const ready=new Promise<number>(r=>server.listen(0,'127.0.0.1',()=>r((server.address() as AddressInfo).port)))
 afterAll(()=>{server.close();rmSync(root,{recursive:true,force:true});rmSync(join(tmpdir(),'epoku-secret.txt'),{force:true})})
 /** fetch は ../ を正規化してしまうので、生のパスを送れる http.request を使う */
 const get=async(path:string,method='GET')=>{const port=await ready;return new Promise<{status:number;headers:IncomingMessage['headers'];body:string}>((ok,ng)=>{const r=request({host:'127.0.0.1',port,path,method},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>ok({status:res.statusCode!,headers:res.headers,body}))});r.on('error',ng);r.end()})}
 it('index.html と assets を種類・キャッシュ付きで返す',async()=>{const i=await get('/');expect(i.status).toBe(200);expect(i.headers['content-type']).toContain('text/html');expect(i.headers['cache-control']).toBe('no-cache');const a=await get('/assets/app-abc.js');expect(a.headers['content-type']).toContain('javascript');expect(a.headers['cache-control']).toContain('immutable');expect((await get('/sw.js')).headers['cache-control']).toBe('no-cache')})
 it('拡張子の無いパスは index.html、無いファイルは 404',async()=>{expect((await get('/spots/123')).body).toContain('<title>epoku');expect((await get('/assets/none.js')).status).toBe(404)})
 it('/api は API 側に任せる',async()=>{expect((await get('/api/health')).status).toBe(418);expect((await get('/','POST')).status).toBe(418)})
 it('dist の外は読めない',async()=>{for(const p of ['/../epoku-secret.txt','/%2e%2e/epoku-secret.txt','/assets/..%2f..%2fepoku-secret.txt']){const r=await get(p);expect(r.body).not.toContain('secret')}})
})
