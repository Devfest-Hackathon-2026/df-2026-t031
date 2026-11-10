// 3D 都市模型の形（建物・樹木・公園・道路・水面）。2026-11-10 に書き直し（期間中に足した部分はそのまま）
import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {AREA_CENTER} from '../domain/area.ts'
import {LocalProjection} from '../domain/geo.ts'
import type {AreaDataset,LatLng} from '../domain/types.ts'
import {FERRIS_WHEEL_NAME} from '../domain/landmarks.ts'
/** three.js の座標: x=東、y=上、z=南（北は -z） */
export const cityProjection=new LocalProjection(AREA_CENTER)
export function worldPoint(p:LatLng,y=0){const q=cityProjection.toXY(p);return new T.Vector3(q.x,y,-q.y)}
/** 外形（緯度経度）を平面の形に。rotateX(-90°) すると x=東・-z=北 に置かれる */
function shapeFrom(ring:LatLng[]){const pts=ring.map(p=>cityProjection.toXY(p)),s=new T.Shape();pts.forEach((p,i)=>i?s.lineTo(p.x,p.y):s.moveTo(p.x,p.y));s.closePath();return s}
/** 中心からの近さ（緯度経度の差の二乗。並べ替えと「近くだけ窓を描く」に使う） */
const distance=(p:LatLng)=>(p.lat-AREA_CENTER.lat)**2+(p.lng-AREA_CENTER.lng)**2
/** 子要素の形と材質を解放する */
export function disposeObject(o:T.Object3D){o.traverse(x=>{const m=x as T.Mesh;m.geometry?.dispose?.();const mat=m.material as T.Material|T.Material[]|undefined;if(Array.isArray(mat))mat.forEach(a=>a.dispose());else mat?.dispose?.()})}
function addMerged(root:T.Group,geometries:T.BufferGeometry[],color:string,cast=false,look:{roughness?:number;metalness?:number}={}){if(!geometries.length)return;const merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!merged)return;const mesh=new T.Mesh(merged,new T.MeshStandardMaterial({color,roughness:look.roughness??.92,metalness:look.metalness??0}));mesh.castShadow=cast;mesh.receiveShadow=true;root.add(mesh)}
export function createCity(dataset:AreaDataset,lightQuality=false){
 const root=new T.Group();root.name='city'
 const ground=new T.Mesh(new T.PlaneGeometry(7000,7000),new T.MeshStandardMaterial({color:'#eeedea',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.3;ground.receiveShadow=true;root.add(ground)
 const buckets:T.BufferGeometry[][]=[[],[],[],[],[]],outlines:number[]=[],windows:number[]=[]
 const fallback=new T.Group();fallback.name='plateau-fallback'
 // PLATEAU の .glb を読めないときの代わり（外形から箱を作る）。高層ビルはガラス色にそろえる
 const fallbackGeometry=dataset.buildings.filter(b=>b.heightSource==='plateau'&&b.footprint.length>=3).map(b=>{const g=new T.ExtrudeGeometry(shapeFrom(b.footprint),{depth:b.height,bevelEnabled:false,steps:1,curveSegments:1});g.rotateX(-Math.PI/2);g.deleteAttribute('uv');return {g,tall:b.height>=90}})
 addMerged(fallback,fallbackGeometry.filter(x=>!x.tall).map(x=>x.g),'#d9d5ca',true);addMerged(fallback,fallbackGeometry.filter(x=>x.tall).map(x=>x.g),'#a3b7c6',true,{roughness:.3,metalness:.28});root.add(fallback)
 // 見てすぐ分かるように素材を分ける: 赤レンガ倉庫はレンガ色、日本丸は白、90m 以上の高層ビルはガラス。観覧車は箱ではなく形を作る
 const special={glass:[] as T.BufferGeometry[],brick:[] as T.BufferGeometry[],white:[] as T.BufferGeometry[]}
 const ordered=dataset.buildings.filter(b=>b.heightSource!=='plateau').sort((a,b)=>distance(a.footprint[0]??AREA_CENTER)-distance(b.footprint[0]??AREA_CENTER))
 ordered.forEach((b,index)=>{
  if(b.footprint.length<3||!(b.height>0))return
  if(b.name===FERRIS_WHEEL_NAME){root.add(createFerrisWheel(b.footprint));return}
  const geometry=new T.ExtrudeGeometry(shapeFrom(b.footprint),{depth:Math.max(.5,b.height-b.minHeight),bevelEnabled:false,steps:1,curveSegments:1});geometry.rotateX(-Math.PI/2);geometry.translate(0,b.minHeight,0);geometry.deleteAttribute('uv');(b.name?.includes('赤レンガ倉庫')?special.brick:b.name==='日本丸'?special.white:b.height>=90?special.glass:buckets[index%5]).push(geometry)
  const ring=b.footprint.map(p=>cityProjection.toXY(p));for(let k=0;k<ring.length;k++){const a=ring[k],c=ring[(k+1)%ring.length];outlines.push(a.x,b.height+.05,-a.y,c.x,b.height+.05,-c.y)}
  if(b.height<10||ring.length>45||windows.length>(lightQuality?65000:180000)||distance(b.footprint[0])>.00009)return
  // 窓の帯: 各面に 3.4m ごとの細い帯を、壁から 15cm 外に貼る（中心から近い 10m 以上の建物だけ）
  for(let k=0;k<ring.length;k++){const a=ring[k],c=ring[(k+1)%ring.length],len=Math.hypot(c.x-a.x,c.y-a.y);if(len<6)continue
   const nx=(c.y-a.y)/len*.15,ny=-(c.x-a.x)/len*.15,inset=Math.min(1.2,len*.1),ux=(c.x-a.x)/len,uy=(c.y-a.y)/len
   const x0=a.x+ux*inset+nx,y0=a.y+uy*inset+ny,x1=c.x-ux*inset+nx,y1=c.y-uy*inset+ny
   for(let z=Math.max(b.minHeight,0)+3;z<b.height-2;z+=3.4){const lo=z,hi=z+1.3;windows.push(x0,lo,-y0,x1,lo,-y1,x1,hi,-y1,x0,lo,-y0,x1,hi,-y1,x0,hi,-y0)}
  }
 });['#ebe4da','#e4ddd2','#efe9e1','#e1d9ce','#e8e1d7'].forEach((color,i)=>addMerged(root,buckets[i],color,true))
 addMerged(root,special.glass,'#a3b7c6',true,{roughness:.3,metalness:.28});addMerged(root,special.brick,'#a9563c',true,{roughness:.96});addMerged(root,special.white,'#f4f2ec',true,{roughness:.6})
 const lineGeo=new T.BufferGeometry();lineGeo.setAttribute('position',new T.Float32BufferAttribute(outlines,3));root.add(new T.LineSegments(lineGeo,new T.LineBasicMaterial({color:'#fbf8f3',transparent:true,opacity:.7})))
 const windowGeo=new T.BufferGeometry();windowGeo.setAttribute('position',new T.Float32BufferAttribute(windows,3));windowGeo.computeVertexNormals();const detail=new T.Mesh(windowGeo,new T.MeshStandardMaterial({color:'#a9bfd3',roughness:.45,side:T.DoubleSide}));detail.name='city-window-detail';root.add(detail)
 const parkGeometries=dataset.parks.filter(p=>p.ring.length>=3).map(p=>{const g=new T.ShapeGeometry(shapeFrom(p.ring));g.rotateX(-Math.PI/2);g.translate(0,.02,0);g.deleteAttribute('uv');return g});addMerged(root,parkGeometries,'#bde8ad')
 const visibleTrees=lightQuality?dataset.trees.filter((_,i)=>i%2===0):dataset.trees
 const count=visibleTrees.length,dummy=new T.Object3D(),trunks=new T.InstancedMesh(new T.CylinderGeometry(.35,.55,1,5),new T.MeshStandardMaterial({color:'#8f7f68',roughness:1}),count)
 trunks.castShadow=true;trunks.receiveShadow=true
 const canopy=new T.InstancedMesh(new T.IcosahedronGeometry(1,lightQuality?0:1),new T.MeshStandardMaterial({color:'#ffffff',flatShading:true,roughness:1}),count*3);canopy.castShadow=true;canopy.receiveShadow=true
 visibleTrees.forEach((tree,i)=>{
  const p=worldPoint(tree.position),h=tree.height,r=Math.max(1.2,tree.crownRadius);dummy.position.set(p.x,h*.35,p.z);dummy.scale.set(1,h*.7,1);dummy.rotation.set(0,0,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix)
  for(let j=0;j<3;j++){const angle=i*2.39+j*2.1;dummy.position.set(p.x+Math.cos(angle)*r*.4,h*.7+(j===0?r*.3:0),p.z+Math.sin(angle)*r*.4);dummy.scale.set(r*(j===0?1:.78),r*.85,r*(j===0?1:.78));dummy.rotation.set(i*.17,j*.7,i*.06);dummy.updateMatrix();canopy.setMatrixAt(i*3+j,dummy.matrix);canopy.setColorAt(i*3+j,new T.Color(['#7fc070','#92cd7f','#6db363','#9fd68d'][(i+j)%4]))}
 })
 trunks.instanceMatrix.needsUpdate=true;canopy.instanceMatrix.needsUpdate=true;if(canopy.instanceColor)canopy.instanceColor.needsUpdate=true
 root.add(trunks,canopy);return root
}
export function strip(points:[number,number][],width:number,height:number){
 // 線（緯度経度の列）を幅 width の帯にして、高さ height に置く
 const pts=points.map(([lat,lng])=>cityProjection.toXY({lat,lng})),pos:number[]=[],half=width/2
 for(let i=1;i<pts.length;i++){const a=pts[i-1],c=pts[i],len=Math.hypot(c.x-a.x,c.y-a.y);if(len<.01)continue;const nx=-(c.y-a.y)/len*half,ny=(c.x-a.x)/len*half
  pos.push(a.x+nx,height,-(a.y+ny),a.x-nx,height,-(a.y-ny),c.x-nx,height,-(c.y-ny),a.x+nx,height,-(a.y+ny),c.x-nx,height,-(c.y-ny),c.x+nx,height,-(c.y+ny))}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.computeVertexNormals();return g
}
/** 道路・水面の同梱データ（public/data/area-context.json） */
export interface CityContext{features:{kind:string;roadType?:string;sidewalk?:boolean;points:[number,number][]}[]}
const ROAD_WIDTH:Record<string,number>={motorway:14,trunk:14,primary:12,secondary:10,tertiary:9,residential:6.5,unclassified:6,service:4.5,living_street:5}
const PATHS=new Set(['footway','pedestrian','path','steps','cycleway','corridor','track'])
export function createContext(context:CityContext){
 const root=new T.Group();root.name='city-context';const waters:T.BufferGeometry[]=[],sidewalks:T.BufferGeometry[]=[],roads:T.BufferGeometry[]=[],paths:T.BufferGeometry[]=[]
 for(const f of context.features??[]){if(f.points.length<2)continue
  if(f.kind==='water'){const a=f.points[0],z=f.points[f.points.length-1];if(f.points.length>=4&&a[0]===z[0]&&a[1]===z[1]){const g=new T.ShapeGeometry(shapeFrom(f.points.map(([lat,lng])=>({lat,lng}))));g.rotateX(-Math.PI/2);g.translate(0,.01,0);g.deleteAttribute('uv');waters.push(g)}else waters.push(strip(f.points,12,.01));continue}
  if(f.kind!=='road')continue
  const t=f.roadType??''
  if(f.sidewalk||t==='footway'&&f.sidewalk!==false&&PATHS.has(t)&&f.points.length<3)sidewalks.push(strip(f.points,3,.05))
  else if(PATHS.has(t))paths.push(strip(f.points,2.2,.08))
  else if(ROAD_WIDTH[t])roads.push(strip(f.points,ROAD_WIDTH[t],.04))
 }
 addMerged(root,waters,'#a3d0f2');addMerged(root,sidewalks,'#f5f4f1');addMerged(root,roads,'#c3ccd8');addMerged(root,paths,'#ffffff');return root
}


/** 2点を結ぶ円柱（観覧車の支柱など） */
function beam(a:T.Vector3,b:T.Vector3,r:number,material:T.Material){const len=a.distanceTo(b),m=new T.Mesh(new T.CylinderGeometry(r,r,len,8),material);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());m.castShadow=true;return m}
/**
 * コスモクロック21（高さ約112m・直径約100m）を観覧車の形で作る。外形の向き（いちばん長い方向）に輪をそろえる。
 * 輪・ゴンドラ・中心の時計は夜に光る（CityMap が userData.lights の強さを変える）
 */
export function createFerrisWheel(footprint:LatLng[]){
 const ring=footprint.map(p=>cityProjection.toXY(p)),cx=ring.reduce((n,p)=>n+p.x,0)/ring.length,cy=ring.reduce((n,p)=>n+p.y,0)/ring.length
 let sxx=0,syy=0,sxy=0;for(const p of ring){const dx=p.x-cx,dy=p.y-cy;sxx+=dx*dx;syy+=dy*dy;sxy+=dx*dy}
 const axis=.5*Math.atan2(2*sxy,sxx-syy),group=new T.Group();group.name='ferris-wheel';group.position.set(cx,0,-cy);group.rotation.y=axis
 const R=50,H=62.5,lights:T.MeshStandardMaterial[]=[]
 const steel=new T.MeshStandardMaterial({color:'#eef1f4',roughness:.35,metalness:.45,emissive:'#7fd6ff',emissiveIntensity:0});lights.push(steel)
 const leg=new T.MeshStandardMaterial({color:'#d9dde2',roughness:.5,metalness:.35})
 for(const [r,t] of [[R,1],[R-7,.55]] as const){const torus=new T.Mesh(new T.TorusGeometry(r,t,8,120),steel);torus.position.y=H;torus.castShadow=true;group.add(torus)}
 const spokes:number[]=[];for(let i=0;i<36;i++){const a=i/36*Math.PI*2;for(const z of [-1.6,1.6])spokes.push(0,H,z,Math.cos(a)*R,H+Math.sin(a)*R,z)}
 const sg=new T.BufferGeometry();sg.setAttribute('position',new T.Float32BufferAttribute(spokes,3));group.add(new T.LineSegments(sg,new T.LineBasicMaterial({color:'#c9ced4'})))
 const colors=['#f2a7bb','#8fd0e8','#f5d76e','#a8dc95','#c3aef0'],gondolas=new T.InstancedMesh(new T.BoxGeometry(2.8,3.2,2.8),new T.MeshStandardMaterial({color:'#ffffff',roughness:.5,emissive:'#ffffff',emissiveIntensity:0}),60),d=new T.Object3D()
 lights.push(gondolas.material as T.MeshStandardMaterial)
 for(let i=0;i<60;i++){const a=i/60*Math.PI*2;d.position.set(Math.cos(a)*(R+2.6),H+Math.sin(a)*(R+2.6)-1.6,0);d.updateMatrix();gondolas.setMatrixAt(i,d.matrix);gondolas.setColorAt(i,new T.Color(colors[i%colors.length]))}
 gondolas.castShadow=true;group.add(gondolas)
 const hub=new T.Mesh(new T.CylinderGeometry(4.5,4.5,7,20),leg);hub.rotation.x=Math.PI/2;hub.position.y=H;group.add(hub)
 const clockMat=new T.MeshStandardMaterial({color:'#2d3640',roughness:.4,emissive:'#ffe9a8',emissiveIntensity:0});lights.push(clockMat)
 for(const z of [3.6,-3.6]){const face=new T.Mesh(new T.CircleGeometry(10,32),clockMat);face.position.set(0,H,z);if(z<0)face.rotation.y=Math.PI;group.add(face)}
 const top=new T.Vector3(0,H,0);for(const x of [-16,16])for(const z of [-9,9])group.add(beam(new T.Vector3(x,0,z),top,1.1,leg))
 const base=new T.Mesh(new T.BoxGeometry(44,9,18),new T.MeshStandardMaterial({color:'#e7e2d9',roughness:.85}));base.position.y=4.5;base.castShadow=true;base.receiveShadow=true;group.add(base)
 group.userData.lights=lights;return group
}
/** PLATEAU の建物（1つの立体）に高さで色を付ける: 低い所は石のベージュ、30m より上ほどガラスの青灰に */
export function tintByHeight(mesh:T.Mesh){
 const g=mesh.geometry,pos=g.getAttribute('position');if(!pos)return
 mesh.updateWorldMatrix(true,false);const v=new T.Vector3(),stone=new T.Color('#e6dfd4'),glass=new T.Color('#a8bccb'),c=new T.Color(),out=new Float32Array(pos.count*3)
 for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);const t=Math.min(1,Math.max(0,(v.y-30)/55));c.copy(stone).lerp(glass,t);out[i*3]=c.r;out[i*3+1]=c.g;out[i*3+2]=c.b}
 g.setAttribute('color',new T.BufferAttribute(out,3));const m=mesh.material as T.MeshStandardMaterial;m.vertexColors=true;m.color.set('#ffffff');m.roughness=.62;m.metalness=.12;m.needsUpdate=true
}

