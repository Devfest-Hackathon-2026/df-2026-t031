import {it,expect,afterEach} from 'vitest'
import {createApiServer} from '../server/index.ts'
import type {AddressInfo} from 'node:net'
const servers:ReturnType<typeof createApiServer>[]=[]
async function start(){const server=createApiServer();servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address() as AddressInfo).port}`}
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>(resolve=>s.close(()=>resolve()))))})
it('秘密鍵を返さずAPI設定の有無を確認できる',async()=>{const url=await start();const r=await fetch(url+'/api/health');expect(r.status).toBe(200);const d=await r.json();expect(typeof d.gemini).toBe('boolean');expect(Object.keys(d).sort()).toEqual(['gemini','weather'])})
it('外部OriginからのAPI呼び出しを拒否する',async()=>{const url=await start();const r=await fetch(url+'/api/health',{headers:{Origin:'https://example.com'}});expect(r.status).toBe(403)})
it('未設定のGeminiで成功を装わない',async()=>{const prev=process.env.GEMINI_API_KEY;delete process.env.GEMINI_API_KEY;try{const url=await start();const r=await fetch(url+'/api/explain',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});expect(r.status).toBe(503);expect((await r.json()).error).toContain('未接続')}finally{if(prev)process.env.GEMINI_API_KEY=prev}})
