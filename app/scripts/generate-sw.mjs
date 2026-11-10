// ビルド後に dist/sw.js を作る。画面と同梱データを先に保存し、通信できないときも開けるようにする。2026-11-10 作成
import {readdir,writeFile} from 'node:fs/promises'
import {join,relative} from 'node:path'
import {createHash} from 'node:crypto'
const dist='dist'
async function list(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...await list(p));else if(e.name!=='sw.js')out.push(relative(dist,p).split('\\').join('/'))}return out}
const files=(await list(dist)).filter(f=>!f.endsWith('.map'))
const version=createHash('sha256').update(files.join('\n')).digest('hex').slice(0,12)
await writeFile(join(dist,'sw.js'),`const CACHE='rest-care-${version}',FILES=${JSON.stringify(['./',...files.map(f=>'./'+f)])}
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))})
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))})
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return
 e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(hit=>hit||fetch(e.request).catch(()=>caches.match('./'))))})
`)
console.log(`sw.js: ${files.length} ファイル（${version}）`)
