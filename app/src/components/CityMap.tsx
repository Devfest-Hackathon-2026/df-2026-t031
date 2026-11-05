import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react'
import * as T from 'three'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {createCity,createContext,disposeObject,worldPoint} from './cityGeometry.ts'
import {solarTrack,solarVector} from '../domain/solarScene.ts'
import type {WalkingRoute,RouteContext} from '../domain/routes.ts'
import {AREA_CENTER,EXPLORER_FOCUS} from '../domain/area.ts'
import {formatTime} from '../domain/time.ts'
import type {AreaDataset,LatLng,Spot,SunPosition} from '../domain/types.ts'
export interface CityHandle{zoom:(factor:number)=>void;locate:(p:LatLng)=>void;reset:()=>void;north:()=>void}
interface Props{context:RouteContext;route:WalkingRoute|null;seatColors:Record<string,string>;quality:'balanced'|'light';dataset:AreaDataset;spots:Spot[];selected:string;sun:SunPosition;day:string;minutes:number;showShadow:boolean;showPath:boolean;adding:boolean;onSelect:(id:string)=>void;onPoint:(p:LatLng)=>void;onError:(message:string)=>void;onBearing?:(degrees:number)=>void}
interface Runtime{renderer:T.WebGLRenderer;scene:T.Scene;camera:T.PerspectiveCamera;controls:OrbitControls;sunLight:T.DirectionalLight;hemi:T.HemisphereLight;path:T.Group;orb:T.Mesh;ray:T.Line;markers:T.InstancedMesh|null;anchor:T.Vector3;invalidate:()=>void;flyTo:(p:T.Vector3)=>void;reset:()=>void}
const DEFAULT_FOCUS=EXPLORER_FOCUS
const RADIUS=145
function makeLine(points:T.Vector3[],color:string,opacity=1){return new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color,transparent:opacity<1,opacity}))}
function makeTrack(day:string,anchor:T.Vector3){
 const group=new T.Group(),track=solarTrack(day,AREA_CENTER,RADIUS),points=track.map(p=>new T.Vector3(p.point.x,p.point.y,p.point.z));group.position.copy(anchor)
 if(points.length>=2){const curve=new T.CatmullRomCurve3(points);group.add(new T.Mesh(new T.TubeGeometry(curve,100,.65,5,false),new T.MeshBasicMaterial({color:'#404744',transparent:true,opacity:.75})))}
 const dots=track.filter(p=>p.minute%60===0)
 for(const p of dots){const dot=new T.Mesh(new T.SphereGeometry(1.2,8,6),new T.MeshBasicMaterial({color:'#f7f7eb'}));dot.position.set(p.point.x,p.point.y,p.point.z);group.add(dot)}
 const groundRing=Array.from({length:129},(_,i)=>new T.Vector3(Math.sin(i/128*Math.PI*2)*RADIUS,.45,Math.cos(i/128*Math.PI*2)*RADIUS));group.add(makeLine(groundRing,'#5c685b',.24))
 const directions=[[0,-RADIUS],[RADIUS,0],[0,RADIUS],[-RADIUS,0]]
 for(const [x,z] of directions){const dot=new T.Mesh(new T.CircleGeometry(1.8,12),new T.MeshBasicMaterial({color:'#637a70',side:T.DoubleSide}));dot.rotation.x=-Math.PI/2;dot.position.set(x,.6,z);group.add(dot)}
 return group
}
export default forwardRef<CityHandle,Props>(function CityMap(props,ref){
 const container=useRef<HTMLDivElement>(null),runtime=useRef<Runtime|null>(null),latest=useRef(props),label=useRef<HTMLDivElement>(null),selectedLabel=useRef<HTMLDivElement>(null),[ready,setReady]=useState(false)
 const cameraState=useRef<{position:T.Vector3;target:T.Vector3}|null>(null)
 latest.current=props
 useImperativeHandle(ref,()=>({zoom(factor){const r=runtime.current;if(!r)return;r.camera.position.sub(r.controls.target).multiplyScalar(factor).add(r.controls.target);r.controls.update();r.invalidate()},locate(p){runtime.current?.flyTo(worldPoint(p))},reset(){runtime.current?.reset()},north(){const r=runtime.current;if(!r)return;const distance=r.camera.position.distanceTo(r.controls.target);r.camera.position.copy(r.controls.target).add(new T.Vector3(0,distance*.65,distance*.8));r.controls.update();r.invalidate()}}),[])
 useEffect(()=>{
  const element=container.current!;let renderer:T.WebGLRenderer
  const lightQuality=props.quality==='light'
  try{renderer=new T.WebGLRenderer({antialias:!lightQuality,alpha:false,preserveDrawingBuffer:false,powerPreference:'high-performance'})}catch{latest.current.onError('この端末では3Dを表示できないため、2Dモデルに切り替えます。');return}
  renderer.setPixelRatio(Math.min(devicePixelRatio,lightQuality?1:1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','3D都市。ドラッグで回転、ホイールまたはピンチで拡大縮小。');element.prepend(renderer.domElement)
  const scene=new T.Scene();scene.background=new T.Color('#dce3da');scene.fog=new T.Fog('#dce3da',1900,4200)
  const camera=new T.PerspectiveCamera(43,1,1,6000),anchor=worldPoint(props.spots.find(s=>s.id===props.selected)?.position??DEFAULT_FOCUS,.6);camera.position.copy(anchor).add(new T.Vector3(300,315,-360))
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.copy(anchor);controls.enableDamping=true;controls.dampingFactor=.09;controls.maxPolarAngle=Math.PI*.46;controls.minPolarAngle=.12;controls.minDistance=28;controls.maxDistance=2100;controls.maxTargetRadius=2400;controls.listenToKeyEvents(renderer.domElement);controls.screenSpacePanning=false;controls.saveState()
  if(cameraState.current){camera.position.copy(cameraState.current.position);controls.target.copy(cameraState.current.target);controls.update()}
  const hemi=new T.HemisphereLight('#f2f5ee','#8f9989',2.2);scene.add(hemi)
  const light=new T.DirectionalLight('#fff3df',3);light.castShadow=true;light.shadow.mapSize.set(lightQuality?1024:2048,lightQuality?1024:2048);light.shadow.camera.left=-650;light.shadow.camera.right=650;light.shadow.camera.top=650;light.shadow.camera.bottom=-650;light.shadow.camera.near=5;light.shadow.camera.far=3200;light.shadow.normalBias=.32;light.shadow.bias=-.00008;light.shadow.radius=3;scene.add(light,light.target)
  const city=createCity(props.dataset,lightQuality);scene.add(city);const windowDetail=city.getObjectByName('city-window-detail')
  const orbit=makeTrack(props.day,anchor);scene.add(orbit)
  const orb=new T.Mesh(new T.SphereGeometry(6,20,14),new T.MeshBasicMaterial({color:'#fffdf1',depthTest:false}));orb.renderOrder=4;scene.add(orb)
  const glow=new T.Mesh(new T.SphereGeometry(9.2,16,12),new T.MeshBasicMaterial({color:'#ffedbd',transparent:true,opacity:.16,depthWrite:false}));orb.add(glow)
  const ray=makeLine([anchor.clone(),anchor.clone().add(new T.Vector3(RADIUS,0,0))],'#edac4d');scene.add(ray)
  const origin=new T.Mesh(new T.CircleGeometry(3,20),new T.MeshBasicMaterial({color:'#6e9bba',side:T.DoubleSide}));origin.rotation.x=-Math.PI/2;origin.position.copy(anchor).add(new T.Vector3(0,.6,0));scene.add(origin)
  let dirty=true,frame=0,destination:T.Vector3|null=null,lastBearing=-999,lastStats=0
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches
  const invalidate=()=>{dirty=true}
  const r:Runtime={renderer,scene,camera,controls,sunLight:light,hemi,path:orbit,orb,ray,markers:null,anchor,invalidate,flyTo(p){if(reducedMotion||lightQuality){const offset=p.clone().sub(controls.target);controls.target.copy(p);camera.position.add(offset)}else destination=p.clone();dirty=true},reset(){destination=null;controls.reset();dirty=true}}
  runtime.current=r;controls.addEventListener('change',invalidate)
  let disposed=false
  if(props.dataset.meta.plateauBuildings){new GLTFLoader().load(`${import.meta.env.BASE_URL}data/plateau-nishi.glb`,gltf=>{
   if(disposed){disposeObject(gltf.scene);return}
   const fallback=city.getObjectByName('plateau-fallback');if(fallback){city.remove(fallback);disposeObject(fallback)}
   gltf.scene.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;if(o.material instanceof T.MeshStandardMaterial){o.material.color.set('#d9d5ca');o.material.roughness=1}}})
   scene.add(gltf.scene);renderer.shadowMap.needsUpdate=true;element.dataset.plateau='ready';invalidate()
  },undefined,()=>{element.dataset.plateau='fallback';invalidate()})}
  const resize=()=>{const w=element.clientWidth,h=element.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.clearViewOffset();if(w>900)camera.setViewOffset(w,h,-w*.105,0,w,h);camera.updateProjectionMatrix();dirty=true}
  const observer=new ResizeObserver(resize);observer.observe(element);resize()
  const contextGroup=createContext(props.context);scene.add(contextGroup)
  const raycaster=new T.Raycaster(),pointer=new T.Vector2(),plane=new T.Plane(new T.Vector3(0,1,0),0);let start:{x:number;y:number}|null=null
  const down=(e:PointerEvent)=>{start={x:e.clientX,y:e.clientY}}
  const up=(e:PointerEvent)=>{if(!start||Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera)
   if(latest.current.adding){const point=raycaster.ray.intersectPlane(plane,new T.Vector3());if(point)latest.current.onPoint(cityToGeo(point));return}
   if(r.markers){const hit=raycaster.intersectObject(r.markers)[0];if(hit?.instanceId!==undefined){const spot=latest.current.spots[hit.instanceId];if(spot)latest.current.onSelect(spot.id)}}
  }
  const lost=(e:Event)=>{e.preventDefault();latest.current.onError('3D表示が中断されたため、2Dモデルに切り替えます。')}
  renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('webglcontextlost',lost)
  function animate(){frame=requestAnimationFrame(animate);if(document.hidden)return;if(destination){const move=destination.clone().sub(controls.target).multiplyScalar(.12);controls.target.add(move);camera.position.add(move);dirty=true;if(move.length()<.06)destination=null}
   const changed=controls.update();if(!dirty&&!changed)return
   const selectedSpot=latest.current.spots.find(s=>s.id===latest.current.selected);anchor.copy(worldPoint(selectedSpot?.position??DEFAULT_FOCUS,.6));r.path.position.copy(anchor);origin.position.copy(anchor).add(new T.Vector3(0,.6,0));const sun=latest.current.sun,vector=solarVector(sun,1500),daylight=sun.altitude>0;light.position.copy(controls.target).add(new T.Vector3(vector.x,Math.max(15,vector.y),vector.z));light.target.position.copy(controls.target);light.intensity=daylight?3.1:0;light.castShadow=latest.current.showShadow&&sun.altitude>2;hemi.intensity=daylight?1.75:.7;scene.background=new T.Color(daylight?'#e7e7dd':'#263540');if(scene.fog instanceof T.Fog)scene.fog.color.copy(scene.background)
   r.path.visible=latest.current.showPath;r.orb.visible=latest.current.showPath&&daylight;r.ray.visible=latest.current.showPath&&daylight;const position=solarVector(sun,RADIUS);orb.position.copy(anchor).add(new T.Vector3(position.x,position.y,position.z));ray.geometry.setFromPoints([anchor.clone(),anchor.clone().add(new T.Vector3(position.x,.8,position.z))]);if(windowDetail)windowDetail.visible=camera.position.distanceTo(controls.target)<1050;renderer.render(scene,camera);if(performance.now()-lastStats>1000){element.dataset.drawCalls=String(renderer.info.render.calls);element.dataset.triangles=String(renderer.info.render.triangles);element.dataset.quality=latest.current.quality;lastStats=performance.now()}
   const project=(position:T.Vector3,el:HTMLDivElement|null)=>{if(!el)return;const v=position.clone().project(camera);el.style.display=v.z>1||v.z< -1?'none':'';el.style.transform=`translate3d(${(v.x*.5+.5)*element.clientWidth}px,${(-v.y*.5+.5)*element.clientHeight}px,0)`}
   project(orb.position,label.current);if(label.current)label.current.style.visibility=r.orb.visible?'visible':'hidden'
   const spot=latest.current.spots.find(s=>s.id===latest.current.selected);if(spot)project(worldPoint(spot.position,10),selectedLabel.current);else if(selectedLabel.current)selectedLabel.current.style.display='none'
   const direction=camera.position.clone().sub(controls.target),bearing=Math.round(Math.atan2(direction.x,direction.z)*180/Math.PI);if(bearing!==lastBearing){latest.current.onBearing?.(bearing);lastBearing=bearing}dirty=false
  }animate();setReady(true)
  return()=>{cameraState.current={position:camera.position.clone(),target:controls.target.clone()};disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.removeEventListener('change',invalidate);controls.dispose();renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointerup',up);renderer.domElement.removeEventListener('webglcontextlost',lost);disposeObject(scene);light.shadow.dispose();renderer.dispose();renderer.domElement.remove();runtime.current=null}
 },[props.dataset,props.context,props.quality])
 useEffect(()=>{const r=runtime.current;if(!r)return;const replacement=makeTrack(props.day,r.anchor);r.scene.remove(r.path);disposeObject(r.path);r.path=replacement;r.scene.add(replacement);r.invalidate()},[props.day,props.dataset,props.context,props.quality,ready])
 useEffect(()=>{runtime.current?.invalidate()},[props.sun,props.showShadow,props.showPath,props.minutes])
 const lastSelection=useRef(props.selected)
 useEffect(()=>{const r=runtime.current;if(!r)return;if(r.markers){r.scene.remove(r.markers);disposeObject(r.markers)}
  const markers=new T.InstancedMesh(new T.SphereGeometry(2.4,8,6),new T.MeshBasicMaterial({color:'#ffffff',depthTest:false}),props.spots.length),dummy=new T.Object3D();markers.renderOrder=3
  props.spots.forEach((s,i)=>{const active=s.id===props.selected;dummy.position.copy(worldPoint(s.position,active?5:3));dummy.scale.setScalar(active?2:1);dummy.updateMatrix();markers.setMatrixAt(i,dummy.matrix);markers.setColorAt(i,new T.Color(active?'#f9e8b9':props.seatColors[s.id]||'#7194a2'))});markers.computeBoundingSphere();r.markers=markers;r.scene.add(markers)
  if(lastSelection.current!==props.selected){const spot=props.spots.find(s=>s.id===props.selected);if(spot)r.flyTo(worldPoint(spot.position));lastSelection.current=props.selected}r.invalidate()
 },[props.spots,props.selected,props.seatColors,props.dataset,props.context,props.quality,ready])
 useEffect(()=>{const r=runtime.current;if(!r||!props.route)return;const points=props.route.points.map(p=>worldPoint(p,2.5)),line=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineDashedMaterial({color:'#ed9f49',dashSize:props.route.kind==='estimate'?8:10000,gapSize:props.route.kind==='estimate'?5:0,depthTest:false}));line.computeLineDistances();line.renderOrder=5;r.scene.add(line)
  const bounds=new T.Box3().setFromPoints(points),center=bounds.getCenter(new T.Vector3()),radius=Math.max(100,bounds.getSize(new T.Vector3()).length()/2),halfFov=Math.atan(Math.tan(r.camera.fov*Math.PI/360)*Math.min(1,r.camera.aspect)),distance=Math.min(2050,radius/Math.sin(halfFov)*1.15),direction=r.camera.position.clone().sub(r.controls.target).normalize()
  r.camera.position.copy(r.controls.target).addScaledVector(direction,distance);r.flyTo(center);r.controls.update();r.invalidate();return()=>{r.scene.remove(line);disposeObject(line);r.invalidate()}},[props.route,props.dataset,props.context,props.quality,ready])
 return <div ref={container} className={'city-canvas '+(props.adding?'is-adding':'')} data-renderer-state={ready?'ready':'loading'}>
  {!ready?<div className="scene-loading"><span/>3Dの街並みを準備しています</div>:null}
  <div ref={label} className="scene-sun-label"><span>{formatTime(props.minutes)}</span><small>太陽の位置</small></div>
  <div ref={selectedLabel} className="scene-selected-label"><span>{props.spots.find(s=>s.id===props.selected)?.name||'休憩スポット'}</span></div>
  <div className="scene-keyboard-spots">{props.spots.slice(0,12).map(s=><button key={s.id} onClick={()=>props.onSelect(s.id)}>{s.name||'休憩スポット'}を選択</button>)}</div>
 </div>
})
function cityToGeo(p:T.Vector3){const radians=Math.PI/180,radius=6371008.8;return {lat:AREA_CENTER.lat-p.z/(radius*radians),lng:AREA_CENTER.lng+p.x/(radius*radians*Math.cos(AREA_CENTER.lat*radians))}}
