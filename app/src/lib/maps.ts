import type {Spot} from '../domain/types.ts'
import {AREA_CENTER} from '../domain/area.ts'
let loading:Promise<void>|null=null
type G3Element=HTMLElement&{center:unknown}
type G3Library={Map3DElement:new(options:unknown)=>G3Element;Marker3DInteractiveElement:new(options:unknown)=>HTMLElement}
export interface ConnectedMap{update:(spots:Spot[],selected:string)=>void;destroy:()=>void}
function loadGoogle(key:string){
 if(typeof google!=='undefined'&&typeof google.maps?.importLibrary==='function')return Promise.resolve()
 if(loading)return loading
 loading=new Promise<void>((resolve,reject)=>{
  const script=document.createElement('script')
  const done=()=>{clearTimeout(timer);resolve()}
  const fail=()=>{clearTimeout(timer);script.remove();loading=null;reject(Error('Google Mapsを読み込めませんでした。APIキーと利用制限をご確認ください。'))}
  const hooks=window as unknown as {epokuGoogleReady:()=>void;gm_authFailure:()=>void}
  const timer=setTimeout(fail,20000);hooks.epokuGoogleReady=done;hooks.gm_authFailure=()=>{fail();window.dispatchEvent(new Event('epoku-map-auth-error'))};script.onerror=fail
  script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=beta&loading=async&callback=epokuGoogleReady&language=ja`;script.async=true;document.head.append(script)
 });return loading
}
export async function connectGoogle(container:HTMLDivElement,key:string,mode:'google2d'|'google3d',onSelect:(id:string)=>void):Promise<ConnectedMap>{
 await loadGoogle(key)
 if(mode==='google3d'){
  const {Map3DElement,Marker3DInteractiveElement}=await google.maps.importLibrary('maps3d') as unknown as G3Library
  const map=new Map3DElement({center:{...AREA_CENTER,altitude:0},range:2300,tilt:58,heading:25,mode:'HYBRID'});map.style.height='100%';container.replaceChildren(map);let markers:HTMLElement[]=[]
  return {update(spots){markers.forEach(m=>m.remove());markers=spots.map(s=>{const m=new Marker3DInteractiveElement({position:{...s.position,altitude:3},label:s.name||'休憩スポット'});m.addEventListener('gmp-click',()=>onSelect(s.id));map.append(m);return m})},destroy(){map.remove()}}
 }
 const [{Map},{AdvancedMarkerElement}]=await Promise.all([google.maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>,google.maps.importLibrary('marker') as Promise<google.maps.MarkerLibrary>])
 const map=new Map(container,{center:AREA_CENTER,zoom:16,mapId:'DEMO_MAP_ID',streetViewControl:false,mapTypeControl:false});let markers:google.maps.marker.AdvancedMarkerElement[]=[]
 return {update(spots,selected){markers.forEach(m=>m.map=null);markers=spots.map(s=>{const el=document.createElement('span');el.className='google-pin'+(s.id===selected?' active':'');el.textContent=s.kind==='toilet'?'WC':s.kind==='trash'?'♲':'●';const m=new AdvancedMarkerElement({map,position:s.position,title:s.name||'休憩スポット',content:el});m.addListener('click',()=>onSelect(s.id));return m})},destroy(){markers.forEach(m=>m.map=null);container.replaceChildren()}}
}
