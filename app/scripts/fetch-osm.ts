// 同梱の地図データ（public/data/area-osm.json・area-context.json）を OpenStreetMap から取り直す。2026-11-10 作成
//   node scripts/fetch-osm.ts
import {writeFile} from 'node:fs/promises'
import {areaQuery,contextQuery} from '../src/domain/osmQuery.ts'
const ENDPOINT=process.env.OVERPASS_URL||'https://overpass-api.de/api/interpreter'
async function overpass(q:string){const r=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','user-agent':'rest-care-hackathon/1.0'},body:'data='+encodeURIComponent(q),signal:AbortSignal.timeout(180_000)});if(!r.ok)throw Error(`Overpass ${r.status}: ${(await r.text()).slice(0,200)}`);return r.json() as Promise<{osm3s?:{timestamp_osm_base?:string};elements:any[]}>}
const r6=(n:number)=>Math.round(n*1e7)/1e7
const slim=(e:any)=>e.type==='node'?{t:'n',id:e.id,tags:e.tags??{},lat:r6(e.lat),lng:r6(e.lon)}:{t:'w',id:e.id,tags:e.tags??{},g:(e.geometry??[]).map((p:any)=>[r6(p.lat),r6(p.lon)])}
const fetchedAt=new Date().toISOString()
const area=await overpass(areaQuery())
const elements=area.elements.filter(e=>e.type==='node'||e.type==='way'&&e.geometry?.length).map(slim)
await writeFile('public/data/area-osm.json',JSON.stringify({version:2,source:'OpenStreetMap contributors (ODbL 1.0)',fetchedAt,osmBase:area.osm3s?.timestamp_osm_base??null,elements}))
const ctx=await overpass(contextQuery())
const kindOf=(t:Record<string,string>)=>t.highway?'road':t.natural==='coastline'?'coast':'water'
const features=ctx.elements.filter(e=>e.type==='way'&&e.geometry?.length>=2).map(e=>({id:e.id,kind:kindOf(e.tags??{}),...(e.tags?.highway?{roadType:e.tags.highway}:{}),...(e.tags?.name?{name:e.tags.name}:{}),...(e.tags?.footway==='sidewalk'?{sidewalk:true}:{}),points:e.geometry.map((p:any)=>[r6(p.lat),r6(p.lon)])}))
await writeFile('public/data/area-context.json',JSON.stringify({source:'OpenStreetMap contributors (ODbL 1.0)',asOf:ctx.osm3s?.timestamp_osm_base??null,fetchedAt,features}))
console.log(`area-osm.json: ${elements.length} 件 / area-context.json: ${features.length} 件（${fetchedAt}）`)
