import {haversineM} from './geo.ts'
import type {LatLng} from './types.ts'

export interface RouteFeature {id:number;kind:'road'|'water';roadType?:string;name?:string;points:[number,number][]}
export interface RouteContext {features:RouteFeature[]}
export interface WalkingRoute {points:LatLng[];distanceM:number;kind:'network'|'estimate';connectorM:number}
interface Vertex {point:LatLng;edges:Map<number,number>}
const WALKABLE=new Set(['footway','path','pedestrian','steps','residential','living_street','service','unclassified','tertiary','track'])

/** Offline OSM connectivity only: access restrictions, crossings and opening hours are not verified. */
export function buildWalkingGraph(context:RouteContext){
 const vertices:Vertex[]=[],ids=new Map<string,number>()
 function vertex(lat:number,lng:number){const key=`${lat.toFixed(6)},${lng.toFixed(6)}`;let id=ids.get(key);if(id===undefined){id=vertices.length;ids.set(key,id);vertices.push({point:{lat,lng},edges:new Map()})}return id}
 for(const feature of context.features){
  if(feature.kind!=='road'||!WALKABLE.has(feature.roadType||''))continue
  for(let i=1;i<feature.points.length;i++){
   const a=feature.points[i-1],b=feature.points[i]
   if(![...a,...b].every(Number.isFinite))continue
   const from=vertex(a[0],a[1]),to=vertex(b[0],b[1]),distance=haversineM(vertices[from].point,vertices[to].point)
   if(distance<.1)continue
   vertices[from].edges.set(to,distance);vertices[to].edges.set(from,distance)
  }
 }
 return vertices
}

export function findWalkingRoute(graph:ReturnType<typeof buildWalkingGraph>,origin:LatLng,destination:LatLng):WalkingRoute{
 const direct=haversineM(origin,destination),estimate:WalkingRoute={points:[origin,destination],distanceM:direct,kind:'estimate',connectorM:direct}
 if(!graph.length)return estimate
 // Consider several nearby nodes so an isolated short path does not mask a connected route.
 const nearby=(point:LatLng)=>graph.map((v,id)=>({id,distance:haversineM(point,v.point)})).filter(v=>v.distance<=100).sort((a,b)=>a.distance-b.distance).slice(0,5)
 const starts=nearby(origin),ends=nearby(destination);if(!starts.length||!ends.length)return estimate
 const distance=Array<number>(graph.length).fill(Infinity),previous=Array<number>(graph.length).fill(-1),visited=new Uint8Array(graph.length),startIds=new Set(starts.map(s=>s.id))
 starts.forEach(s=>distance[s.id]=s.distance)
 const queue:{id:number;cost:number}[]=[]
 function push(id:number,cost:number){let i=queue.length;queue.push({id,cost});while(i>0){const parent=(i-1)>>1;if(queue[parent].cost<=cost)break;queue[i]=queue[parent];i=parent}queue[i]={id,cost}}
 function pop(){const first=queue[0],last=queue.pop()!;if(queue.length){let i=0;while(i*2+1<queue.length){let child=i*2+1;if(child+1<queue.length&&queue[child+1].cost<queue[child].cost)child++;if(queue[child].cost>=last.cost)break;queue[i]=queue[child];i=child}queue[i]=last}return first}
 starts.forEach(s=>push(s.id,s.distance))
 let best=-1,bestCost=Infinity
 while(queue.length){
  const {id:current,cost}=pop()
  if(visited[current])continue
  if(cost>bestCost)break
  visited[current]=1
  const end=ends.find(e=>e.id===current)
  if(end&&cost+end.distance<bestCost){best=current;bestCost=cost+end.distance}
  for(const [next,weight] of graph[current].edges)if(cost+weight<distance[next]){distance[next]=cost+weight;previous[next]=current;push(next,distance[next])}
 }
 if(best<0)return estimate
 const chain:number[]=[];for(let id=best;id>=0;id=previous[id]){chain.push(id);if(startIds.has(id)&&previous[id]<0)break}
 chain.reverse();if(chain.length<2&&direct>30)return estimate
 const connectorM=haversineM(origin,graph[chain[0]].point)+haversineM(destination,graph[chain.at(-1)!].point)
 return {points:[origin,...chain.map(id=>graph[id].point),destination],distanceM:bestCost,kind:'network',connectorM}
}
