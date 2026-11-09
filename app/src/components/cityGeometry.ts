import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {LocalProjection} from '../domain/geo.ts'
import {AREA_CENTER,EXPLORER_FOCUS} from '../domain/area.ts'
import type {AreaDataset,LatLng} from '../domain/types.ts'
import {FERRIS_WHEEL_NAME} from '../domain/landmarks.ts'
export const cityProjection=new LocalProjection(AREA_CENTER)
export interface ContextFeature{id:number;kind:'road'|'water';roadType?:string;name?:string;points:[number,number][]}
export interface CityContext{features:ContextFeature[]}
export function worldPoint(p:LatLng,height=0){const xy=cityProjection.toXY(p);return new T.Vector3(xy.x,height,-xy.y)}
function shapeFrom(points:LatLng[]){const shape=new T.Shape();points.forEach((p,i)=>{const xy=cityProjection.toXY(p);if(i===0)shape.moveTo(xy.x,xy.y);else shape.lineTo(xy.x,xy.y)});shape.closePath();return shape}
function addMerged(root:T.Group,geometries:T.BufferGeometry[],color:string,cast=false,look:{roughness?:number;metalness?:number}={}){if(!geometries.length)return;const merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!merged)return;const mesh=new T.Mesh(merged,new T.MeshStandardMaterial({color,roughness:look.roughness??.92,metalness:look.metalness??0}));mesh.castShadow=cast;mesh.receiveShadow=true;root.add(mesh)}
export function createCity(dataset:AreaDataset,lightQuality=false){
 const root=new T.Group(),buckets:T.BufferGeometry[][]=Array.from({length:5},()=>[]),outlines:number[]=[],windows:number[]=[]
 const ground=new T.Mesh(new T.PlaneGeometry(7000,7000),new T.MeshStandardMaterial({color:'#eeedea',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.3;ground.receiveShadow=true;root.add(ground)
 const distance=(p:LatLng)=>((p.lat-EXPLORER_FOCUS.lat)*1.23)**2+(p.lng-EXPLORER_FOCUS.lng)**2
 const fallback=new T.Group();fallback.name='plateau-fallback'
 // PLATEAU の .glb を読めないときの代わり（外形から箱を作る）。高層ビルはガラス色にそろえる
 const fallbackGeometry=dataset.buildings.filter(b=>b.heightSource==='plateau'&&b.footprint.length>=3).map(b=>{const g=new T.ExtrudeGeometry(shapeFrom(b.footprint),{depth:b.height,bevelEnabled:false,steps:1,curveSegments:1});g.rotateX(-Math.PI/2);g.deleteAttribute('uv');return {g,tall:b.height>=90}})
 addMerged(fallback,fallbackGeometry.filter(x=>!x.tall).map(x=>x.g),'#d9d5ca',true);addMerged(fallback,fallbackGeometry.filter(x=>x.tall).map(x=>x.g),'#a3b7c6',true,{roughness:.3,metalness:.28});root.add(fallback)
 // 見てすぐ分かるように素材を分ける: 赤レンガ倉庫はレンガ色、日本丸は白、90m 以上の高層ビルはガラス。観覧車は箱ではなく形を作る
 const special={glass:[] as T.BufferGeometry[],brick:[] as T.BufferGeometry[],white:[] as T.BufferGeometry[]}
 const ordered=dataset.buildings.filter(b=>b.heightSource!=='plateau').sort((a,b)=>distance(a.footprint[0]??AREA_CENTER)-distance(b.footprint[0]??AREA_CENTER))
 ordered.forEach((b,index)=>{
  if(b.footprint.length<3)return
  if(b.name===FERRIS_WHEEL_NAME){root.add(createFerrisWheel(b.footprint));return}
  const geometry=new T.ExtrudeGeometry(shapeFrom(b.footprint),{depth:Math.max(.5,b.height-b.minHeight),bevelEnabled:false,steps:1,curveSegments:1});geometry.rotateX(-Math.PI/2);geometry.translate(0,b.minHeight,0);geometry.deleteAttribute('uv');(b.name?.includes('赤レンガ倉庫')?special.brick:b.name==='日本丸'?special.white:b.height>=90?special.glass:buckets[index%5]).push(geometry)
  const ring=b.footprint.map(p=>cityProjection.toXY(p));let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],c=ring[(i+1)%ring.length];area+=a.x*c.y-c.x*a.y;outlines.push(a.x,b.height+.08,-a.y,c.x,b.height+.08,-c.y)}
  if(b.height<10||ring.length>45||windows.length>(lightQuality?65000:180000)||distance(b.footprint[0])>.00009)return
  const normalSign=area>=0?1:-1
  for(let i=0;i<ring.length;i++){
   const a=ring[i],c=ring[(i+1)%ring.length],length=Math.hypot(c.x-a.x,c.y-a.y);if(length<8)continue
   const ux=(c.x-a.x)/length,uy=(c.y-a.y)/length,nx=uy*normalSign*.12,ny=-ux*normalSign*.12
   for(let y=Math.max(b.minHeight+3,3);y<b.height-2;y+=5.2){for(let d=3;d<length-2;d+=5){if(windows.length>300000)break;const x=a.x+ux*d+nx,z=-(a.y+uy*d+ny),dx=ux*1.5,dz=-uy*1.5;windows.push(x,y,z,x+dx,y,z+dz,x+dx,y+2.5,z+dz,x,y,z,x+dx,y+2.5,z+dz,x,y+2.5,z)}}
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
  const p=worldPoint(tree.position),h=Math.min(24,tree.height),r=Math.max(2.2,Math.min(7,tree.crownRadius));dummy.position.set(p.x,h*.3,p.z);dummy.scale.set(1,h*.6,1);dummy.rotation.set(0,0,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix)
  for(let j=0;j<3;j++){const angle=i*2.39+j*2.1;dummy.position.set(p.x+Math.cos(angle)*r*.4,h*.7+(j===0?r*.3:0),p.z+Math.sin(angle)*r*.4);dummy.scale.set(r*(j===0?1:.78),r*.85,r*(j===0?1:.78));dummy.rotation.set(i*.17,j*.7,i*.06);dummy.updateMatrix();canopy.setMatrixAt(i*3+j,dummy.matrix);canopy.setColorAt(i*3+j,new T.Color(['#7fc070','#92cd7f','#6db363','#9fd68d'][(i+j)%4]))}
 });trunks.computeBoundingSphere();canopy.computeBoundingSphere();root.add(trunks,canopy)
 return root
}
function roadWidth(type:string){return ({motorway:20,trunk:18,primary:16,secondary:13,tertiary:10,residential:7,unclassified:7,service:5,pedestrian:8,cycleway:3,footway:2.6,path:2.2,steps:2.5,track:3.5} as Record<string,number>)[type]??4}
export function strip(points:[number,number][],width:number,height:number){
 const p=points.map(([lat,lng])=>cityProjection.toXY({lat,lng})),vertices:number[]=[]
 for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1],len=Math.hypot(b.x-a.x,b.y-a.y);if(len<.1)continue;const x=-(b.y-a.y)/len*width/2,y=(b.x-a.x)/len*width/2;const v=[[a.x+x,height,-a.y-y],[a.x-x,height,-a.y+y],[b.x-x,height,-b.y+y],[b.x+x,height,-b.y-y]];for(const j of [0,1,2,0,2,3])vertices.push(...v[j])}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();return geometry
}
export function createContext(context:CityContext){const root=new T.Group(),roads:T.BufferGeometry[]=[],sidewalks:T.BufferGeometry[]=[],paths:T.BufferGeometry[]=[],waters:T.BufferGeometry[]=[]
 for(const f of context.features){if(f.points.length<2)continue;if(f.kind==='water'){if(f.points.length>=4){const g=new T.ShapeGeometry(shapeFrom(f.points.map(([lat,lng])=>({lat,lng}))));g.rotateX(-Math.PI/2);g.translate(0,.03,0);g.deleteAttribute('uv');waters.push(g)}continue}
  const type=f.roadType||'service';if(['proposed','construction','platform','elevator'].includes(type))continue
  if(['footway','path','cycleway','pedestrian','steps'].includes(type)){paths.push(strip(f.points,roadWidth(type),.15))}else{sidewalks.push(strip(f.points,roadWidth(type)+4,.07));roads.push(strip(f.points,roadWidth(type),.12))}
 }
 addMerged(root,waters,'#a3d0f2');addMerged(root,sidewalks,'#f5f4f1');addMerged(root,roads,'#c3ccd8');addMerged(root,paths,'#ffffff');return root
}
export function disposeObject(object:T.Object3D){const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();object.traverse(child=>{const mesh=child as T.Mesh;if(mesh.geometry)geometries.add(mesh.geometry);if(mesh.material){for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(material)}if(child instanceof T.InstancedMesh)child.dispose()});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose())}

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
