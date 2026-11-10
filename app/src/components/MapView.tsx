// 地図（2D のモデル地図・Google マップ・3D の都市模型の切り替え）。2026-11-10 に書き直し（期間中に足した部分はそのまま）
import {memo,lazy,Suspense,useEffect,useMemo,useRef,useState} from 'react'
import {Building2,Plus,Minus,LocateFixed,Navigation,Armchair as Bench,Trash2,Droplets,House,Accessibility,MapPin} from 'lucide-react'
import {LocalProjection} from '../domain/geo.ts'
import {AREA_CENTER} from '../domain/area.ts'
import {isSeatSpot} from '../domain/seat.ts'
import {skyPalette,weatherPalette} from '../domain/skyPalette.ts'
import {OVERCAST} from '../domain/shade.ts'
import {WEATHER_LABEL} from '../lib/weather.ts'
import {Cloud,CloudRain,Snowflake} from 'lucide-react'
import {shadowPolygon,treeShadow} from '../domain/shadowPolygons.ts'
import {loadGoogleMaps} from '../lib/maps.ts'
import type {AreaDataset,LatLng,Spot,SunPosition,WeatherCondition,XY} from '../domain/types.ts'
const CityMap=lazy(()=>import('./CityMap.tsx'))
import {LEVEL_COLOR,type CityHandle,type Bubble} from './CityMap.tsx'
import type {SeatLevel} from '../domain/seat.ts'
import {LANDMARKS} from '../domain/landmarks.ts'
import type {RouteSegment} from '../domain/route.ts'
export type MapMode='model2d'|'model3d'|'google2d'|'google3d'
const projection=new LocalProjection(AREA_CENTER)
/** 地点の表示名（名前がなければ種類） */
export const spotName=(s:Pick<Spot,'name'|'kind'>)=>s.name||KIND_LABEL[s.kind]
export const kindIcons={bench:Bench,shelter:House,picnic:Bench,toilet:Accessibility,trash:Trash2,water:Droplets,indoor:Building2}
export const KIND_LABEL={bench:'ベンチ',shelter:'休憩所',picnic:'ピクニックテーブル',toilet:'トイレ',trash:'ゴミ箱・回収',water:'水飲み場',indoor:'屋内休憩所'}
const ring=(pts:XY[])=>pts.map(p=>`${p.x.toFixed(1)},${(-p.y).toFixed(1)}`).join(' ')
interface Props{dataset:AreaDataset;spots:Spot[];selected:string;sun:SunPosition;day:string;minutes:number;showPath:boolean;mode:MapMode;apiKey:string;location:LatLng;showShadow:boolean;adding:boolean;onSelect:(id:string)=>void;onPoint:(p:LatLng)=>void;onError:(s:string)=>void;onMode:(s:MapMode)=>void;route?:RouteSegment[]|null;levels?:ReadonlyMap<string,SeatLevel>;quality?:'balanced'|'light';onQuality?:()=>void;bubbles?:Bubble[];onBubble?:(id:string)=>void;showLabels?:boolean;weather?:WeatherCondition}
export default memo(function MapView({dataset,spots,selected,sun,day,minutes,showPath,mode,apiKey,location,showShadow,adding,onSelect,onPoint,onError,onMode,route,levels,quality='balanced',onQuality,bubbles,onBubble,showLabels=true,weather}:Props){
 const [view,setView]=useState({x:0,y:0,span:1500}),svg=useRef<SVGSVGElement>(null),drag=useRef<{x:number;y:number;vx:number;vy:number;moved:boolean}|null>(null)
 const city=useRef<CityHandle>(null),googleEl=useRef<HTMLDivElement>(null),gmap=useRef<google.maps.Map|null>(null),gmarkers=useRef<google.maps.Marker[]>([]),[,setBearing]=useState(0)
 const useGoogle=(mode==='google2d'||mode==='google3d')&&!!apiKey.trim()
 // モデル地図の建物・公園・樹木（平面座標に直して 1 回だけ作る）
 const shapes=useMemo(()=>({buildings:dataset.buildings.map(b=>({...b,xy:b.footprint.map(p=>projection.toXY(p))})),parks:dataset.parks.map(p=>p.ring.map(q=>projection.toXY(q))),trees:dataset.trees.map(t=>({...t,xy:projection.toXY(t.position)}))}),[dataset])
 const visible=(p:XY)=>Math.abs(p.x-view.x)<view.span*.75&&Math.abs(-p.y-view.y)<view.span*.6
 const shadows=useMemo(()=>showShadow&&sun.altitude>0?shapes.buildings.filter(b=>Math.abs(b.xy[0].x-view.x)<view.span&&Math.abs(-b.xy[0].y-view.y)<view.span).map(b=>shadowPolygon(b.xy,b.height,sun)).filter((s):s is XY[]=>!!s):[],[showShadow,sun,shapes,view.x,view.y,view.span])
 const treeShadows=useMemo(()=>showShadow&&sun.altitude>0?shapes.trees.filter(t=>visible(t.xy)).map(t=>treeShadow(t.xy,t.height,t.crownRadius,sun)).filter(s=>!!s):[],[showShadow,sun,shapes,view.x,view.y,view.span])
 // 現在地に地図の中心を合わせる（モデル地図）
 useEffect(()=>{const p=projection.toXY(location);if(Math.abs(p.x)<3000&&Math.abs(p.y)<3000)setView(v=>({...v,x:p.x,y:-p.y}))},[location.lat,location.lng])
 // Google マップ: キーがあるときだけ読み込む。失敗したらモデル地図に戻す
 useEffect(()=>{if(!useGoogle||!googleEl.current)return;let off=false
  loadGoogleMaps(apiKey.trim()).then(maps=>{if(off||!googleEl.current)return;gmap.current=new maps.Map(googleEl.current,{center:location,zoom:16,tilt:mode==='google3d'?45:0,heading:0,mapTypeId:'roadmap',clickableIcons:false,disableDefaultUI:true,zoomControl:true,gestureHandling:'greedy'});gmap.current.addListener('click',(e:google.maps.MapMouseEvent)=>{if(adding&&e.latLng)onPoint({lat:e.latLng.lat(),lng:e.latLng.lng()})})}).catch((e:Error)=>{if(!off){onError(e.message);onMode('model2d')}})
  return()=>{off=true;gmarkers.current.forEach(m=>m.setMap(null));gmarkers.current=[];gmap.current=null}},[useGoogle,apiKey,mode])
 // Google マップのピン（空席の色分けを反映）
 useEffect(()=>{const map=gmap.current;if(!useGoogle||!map)return;gmarkers.current.forEach(m=>m.setMap(null));gmarkers.current=spots.slice(0,600).map(s=>{const level=levels?.get(s.id),m=new google.maps.Marker({map,position:s.position,title:spotName(s),icon:{path:google.maps.SymbolPath.CIRCLE,scale:s.id===selected?9:6,fillColor:level?LEVEL_COLOR[level]:isSeatSpot(s)?'#fffdf4':'#cdd8c4',fillOpacity:1,strokeColor:s.id===selected?'#284e42':'#ffffff',strokeWeight:2}});m.addListener('click',()=>onSelect(s.id));return m})},[useGoogle,spots,levels,selected,gmap.current])
 // 新しいルートのときは、2D地図の表示範囲をルート全体に合わせる
 const routeKey=route?.length?`${route[0].points[0].lat},${route[0].points[0].lng}>${route.at(-1)!.points.at(-1)!.lat},${route.at(-1)!.points.at(-1)!.lng}`:''
 useEffect(()=>{if(!route?.length)return;const xy=route.flatMap(s=>s.points).map(p=>projection.toXY(p)),xs=xy.map(p=>p.x),ys=xy.map(p=>-p.y),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);setView({x:(Math.max(...xs)+Math.min(...xs))/2,y:(Math.max(...ys)+Math.min(...ys))/2,span:Math.min(4000,Math.max(500,w*1.3,h*1.45))})},[routeKey])
 const zoom=(f:number)=>setView(v=>({...v,span:Math.min(5000,Math.max(250,v.span*f))}))
 const home=()=>{const p=projection.toXY(location);setView(v=>({...v,x:p.x,y:-p.y,span:Math.min(v.span,1500)}))}
 const user=projection.toXY(location)
 return <div className={'map-content'+(adding?' is-adding':'')}>
  {useGoogle?<div ref={googleEl} className="google-map" aria-label="Google Maps"/>:mode==='model3d'?<Suspense fallback={<div className="scene-loading"><span/>3Dマップを読み込んでいます</div>}><CityMap ref={city} dataset={dataset} spots={spots} selected={selected} sun={sun} day={day} minutes={minutes} showPath={showPath} showShadow={showShadow} adding={adding} onSelect={onSelect} onPoint={onPoint} onBearing={setBearing} route={route} levels={levels} bubbles={bubbles} onBubble={onBubble} showLabels={showLabels} weather={weather} quality={quality} onError={message=>{onError(message);onMode('model2d')}}/></Suspense>:<svg ref={svg} className="model-map" viewBox={`${view.x-view.span/2} ${view.y-view.span*.48} ${view.span} ${view.span*.96}`} role="group" aria-label="OSMの建物と地点を示すモデル地図" onPointerDown={e=>{if((e.target as Element).closest('[data-marker]'))return;drag.current={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y,moved:false};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{const d=drag.current;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>6)d.moved=true;if(d.moved){const k=view.span/(svg.current?.getBoundingClientRect().width||700);setView(v=>({...v,x:d.vx-dx*k,y:d.vy-dy*k}))}}} onPointerUp={e=>{const d=drag.current;if(adding&&d&&!d.moved){const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(e.currentTarget.getScreenCTM()!.inverse());onPoint(projection.toLatLng({x:p.x,y:-p.y}))}drag.current=null}}>
   <rect x={view.x-view.span*2} y={view.y-view.span*2} width={view.span*4} height={view.span*4} fill="#eeede8"/>
   <g className="svg-parks" fill="#cfe8bf">{shapes.parks.map((p,i)=>p.length>=3?<polygon key={i} points={ring(p)}/>:null)}</g>
   <g className="svg-shadows" fill="#5b6472" opacity=".26">{shadows.map((s,i)=><polygon key={i} points={ring(s)}/>)}{treeShadows.map((t,i)=>t?<circle key={'t'+i} cx={t.x} cy={-t.y} r={t.r}/>:null)}</g>
   <g className="svg-buildings">{shapes.buildings.filter(b=>b.xy.length>=3&&visible(b.xy[0])).map(b=><polygon key={b.id} points={ring(b.xy)} fill={b.kind==='roof'?'#e3ddd0':b.height>=60?'#c9d2da':'#ddd8cd'} stroke="#c9c2b4" strokeWidth={.6}/>)}</g>
   <g className="svg-trees" fill="#9fcf8c" opacity=".9">{shapes.trees.filter(t=>visible(t.xy)).map(t=><circle key={t.id} cx={t.xy.x} cy={-t.xy.y} r={t.crownRadius}/>)}</g>
   {(()=>{const p=weatherPalette(skyPalette(sun.altitude),weather);return p.tintOpacity>.01?<rect className="sky-tint" x="-6000" y="-6000" width="12000" height="12000" fill={p.tint} opacity={p.tintOpacity} style={{mixBlendMode:'multiply'}} pointerEvents="none"/>:null})()}
   {route?.length?<g className="route-line" fill="none" strokeLinecap="round" strokeLinejoin="round"><polyline points={route.flatMap(s=>s.points).map(p=>{const q=projection.toXY(p);return `${q.x},${-q.y}`}).join(' ')} stroke="#ffffff" strokeWidth={11*view.span/1500}/>{route.map((s,i)=><polyline key={i} points={s.points.map(p=>{const q=projection.toXY(p);return `${q.x},${-q.y}`}).join(' ')} stroke={s.state==='shade'?'#3d5f86':s.state==='sun'?'#f0952c':'#8a9099'} strokeWidth={6*view.span/1500}/>)}</g>:null}
   <g className="svg-user" pointerEvents="none"><circle cx={user.x} cy={-user.y} r={18*view.span/1500} fill="#4a8bd6" opacity=".18"/><circle cx={user.x} cy={-user.y} r={7*view.span/1500} fill="#4a8bd6" stroke="#ffffff" strokeWidth={2.5*view.span/1500}/></g>
   {spots.filter(s=>visible(projection.toXY(s.position))).map(s=>{const p=projection.toXY(s.position),active=s.id===selected,Icon=kindIcons[s.kind],k=view.span/1250;return <g key={s.id} data-marker role="button" tabIndex={0} aria-label={spotName(s)} className={'map-marker '+(active?'active':'')} transform={`translate(${p.x} ${-p.y}) scale(${k})`} onClick={e=>{e.stopPropagation();onSelect(s.id)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(s.id)}}}>{(()=>{const level=levels?.get(s.id),color=level?LEVEL_COLOR[level]:null;return <><circle r={active?23:16} fill={active?'#284e42':color??(isSeatSpot(s)?'#fffdf4':'#f2f5e9')} stroke={active?color??'#dceb9c':color?'#ffffff':'#bfcdb8'} strokeWidth={active?5:color?2.5:1.5}/><g transform="translate(-8 -8)"><Icon size={16} color={active?'#ecf1c9':color?'#ffffff':'#4e6956'} strokeWidth={1.8}/></g></>})()}{active&&!bubbles?.some(b=>b.id===s.id)?<g><rect x="-91" y="-62" width="182" height="29" rx="14.5" fill="#284e42"/><text y="-43" textAnchor="middle" fill="white" fontSize="12">{spotName(s).slice(0,14)}</text></g>:null}</g>})}
   {showLabels?(()=>{const k=view.span/(svg.current?.getBoundingClientRect().width||700);return <g className="svg-landmarks" pointerEvents="none">{LANDMARKS.filter(l=>l.rank===1||view.span<1800).map(l=>{const p=projection.toXY(l.position);return <text key={l.label} x={p.x} y={-p.y-14*k} textAnchor="middle" fontSize={11*k} fontWeight="700" fill="#33373c" stroke="#fbfaf5" strokeWidth={3.2*k} paintOrder="stroke">{l.label}</text>})}</g>})():null}
   {bubbles?.slice().reverse().map(b=>{const p=projection.toXY(b.position),k=view.span/(svg.current?.getBoundingClientRect().width||700),pick=b.kind==='pick',fill=pick?'#ffd24d':'#fffdf7',ring=pick?'#ffffff':b.level?LEVEL_COLOR[b.level]:'#cfd6cc',r=pick?24:19;return <g key={'bubble'+b.id} data-marker role="button" tabIndex={0} aria-label={pick?`おすすめ: ${b.label}`:`候補${b.rank}: ${b.label}`} className={'svg-bubble'+(b.active?' is-active':'')} transform={`translate(${p.x} ${-p.y}) scale(${k*(b.active?1.12:1)})`} onClick={e=>{e.stopPropagation();onBubble?.(b.id)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onBubble?.(b.id)}}}>
    <path d={`M -9 ${-r-14} L 0 -10 L 9 ${-r-14} Z`} fill={ring}/><circle cy={-r-22} r={r} fill={fill} stroke={ring} strokeWidth="3.5"/>{b.active?<circle cy={-r-22} r={r+6} fill="none" stroke="#ffffff" strokeWidth="3" opacity=".8"/>:null}
    {pick?<text y={-r-11} textAnchor="middle" fontSize="30" fontWeight="900" fill="#3a2a00">!</text>:<><g transform={`translate(-9 ${-r-31})`}><Bench size={18} color={ring} strokeWidth={2.2}/></g><circle cx={r-3} cy={-2*r-17} r="9" fill="#3a3d42" stroke="#fffdf7" strokeWidth="2"/><text x={r-3} y={-2*r-13} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{b.rank}</text></>}</g>})}
  </svg>}
  {weather&&mode!=='model3d'&&['rain','heavy-rain','snow'].includes(weather)?<div className={'weather-fx fx-'+weather} aria-hidden="true"/>:null}{weather&&OVERCAST.has(weather)?<div className="weather-badge" role="status">{weather==='snow'?<Snowflake size={13}/>:weather==='rain'||weather==='heavy-rain'?<CloudRain size={13}/>:<Cloud size={13}/>}{WEATHER_LABEL[weather]}<small>日差しなし・街全体が日陰</small></div>:null}
  {/* 2DはGoogleマップ（キーがないときはモデル地図）、3DはOSMのモデル */}<div className="map-mode"><button aria-label="2D地図" aria-pressed={mode==='model2d'||mode==='google2d'} onClick={()=>onMode(apiKey.trim()?'google2d':'model2d')}>2D</button><button aria-label="3Dモデル" aria-pressed={mode==='model3d'} onClick={()=>onMode('model3d')}>3D</button>{useGoogle?<span>Google {mode==='google3d'?'3D':'2D'}</span>:null}</div>
  {!useGoogle&&mode!=='model3d'?<div className="map-tools"><button aria-label="拡大" onClick={()=>zoom(.7)}><Plus size={18}/></button><button aria-label="縮小" onClick={()=>zoom(1.4)}><Minus size={18}/></button><button aria-label="現在地に戻る" onClick={home}><LocateFixed size={18}/></button></div>:null}
  {onQuality?<button className="quality-toggle" aria-pressed={quality==='light'} onClick={onQuality}>{quality==='light'?'軽量表示':'標準表示'}</button>:null}
  {adding?<div className="map-key" role="status"><MapPin size={14}/>地図をタップして場所を選んでください</div>:route?.length?<div className="map-key"><Navigation size={14}/><i className="key-shade"/>日陰<i className="key-sun"/>日なた</div>:null}
  <p className="attribution">{useGoogle?'日陰判定はOSM由来の別モデル · ':''}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>{dataset.meta.plateauBuildings?<> · <a href="https://www.mlit.go.jp/plateau/site-policy/" target="_blank" rel="noreferrer">PLATEAU 横浜2024・加工</a></>:null} · {useGoogle?'':'建物・公園のモデル表示'}</p>
 </div>
})

