import {Armchair} from 'lucide-react'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {createCity,createContext,disposeObject,worldPoint,strip,tintByHeight,type CityContext} from './cityGeometry.ts'
import {LANDMARKS} from '../domain/landmarks.ts'
import {skyPalette,weatherPalette,WEATHER_LOOK} from '../domain/skyPalette.ts'
const WEATHER_LOOK_OF=(c:WeatherCondition|undefined)=>WEATHER_LOOK[c??'clear']??WEATHER_LOOK.clear
import type {AreaDataset,LatLng,Spot,SunPosition,WeatherCondition} from '../domain/types.ts'
import type {RouteSegment} from '../domain/route.ts'
import type {SeatLevel} from '../domain/seat.ts'
/** 空席確率による色: 緑＝座れそう・黄＝五分五分・赤＝混みそう */
export const LEVEL_COLOR:Record<SeatLevel,string>={high:'#4f9d69',mid:'#dcae35',low:'#d9604c'}
interface Props{dataset:AreaDataset;spots:Spot[];selected:string;sun:SunPosition;day:string;minutes:number;showShadow:boolean;showPath:boolean;adding:boolean;onSelect:(id:string)=>void;onPoint:(p:LatLng)=>void;onError:(message:string)=>void;onBearing?:(degrees:number)=>void;route?:RouteSegment[]|null;levels?:ReadonlyMap<string,SeatLevel>;quality?:'balanced'|'light';bubbles?:Bubble[];onBubble?:(id:string)=>void;showLabels?:boolean;weather?:WeatherCondition}
/** 建物の上に浮かぶ吹き出しのピン。pick＝一番のおすすめ（「!」）、cand＝ほかの候補（ベンチと順位） */
export interface Bubble{id:string;position:LatLng;kind:'pick'|'cand';rank:number;level?:SeatLevel;active:boolean;label:string}
interface Runtime{renderer:T.WebGLRenderer;scene:T.Scene;camera:T.PerspectiveCamera;controls:OrbitControls;sunLight:T.DirectionalLight;hemi:T.HemisphereLight;path:T.Group;orb:T.Mesh;ray:T.Line;markers:T.InstancedMesh|null;route:T.Group|null;anchor:T.Vector3;invalidate:()=>void;flyTo:(p:T.Vector3,distance?:number)=>void;reset:()=>void}
function groundStrip(azimuth:number,from:number,to:number,width:number,color:string,y=.7){
 const length=to-from,geometry=new T.PlaneGeometry(width,length);geometry.rotateX(-Math.PI/2);geometry.translate(0,y,-(from+length/2))
 const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({color,transparent:true,opacity:.95,depthWrite:false}));mesh.rotation.y=-azimuth*Math.PI/180;mesh.renderOrder=2;return mesh
}
/** Sunlitt 風の日時計: 地平線の円・目盛り・北の印・日の出／日の入りの方向・太陽の軌道・中心の石柱 */
 if(points.length>=2){const curve=new T.CatmullRomCurve3(points);group.add(new T.Mesh(new T.TubeGeometry(curve,120,.9,6,false),new T.MeshBasicMaterial({color:'#3a3d42',transparent:true,opacity:.82})))}
 for(const p of dots){const dot=new T.Mesh(new T.SphereGeometry(1.3,8,6),new T.MeshBasicMaterial({color:'#ffffff'}));dot.position.set(p.point.x,p.point.y,p.point.z);group.add(dot)}
 const groundRing=Array.from({length:161},(_,i)=>new T.Vector3(Math.sin(i/160*Math.PI*2)*RADIUS,.5,Math.cos(i/160*Math.PI*2)*RADIUS));group.add(makeLine(groundRing,'#55595f',.42))
 for(let a=0;a<360;a+=15){if(a===0)continue;group.add(groundStrip(a,RADIUS*(a%90===0?.9:.94),RADIUS*.99,a%90===0?1.1:.7,'#6b6f76',.55))}
 const north=new T.Shape();north.moveTo(0,RADIUS*1.05);north.lineTo(-3.6,RADIUS*.95);north.lineTo(3.6,RADIUS*.95);north.closePath()
 const northMesh=new T.Mesh(new T.ShapeGeometry(north),new T.MeshBasicMaterial({color:'#e4483b',side:T.DoubleSide,depthWrite:false}));northMesh.rotation.x=-Math.PI/2;northMesh.position.y=.75;northMesh.renderOrder=2;group.add(northMesh)
 if(track.length>=2){
  group.add(groundStrip(track[0].sun.azimuth,4,RADIUS,1.7,'#f29d38'))
  group.add(groundStrip(track[track.length-1].sun.azimuth,4,RADIUS,1.7,'#6f8ea8'))
 }
 const monolith=new T.Mesh(new T.BoxGeometry(7,11,7),new T.MeshStandardMaterial({color:'#f8f8f9',roughness:.6}));monolith.position.y=5.5;monolith.castShadow=true;monolith.receiveShadow=true;group.add(monolith)
 const bubbleEls=useRef(new Map<string,HTMLDivElement>()),labelEls=useRef<(HTMLDivElement|null)[]>([])
 const cameraState=useRef<{position:T.Vector3;target:T.Vector3}|null>(null)
  const lightQuality=props.quality==='light'
  try{renderer=new T.WebGLRenderer({antialias:!lightQuality,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'})}catch{latest.current.onError('この端末では3Dを表示できないため、2Dモデルに切り替えます。');return}
  renderer.setPixelRatio(Math.min(devicePixelRatio,lightQuality?1:innerWidth<700?1.35:1.75));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.22;renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','3D都市。ドラッグで回転、ホイールまたはピンチで拡大縮小。');element.prepend(renderer.domElement)
  const scene=new T.Scene();scene.background=new T.Color('#efe6e2');scene.fog=new T.Fog('#efe6e2',1700,4000)
  if(cameraState.current){camera.position.copy(cameraState.current.position);controls.target.copy(cameraState.current.target);controls.update()}
  const hemi=new T.HemisphereLight('#f6f5f3','#a5a29b',2.2);scene.add(hemi)
  const light=new T.DirectionalLight('#fff3df',3);light.castShadow=true;light.shadow.mapSize.set(lightQuality?1024:innerWidth<700?1536:2048,lightQuality?1024:innerWidth<700?1536:2048);light.shadow.camera.left=-650;light.shadow.camera.right=650;light.shadow.camera.top=650;light.shadow.camera.bottom=-650;light.shadow.camera.near=5;light.shadow.camera.far=3200;light.shadow.normalBias=.32;light.shadow.bias=-.00008;light.shadow.radius=3;scene.add(light,light.target)
  const city=createCity(props.dataset,lightQuality);scene.add(city);const wheelLights=(city.getObjectByName('ferris-wheel')?.userData.lights??[]) as T.MeshStandardMaterial[];const windowDetail=city.getObjectByName('city-window-detail')
  const origin=new T.Mesh(new T.CircleGeometry(3,20),new T.MeshBasicMaterial({color:'#6e9bba',side:T.DoubleSide}));origin.rotation.x=-Math.PI/2;origin.position.copy(anchor).add(new T.Vector3(0,.6,0));origin.visible=false;scene.add(origin)
  // 雨・雪の粒。カメラの前の箱の中を落とし続ける（降っていないときは隠す）
  const DROPS=lightQuality?700:1800,dropPos=new Float32Array(DROPS*6),dropSeed=Float32Array.from({length:DROPS*3},()=>Math.random())
  const dropGeo=new T.BufferGeometry();dropGeo.setAttribute('position',new T.BufferAttribute(dropPos,3))
  const dropMat=new T.LineBasicMaterial({color:'#e4ebf2',transparent:true,opacity:.5,depthWrite:false})
  const drops=new T.LineSegments(dropGeo,dropMat);drops.frustumCulled=false;drops.visible=false;drops.renderOrder=6;scene.add(drops)
  const moveDrops=(kind:'rain'|'snow',amount:number,t:number)=>{
   const c=camera.position.clone().lerp(controls.target,.3),dist=camera.position.distanceTo(controls.target),B=Math.max(140,Math.min(700,dist*.75)),H=B*.8
   const n=Math.round(DROPS*amount),speed=kind==='rain'?H*1.3:H*.1,len=kind==='rain'?H*.045:H*.008
   for(let i=0;i<n;i++){const a=dropSeed[i*3],b=dropSeed[i*3+1],d=dropSeed[i*3+2],fall=((b*H+t*speed*(.8+d*.4))%H),sway=kind==='snow'?Math.sin(t*1.3+a*20)*H*.015:0
    const x=c.x+(a-.5)*B+sway,y=c.y+H/2-fall,z=c.z+(d-.5)*B,o=i*6
    dropPos[o]=x;dropPos[o+1]=y;dropPos[o+2]=z;dropPos[o+3]=x+(kind==='rain'?len*.12:len*.3);dropPos[o+4]=y-len;dropPos[o+5]=z}
   dropGeo.setDrawRange(0,n*2);dropGeo.attributes.position.needsUpdate=true
   dropMat.color.set(kind==='rain'?'#dfe6ee':'#ffffff');dropMat.opacity=kind==='rain'?.42+amount*.18:.85}
  let dirty=true,frame=0,destination:T.Vector3|null=null,destinationDistance:number|null=null,lastBearing=-999,lastStats=0
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches
  const r:Runtime={renderer,scene,camera,controls,sunLight:light,hemi,path:orbit,orb,ray,markers:null,route:null,anchor,invalidate,flyTo(p,distance){if(reducedMotion||lightQuality){const offset=p.clone().sub(controls.target);controls.target.copy(p);camera.position.add(offset);if(distance){const o=camera.position.clone().sub(controls.target);camera.position.copy(controls.target).add(o.setLength(distance))}}else{destination=p.clone();destinationDistance=distance??null}dirty=true},reset(){destination=null;destinationDistance=null;controls.reset();dirty=true}}
  let disposed=false
  if(props.dataset.meta.plateauBuildings){new GLTFLoader().load(`${import.meta.env.BASE_URL}data/plateau-nishi.glb`,gltf=>{
   if(disposed){disposeObject(gltf.scene);return}
   const fallback=city.getObjectByName('plateau-fallback');if(fallback){city.remove(fallback);disposeObject(fallback)}
   gltf.scene.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;if(o.material instanceof T.MeshStandardMaterial)tintByHeight(o)}})
   scene.add(gltf.scene);renderer.shadowMap.needsUpdate=true;element.dataset.plateau='ready';invalidate()
  },undefined,()=>{element.dataset.plateau='fallback';invalidate()})}
  function animate(){frame=requestAnimationFrame(animate);if(document.hidden)return;if(destination){const move=destination.clone().sub(controls.target).multiplyScalar(.12);controls.target.add(move);camera.position.add(move);if(destinationDistance){const offset=camera.position.clone().sub(controls.target),d=offset.length();offset.setLength(d+(destinationDistance-d)*.12);camera.position.copy(controls.target).add(offset)}dirty=true;if(move.length()<.06){destination=null;destinationDistance=null}}
   const changed=controls.update(),look=WEATHER_LOOK_OF(latest.current.weather);if(look.precip&&!reducedMotion)dirty=true;if(!dirty&&!changed)return
   anchor.copy(controls.target);r.path.position.copy(anchor);origin.position.copy(anchor).add(new T.Vector3(0,.6,0));const sun=latest.current.sun,vector=solarVector(sun,1500),daylight=sun.altitude>0;light.position.copy(controls.target).add(new T.Vector3(vector.x,Math.max(15,vector.y),vector.z));light.target.position.copy(controls.target);const palette=weatherPalette(skyPalette(sun.altitude),latest.current.weather);for(const m of wheelLights)m.emissiveIntensity=sun.altitude>2?0:sun.altitude>-4?.7:1.6;light.color.set(palette.sun);light.intensity=palette.sunIntensity;light.castShadow=latest.current.showShadow&&sun.altitude>2&&look.shadows;hemi.color.set(palette.hemiSky);hemi.groundColor.set(palette.hemiGround);hemi.intensity=palette.hemiIntensity;renderer.toneMappingExposure=palette.exposure;(scene.background as T.Color).set(palette.sky);if(scene.fog instanceof T.Fog){scene.fog.color.set(palette.sky);scene.fog.near=look.fogNear;scene.fog.far=look.fogFar}
   drops.visible=!!look.precip;if(look.precip)moveDrops(look.precip,look.precipAmount,reducedMotion?0:performance.now()/1000)
   r.path.visible=latest.current.showPath;r.orb.visible=latest.current.showPath&&daylight;r.ray.visible=false;const position=solarVector(sun,RADIUS);orb.position.copy(anchor).add(new T.Vector3(position.x,position.y,position.z));ray.geometry.setFromPoints([anchor.clone(),anchor.clone().add(new T.Vector3(position.x,.8,position.z))]);if(windowDetail)windowDetail.visible=camera.position.distanceTo(controls.target)<1050;renderer.render(scene,camera);if(performance.now()-lastStats>1000){element.dataset.drawCalls=String(renderer.info.render.calls);element.dataset.triangles=String(renderer.info.render.triangles);element.dataset.quality=latest.current.quality??'balanced';lastStats=performance.now()}
   const bubbles=latest.current.bubbles??[],spot=latest.current.spots.find(s=>s.id===latest.current.selected);if(spot&&!bubbles.some(b=>b.id===spot.id))project(worldPoint(spot.position,10),selectedLabel.current);else if(selectedLabel.current)selectedLabel.current.style.display='none'
   // 吹き出しは順位の高い順に置き、上位と重なる下位の吹き出しは隠す（「別の候補」からは選べる）
   const placed:[number,number][]=[]
   for(const b of bubbles){const el=bubbleEls.current.get(b.id);if(!el)continue;const v=worldPoint(b.position,b.kind==='pick'?9:6).project(camera),x=(v.x*.5+.5)*element.clientWidth,y=(-v.y*.5+.5)*element.clientHeight,off=v.z>1||v.z< -1
    el.style.transform=`translate3d(${x}px,${y}px,0)`;const hidden=off||placed.some(([px,py])=>Math.hypot(px-x,py-y)<46);el.style.display=hidden?'none':'';el.style.zIndex=String(10-b.rank);if(!hidden)placed.push([x,y])}
   // 目印の建物の名前: 吹き出しと重なるもの、ほかの札と重なるもの、遠くて小さい（2番手）ものは隠す
   const far=camera.position.distanceTo(controls.target)>1250,boxes:[number,number][]=[]
   LANDMARKS.forEach((l,i)=>{const el=labelEls.current[i];if(!el)return;if(latest.current.showLabels===false||(far&&l.rank===2)){el.style.display='none';return}const v=worldPoint(l.position,l.height+4).project(camera),x=(v.x*.5+.5)*element.clientWidth,y=(-v.y*.5+.5)*element.clientHeight
    const hidden=v.z>1||v.z< -1||x<0||x>element.clientWidth||y<40||y>element.clientHeight||placed.some(([px,py])=>Math.abs(px-x)<40&&py-y<70&&py-y>-20)||boxes.some(([bx,by])=>Math.abs(bx-x)<96&&Math.abs(by-y)<24);el.style.display=hidden?'none':'';if(!hidden){el.style.transform=`translate3d(${x}px,${y}px,0)`;boxes.push([x,y])}})
  return()=>{cameraState.current={position:camera.position.clone(),target:controls.target.clone()};disposed=true;contextController.abort();cancelAnimationFrame(frame);observer.disconnect();controls.removeEventListener('change',invalidate);controls.dispose();renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointerup',up);renderer.domElement.removeEventListener('webglcontextlost',lost);disposeObject(scene);light.shadow.dispose();renderer.dispose();renderer.domElement.remove();runtime.current=null}
 },[props.dataset,props.quality])
 useEffect(()=>{const r=runtime.current;if(!r)return;const replacement=makeTrack(props.day,r.anchor);r.scene.remove(r.path);disposeObject(r.path);r.path=replacement;r.scene.add(replacement);r.invalidate()},[props.day,props.dataset,props.quality,ready])
 useEffect(()=>{runtime.current?.invalidate()},[props.sun,props.showShadow,props.showPath,props.minutes,props.bubbles,props.showLabels,props.weather])
 const routeKey=useRef('')
 // 徒歩ルート: 白いふちの上に、日陰の区間は濃い青、日なたは橙、夜は灰色で地面に描く
 useEffect(()=>{const r=runtime.current;if(!r)return;if(r.route){r.scene.remove(r.route);disposeObject(r.route);r.route=null}const segments=props.route;if(!segments?.length){routeKey.current='';r.invalidate();return}
  const group=new T.Group(),material=(color:string)=>new T.MeshBasicMaterial({color,transparent:true,opacity:.96,depthWrite:false,side:T.DoubleSide}),all=segments.flatMap(s=>s.points.map(p=>[p.lat,p.lng] as [number,number]))
  const edge=new T.Mesh(strip(all,7.5,.85),material('#ffffff'));edge.renderOrder=3;group.add(edge)
  for(const s of segments){const line=new T.Mesh(strip(s.points.map(p=>[p.lat,p.lng] as [number,number]),4.4,.9),material(s.state==='shade'?'#3d5f86':s.state==='sun'?'#f0952c':'#8a9099'));line.renderOrder=4;group.add(line)}
  const first=segments[0].points[0],last=segments[segments.length-1].points.at(-1)!
  for(const [p,color] of [[first,'#4f86c6'],[last,'#2f6b4f']] as const){const pin=new T.Mesh(new T.CylinderGeometry(4.5,4.5,2,20),new T.MeshBasicMaterial({color}));pin.position.copy(worldPoint(p,1.2));pin.renderOrder=5;group.add(pin)}
  r.route=group;r.scene.add(group)
  // 新しいルートのときだけ、全体が入るように視点を動かす（時刻を変えて色だけ変わるときは動かさない）
  const key=`${first.lat},${first.lng}>${last.lat},${last.lng}`;if(routeKey.current!==key){routeKey.current=key;const box=new T.Box3();for(const s of segments)for(const p of s.points)box.expandByPoint(worldPoint(p));const size=box.getSize(new T.Vector3());r.flyTo(box.getCenter(new T.Vector3()),Math.min(2000,Math.max(380,Math.max(size.x,size.z)*1.25/Math.min(1,r.camera.aspect*1.4))))}
  r.invalidate()
 },[props.route,props.dataset,props.quality,ready])
 // 最初に3Dの準備ができたときも、選んでいる地点（おすすめのベンチ）へ視点を動かす
 const lastSelection=useRef('')
  props.spots.forEach((s,i)=>{const active=s.id===props.selected;dummy.position.copy(worldPoint(s.position,active?5:3));dummy.scale.setScalar(active?2:1);dummy.updateMatrix();markers.setMatrixAt(i,dummy.matrix);const level=props.levels?.get(s.id);markers.setColorAt(i,new T.Color(level?LEVEL_COLOR[level]:active?'#f9c874':'#7194a2'))});markers.computeBoundingSphere();r.markers=markers;r.scene.add(markers)
 },[props.spots,props.selected,props.levels,props.dataset,props.quality,ready])
  <div className="scene-landmarks" aria-hidden="true">{LANDMARKS.map((l,i)=><div key={l.label} className={'landmark-label rank-'+l.rank} ref={el=>{labelEls.current[i]=el}}><span>{l.label}</span></div>)}</div>
  <div className="scene-bubbles">{props.bubbles?.map(b=><div key={b.id} className="bubble-anchor" ref={el=>{if(el)bubbleEls.current.set(b.id,el);else bubbleEls.current.delete(b.id)}}><button className={'spot-bubble bubble-'+b.kind+(b.active?' is-active':'')+(b.level?' level-'+b.level:'')} aria-label={b.kind==='pick'?`おすすめ: ${b.label}`:`候補${b.rank}: ${b.label}`} aria-pressed={b.active} onClick={()=>props.onBubble?.(b.id)}>{b.kind==='pick'?<span className="bubble-bang">!</span>:<><Armchair size={17} strokeWidth={2.2}/><i className="bubble-rank">{b.rank}</i></>}</button></div>)}</div>
  <div className="scene-keyboard-spots">{props.spots.slice(0,12).map(s=><button key={s.id} onClick={()=>props.onSelect(s.id)}>{s.name||'休憩スポット'}を選択</button>)}</div>
