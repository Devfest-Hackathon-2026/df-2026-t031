import {LocalProjection} from './geo.ts'
import {AREA_CENTER} from './area.ts'
import {isShaded} from './shade.ts'
import type {LatLng,ShadeState,XY} from './types.ts'

/**
 * アプリ内の徒歩ルート（docs/mvp.md の M6）。APIキーなしで、同梱の OSM 道路データ（area-context.json）の
 * 歩道・道路をつないだグラフの最短経路を求める。つながらないときは直線に戻す。
 * 日陰優先のときは、日なたの区間を実際より長いものとして扱い、日陰の多い道を選びやすくする。
 */
export interface WalkFeature{kind:string;roadType?:string;points:[number,number][]}
export interface WalkGraph{proj:LocalProjection;xy:XY[];adj:number[][];len:number[][];component:number[];largest:number}
export interface WalkRoute{points:LatLng[];distance:number;fallback:boolean}
export interface RouteSegment{points:LatLng[];state:'shade'|'sun'|'night'}
export interface RouteShade{segments:RouteSegment[];shadedRatio:number|null}
export type EdgeCost=(from:number,to:number,length:number)=>number
/** 歩けない道（高速道路・計画中・ホームなど） */
const NOT_WALKABLE=new Set(['motorway','motorway_link','proposed','construction','platform'])
/** 出発地・目的地から道までこれより遠いときは、道につながっていないとみなす（m） */
const MAX_SNAP_M=300

export function buildWalkGraph(features:WalkFeature[],proj=new LocalProjection(AREA_CENTER)):WalkGraph{
 const index=new Map<string,number>(),xy:XY[]=[],adj:number[][]=[],len:number[][]=[]
 const node=(lat:number,lng:number)=>{const k=lat.toFixed(7)+','+lng.toFixed(7);let i=index.get(k);if(i===undefined){i=xy.length;index.set(k,i);xy.push(proj.toXY({lat,lng}));adj.push([]);len.push([])}return i}
 for(const f of features){
  if(f.kind!=='road'||NOT_WALKABLE.has(f.roadType??'')||f.points.length<2)continue
  for(let i=1;i<f.points.length;i++){const a=node(...f.points[i-1]),b=node(...f.points[i]);if(a===b)continue;const d=Math.hypot(xy[a].x-xy[b].x,xy[a].y-xy[b].y);adj[a].push(b);len[a].push(d);adj[b].push(a);len[b].push(d)}
 }
 // つながっている範囲（連結成分）ごとに番号を付け、いちばん大きな範囲を覚えておく
 const component=new Array<number>(xy.length).fill(-1),sizes:number[]=[]
 for(let s=0;s<xy.length;s++){if(component[s]>=0)continue;const id=sizes.length,stack=[s];component[s]=id;let size=0;while(stack.length){const v=stack.pop()!;size++;for(const u of adj[v])if(component[u]<0){component[u]=id;stack.push(u)}}sizes.push(size)}
 const largest=sizes.indexOf(Math.max(0,...sizes))
 return {proj,xy,adj,len,component,largest}
}

function nearest(g:WalkGraph,p:XY,onlyComponent?:number){let best=-1,bestD=Infinity;for(let i=0;i<g.xy.length;i++){if(onlyComponent!==undefined&&g.component[i]!==onlyComponent)continue;const d=Math.hypot(g.xy[i].x-p.x,g.xy[i].y-p.y);if(d<bestD){bestD=d;best=i}}return {node:best,distance:bestD}}

