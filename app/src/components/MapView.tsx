import {lazy,memo,Suspense,useEffect,useMemo,useRef,useState} from 'react'
import {Plus,Minus,LocateFixed,Navigation,Armchair as Bench,Trash2,Droplets,House,Accessibility,MapPin} from 'lucide-react'
import {LocalProjection} from '../domain/geo.ts'
import {AREA_CENTER,DEMO_USER_LOCATION} from '../domain/area.ts'
import {buildShadowShapes} from '../domain/shadowPolygons.ts'
import {isSeatSpot} from '../domain/seat.ts'
import type {AreaDataset,LatLng,Spot,SunPosition,XY} from '../domain/types.ts'
import {connectGoogle,type ConnectedMap} from '../lib/maps.ts'
import {LEVEL_COLOR,type CityHandle} from './CityMap.tsx'
import type {SeatLevel} from '../domain/seat.ts'
import type {RouteSegment} from '../domain/route.ts'
const CityMap=lazy(()=>import('./CityMap.tsx'))
export type MapMode='model2d'|'model3d'|'google2d'|'google3d'
const projection=new LocalProjection(AREA_CENTER)
const path=(ring:XY[],dx=0,dy=0)=>ring.map(p=>`${p.x+dx},${-p.y+dy}`).join(' ')
export const kindIcons={bench:Bench,shelter:House,picnic:Bench,toilet:Accessibility,trash:Trash2,water:Droplets}
export const KIND_LABEL={bench:'ベンチ',shelter:'休憩所',picnic:'ピクニックテーブル',toilet:'トイレ',trash:'ゴミ箱・回収',water:'水飲み場'}
export const spotName=(s:Spot)=>s.name||KIND_LABEL[s.kind]
interface Props{dataset:AreaDataset;spots:Spot[];selected:string;sun:SunPosition;day:string;minutes:number;showPath:boolean;mode:MapMode;apiKey:string;location:LatLng;showShadow:boolean;adding:boolean;onSelect:(id:string)=>void;onPoint:(p:LatLng)=>void;onError:(s:string)=>void;onMode:(s:MapMode)=>void;route?:RouteSegment[]|null;levels?:ReadonlyMap<string,SeatLevel>}
export default memo(function MapView({dataset,spots,selected,sun,day,minutes,showPath,mode,apiKey,location,showShadow,adding,onSelect,onPoint,onError,onMode,route,levels}:Props){
 const city=useRef<CityHandle>(null),[bearing,setBearing]=useState(0)
 const [view,setView]=useState({x:0,y:180,span:1500});const googleEl=useRef<HTMLDivElement>(null),connected=useRef<ConnectedMap|null>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<{x:number;y:number;vx:number;vy:number;moved:boolean}|null>(null)
 const useGoogle=mode.startsWith('google')
 const callbacks=useRef({onSelect,onError,onMode});callbacks.current={onSelect,onError,onMode}
 const latest=useRef({spots,selected});latest.current={spots,selected}
 useEffect(()=>{
  if(!useGoogle)return
  let cancelled=false
  connectGoogle(googleEl.current!,apiKey,mode as 'google2d'|'google3d',id=>callbacks.current.onSelect(id)).then(m=>{if(cancelled){m.destroy();return}connected.current=m;m.update(latest.current.spots,latest.current.selected)}).catch(e=>{if(!cancelled){callbacks.current.onError(e.message);callbacks.current.onMode('model2d')}})
  const auth=()=>{callbacks.current.onError('Google Mapsの認証に失敗しました。モデル地図に戻りました。');callbacks.current.onMode('model2d')};window.addEventListener('epoku-map-auth-error',auth)
  return()=>{cancelled=true;connected.current?.destroy();connected.current=null;window.removeEventListener('epoku-map-auth-error',auth)}
 },[mode,apiKey,useGoogle])
 useEffect(()=>{connected.current?.update(spots,selected)},[spots,selected])
 useEffect(()=>{const s=latest.current.spots.find(s=>s.id===selected);if(!s)return;const p=projection.toXY(s.position);setView(v=>Math.abs(p.x-v.x)>v.span*.32||Math.abs(-p.y-v.y)>v.span*.26?{...v,x:p.x,y:-p.y}:v)},[selected])
 // 新しいルートのときは、2D地図の表示範囲をルート全体に合わせる
 const routeKey=route?.length?`${route[0].points[0].lat},${route[0].points[0].lng}>${route.at(-1)!.points.at(-1)!.lat},${route.at(-1)!.points.at(-1)!.lng}`:''
 useEffect(()=>{if(!route?.length)return;const xy=route.flatMap(s=>s.points).map(p=>projection.toXY(p)),xs=xy.map(p=>p.x),ys=xy.map(p=>-p.y),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);setView({x:(Math.max(...xs)+Math.min(...xs))/2,y:(Math.max(...ys)+Math.min(...ys))/2,span:Math.min(4000,Math.max(500,w*1.3,h*1.45))})},[routeKey])
 const geography=useMemo(()=>({buildings:dataset.buildings.map(b=>({...b,xy:b.footprint.map(p=>projection.toXY(p))})),trees:dataset.trees.map(t=>({...t,xy:projection.toXY(t.position)})),parks:dataset.parks.map(p=>({...p,xy:p.ring.map(q=>projection.toXY(q))}))}),[dataset])
 const shadows=useMemo(()=>showShadow&&mode==='model2d'?buildShadowShapes(dataset.buildings,dataset.trees,sun,projection):{buildings:[],trees:[]},[dataset,sun,showShadow,mode])
 const visible=(p:XY)=>Math.abs(p.x-view.x)<view.span*.7&&Math.abs(-p.y-view.y)<view.span*.7
 const origin=projection.toXY(location),three=mode==='model3d'
 const locate=()=>{const p=projection.toXY(location);setView(v=>({...v,x:p.x,y:-p.y}))}
 return <div className={`map-content ${adding?'adding':''}`}>
  {useGoogle?<div ref={googleEl} className="google-map" aria-label="Google Maps"/>:mode==='model3d'?<Suspense fallback={<div className="scene-loading"><span/>3Dマップを読み込んでいます</div>}><CityMap ref={city} dataset={dataset} spots={spots} selected={selected} sun={sun} day={day} minutes={minutes} showPath={showPath} showShadow={showShadow} adding={adding} onSelect={onSelect} onPoint={onPoint} onBearing={setBearing} route={route} levels={levels} onError={message=>{onError(message);onMode('model2d')}}/></Suspense>:<svg ref={svg} className="model-map" viewBox={`${view.x-view.span/2} ${view.y-view.span*.48} ${view.span} ${view.span*.96}`} role="group" aria-label="OSMの建物と地点を示すモデル地図" onPointerDown={e=>{if((e.target as Element).closest('[data-marker]'))return;drag.current={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y,moved:false};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{const d=drag.current;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>6)d.moved=true;if(d.moved){const k=view.span/(svg.current?.getBoundingClientRect().width||700);setView(v=>({...v,x:d.vx-dx*k,y:d.vy-dy*k}))}}} onPointerUp={e=>{const d=drag.current;if(adding&&d&&!d.moved){const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(e.currentTarget.getScreenCTM()!.inverse());onPoint(projection.toLatLng({x:p.x,y:-p.y}))}drag.current=null}}>
   <defs><pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1.5" fill="#d9dece"/></pattern></defs>
   <rect x="-6000" y="-6000" width="12000" height="12000" fill="#eff0e3"/><rect x="-6000" y="-6000" width="12000" height="12000" fill="url(#grid)"/>
   {geography.parks.map(p=><polygon key={p.id} points={path(p.xy)} fill="#d5dfba" stroke="#c8d3b0" strokeWidth="2"/>)}
   <g opacity=".19" fill="#355c50">{shadows.buildings.map((ring,i)=><polygon key={'b'+i} points={path(ring)}/>)}{shadows.trees.map((ring,i)=><polygon key={'t'+i} points={path(ring)}/>)}</g>
   {geography.buildings.filter(b=>b.xy.some(visible)).map(b=>{const z=three?b.height*.8:0;return <g key={b.id}>{three?<polygon points={path(b.xy)+' '+path([...b.xy].reverse(),-z*.2,-z)} fill="#abb8a6"/>:null}<polygon points={path(b.xy,-z*.2,-z)} fill={b.kind==='roof'?'#d0dbbd':'#e1e2d3'} stroke="#c4cbb8" strokeWidth="1.5"/></g>})}
   {geography.trees.filter(t=>visible(t.xy)).map(t=><circle key={t.id} cx={t.xy.x} cy={-t.xy.y} r={Math.max(3,t.crownRadius)} fill="#a6ba90" opacity=".9"/>)}
   {route?.length?<g className="route-line" fill="none" strokeLinecap="round" strokeLinejoin="round"><polyline points={route.flatMap(s=>s.points).map(p=>{const q=projection.toXY(p);return `${q.x},${-q.y}`}).join(' ')} stroke="#ffffff" strokeWidth={11*view.span/1500}/>{route.map((s,i)=><polyline key={i} points={s.points.map(p=>{const q=projection.toXY(p);return `${q.x},${-q.y}`}).join(' ')} stroke={s.state==='shade'?'#3d5f86':s.state==='sun'?'#f0952c':'#8a9099'} strokeWidth={6*view.span/1500}/>)}</g>:null}
   <circle cx={origin.x} cy={-origin.y} r={28*view.span/1500} fill="#6b93c1" opacity=".15"/><circle cx={origin.x} cy={-origin.y} r={8*view.span/1500} fill="#5a8ec3" stroke="white" strokeWidth="3"/>
   {spots.filter(s=>visible(projection.toXY(s.position))).map(s=>{const p=projection.toXY(s.position),active=s.id===selected,Icon=kindIcons[s.kind],k=view.span/1250;return <g key={s.id} data-marker role="button" tabIndex={0} aria-label={spotName(s)} className={'map-marker '+(active?'active':'')} transform={`translate(${p.x} ${-p.y}) scale(${k})`} onClick={e=>{e.stopPropagation();onSelect(s.id)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(s.id)}}}>{(()=>{const level=levels?.get(s.id),color=level?LEVEL_COLOR[level]:null;return <><circle r={active?23:16} fill={active?'#284e42':color??(isSeatSpot(s)?'#fffdf4':'#f2f5e9')} stroke={active?color??'#dceb9c':color?'#ffffff':'#bfcdb8'} strokeWidth={active?5:color?2.5:1.5}/><g transform="translate(-8 -8)"><Icon size={16} color={active?'#ecf1c9':color?'#ffffff':'#4e6956'} strokeWidth={1.8}/></g></>})()}{active?<g><rect x="-91" y="-62" width="182" height="29" rx="14.5" fill="#284e42"/><text y="-43" textAnchor="middle" fill="white" fontSize="12">{spotName(s).slice(0,14)}</text></g>:null}</g>})}
  </svg>}
  <div className="map-mode"><button aria-label="2Dモデル" aria-pressed={mode==='model2d'} onClick={()=>onMode('model2d')}>2D</button><button aria-label="3Dモデル" aria-pressed={mode==='model3d'} onClick={()=>onMode('model3d')}>3D</button>{useGoogle?<span>Google {mode==='google3d'?'3D':'2D'}</span>:null}</div>
  <button className="north" aria-label="北を上に" onClick={()=>city.current?.north()}><Navigation size={17} fill="currentColor" style={{transform:`rotate(${mode==='model3d'?-bearing:0}deg)`}}/><span>N</span></button>
  {!useGoogle?<div className="map-tools"><button aria-label="拡大" onClick={()=>mode==='model3d'?city.current?.zoom(.8):setView(v=>({...v,span:Math.max(350,v.span*.75)}))}><Plus size={19}/></button><button aria-label="縮小" onClick={()=>mode==='model3d'?city.current?.zoom(1.25):setView(v=>({...v,span:Math.min(4000,v.span/ .75)}))}><Minus size={19}/></button><button aria-label="基準地点に戻る" onClick={()=>mode==='model3d'?city.current?.locate(location):locate()}><LocateFixed size={19}/></button><button aria-label={mode==='model3d'?'最初の視点に戻る':'エリア全体'} onClick={()=>mode==='model3d'?city.current?.reset():setView({x:0,y:0,span:2300})}><MapPin size={19}/></button></div>:null}
  <div className="map-key"><span><i className="shade-dot"/>予測される日陰</span><span><i className="origin-dot"/>{location.lat===DEMO_USER_LOCATION.lat?'基準地点（桜木町）':'端末の現在地'}</span></div>
  <p className="attribution">{useGoogle?'日陰判定はOSM由来の別モデル · ':''}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · {useGoogle?'':'建物・公園のモデル表示'}</p>
 </div>
})