/** ダイクストラ法（二分ヒープ）。見つからなければ null */
function shortest(g:WalkGraph,start:number,goal:number,cost?:EdgeCost):number[]|null{
 const dist=new Float64Array(g.xy.length).fill(Infinity),prev=new Int32Array(g.xy.length).fill(-1),heap:[number,number][]=[]
 const push=(d:number,v:number)=>{heap.push([d,v]);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p][0]<=heap[i][0])break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p}}
 const pop=()=>{const top=heap[0],last=heap.pop()!;if(heap.length){heap[0]=last;let i=0;for(;;){const l=i*2+1,r=l+1;let m=i;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===i)break;[heap[m],heap[i]]=[heap[i],heap[m]];i=m}}return top}
 dist[start]=0;push(0,start)
 while(heap.length){const [d,v]=pop();if(d>dist[v])continue;if(v===goal)break
  for(let k=0;k<g.adj[v].length;k++){const u=g.adj[v][k],nd=d+(cost?cost(v,u,g.len[v][k]):g.len[v][k]);if(nd<dist[u]){dist[u]=nd;prev[u]=v;push(nd,u)}}}
 if(dist[goal]===Infinity)return null
 const path:number[]=[];for(let v=goal;v!==-1;v=prev[v])path.push(v);return path.reverse()
}

export function findWalkRoute(g:WalkGraph,from:LatLng,to:LatLng,cost?:EdgeCost):WalkRoute{
 const a=g.proj.toXY(from),b=g.proj.toXY(to),straight={points:[from,to],distance:Math.hypot(a.x-b.x,a.y-b.y),fallback:true}
 if(!g.xy.length)return straight
 // まず最寄りの道どうしで探し、つながらなければ「いちばん大きな道のまとまり」の上で探し直す
 for(const only of [undefined,g.largest]){
  const s=nearest(g,a,only),e=nearest(g,b,only)
  if(s.node<0||e.node<0||s.distance>MAX_SNAP_M||e.distance>MAX_SNAP_M)continue
  const path=shortest(g,s.node,e.node,cost);if(!path)continue
  let distance=s.distance+e.distance;for(let i=1;i<path.length;i++){const p=g.xy[path[i-1]],q=g.xy[path[i]];distance+=Math.hypot(p.x-q.x,p.y-q.y)}
  return {points:[from,...path.map(i=>g.proj.toLatLng(g.xy[i])),to],distance,fallback:false}
 }
 return straight
}

/** ルートを step m ごとに区切って日陰かどうかを調べ、同じ状態の区間をまとめる（地図の色分けと「日陰 ◯%」用） */
export function routeShade(points:LatLng[],stateAt:(p:XY)=>ShadeState,proj:LocalProjection,step=8):RouteShade{
 const xy=points.map(p=>proj.toXY(p)),segments:RouteSegment[]=[];let shaded=0,total=0,night=true
 const add=(from:XY,to:XY)=>{const len=Math.hypot(to.x-from.x,to.y-from.y);if(len<.01)return;const s=stateAt({x:(from.x+to.x)/2,y:(from.y+to.y)/2}),state=s==='night'?'night':isShaded(s)?'shade':'sun';if(s!=='night'){night=false;total+=len;if(state==='shade')shaded+=len}
  const last=segments[segments.length-1];if(last&&last.state===state)last.points.push(proj.toLatLng(to));else segments.push({state,points:[proj.toLatLng(from),proj.toLatLng(to)]})}
 for(let i=1;i<xy.length;i++){const a=xy[i-1],b=xy[i],len=Math.hypot(b.x-a.x,b.y-a.y),n=Math.max(1,Math.ceil(len/step));let prev=a;for(let k=1;k<=n;k++){const t=k/n,next={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};add(prev,next);prev=next}}
 return {segments,shadedRatio:night||!total?null:shaded/total}
}

/** 日陰優先の重み: 日なたの区間を (1 + penalty) 倍の長さとして扱う。辺ごとの結果は覚えておく */
export function shadeFirstCost(g:WalkGraph,stateAt:(p:XY)=>ShadeState,penalty=.7):EdgeCost{
 const memo=new Map<number,number>()
 return (from,to,length)=>{const key=from<to?from*1e6+to:to*1e6+from;let sunny=memo.get(key)
  if(sunny===undefined){const a=g.xy[from],b=g.xy[to],n=Math.max(1,Math.ceil(length/12));let sun=0;for(let k=0;k<n;k++){const t=(k+.5)/n,s=stateAt({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});if(s==='sun')sun++}sunny=sun/n;memo.set(key,sunny)}
  return length*(1+penalty*sunny)}
}
