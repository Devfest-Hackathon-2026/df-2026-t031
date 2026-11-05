import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {LocalProjection} from '../domain/geo.ts'
import {AREA_CENTER,EXPLORER_FOCUS} from '../domain/area.ts'
import type {AreaDataset,LatLng} from '../domain/types.ts'
export const cityProjection=new LocalProjection(AREA_CENTER)
export interface ContextFeature{id:number;kind:'road'|'water';roadType?:string;name?:string;points:[number,number][]}
export interface CityContext{features:ContextFeature[]}
export function worldPoint(p:LatLng,height=0){const xy=cityProjection.toXY(p);return new T.Vector3(xy.x,height,-xy.y)}
function shapeFrom(points:LatLng[]){const shape=new T.Shape();points.forEach((p,i)=>{const xy=cityProjection.toXY(p);if(i===0)shape.moveTo(xy.x,xy.y);else shape.lineTo(xy.x,xy.y)});shape.closePath();return shape}
function addMerged(root:T.Group,geometries:T.BufferGeometry[],color:string,cast=false){if(!geometries.length)return;const merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!merged)return;const mesh=new T.Mesh(merged,new T.MeshStandardMaterial({color,roughness:.92,metalness:0}));mesh.castShadow=cast;mesh.receiveShadow=true;root.add(mesh)}
export function createCity(dataset:AreaDataset){
 const root=new T.Group(),buckets:T.BufferGeometry[][]=Array.from({length:5},()=>[]),outlines:number[]=[],windows:number[]=[]
 const ground=new T.Mesh(new T.PlaneGeometry(7000,7000),new T.MeshStandardMaterial({color:'#e4e5dc',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.3;ground.receiveShadow=true;root.add(ground)
 const distance=(p:LatLng)=>((p.lat-EXPLORER_FOCUS.lat)*1.23)**2+(p.lng-EXPLORER_FOCUS.lng)**2
 const ordered=[...dataset.buildings].sort((a,b)=>distance(a.footprint[0]??AREA_CENTER)-distance(b.footprint[0]??AREA_CENTER))
 ordered.forEach((b,index)=>{
  if(b.footprint.length<3)return
  const geometry=new T.ExtrudeGeometry(shapeFrom(b.footprint),{depth:Math.max(.5,b.height-b.minHeight),bevelEnabled:false,steps:1,curveSegments:1});geometry.rotateX(-Math.PI/2);geometry.translate(0,b.minHeight,0);geometry.deleteAttribute('uv');buckets[index%5].push(geometry)
  const ring=b.footprint.map(p=>cityProjection.toXY(p));let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],c=ring[(i+1)%ring.length];area+=a.x*c.y-c.x*a.y;outlines.push(a.x,b.height+.08,-a.y,c.x,b.height+.08,-c.y)}
  if(b.height<10||ring.length>45||windows.length>300000)return
  const normalSign=area>=0?1:-1
  for(let i=0;i<ring.length;i++){
   const a=ring[i],c=ring[(i+1)%ring.length],length=Math.hypot(c.x-a.x,c.y-a.y);if(length<8)continue
   const ux=(c.x-a.x)/length,uy=(c.y-a.y)/length,nx=uy*normalSign*.12,ny=-ux*normalSign*.12
   for(let y=Math.max(b.minHeight+3,3);y<b.height-2;y+=5.2){for(let d=3;d<length-2;d+=5){if(windows.length>300000)break;const x=a.x+ux*d+nx,z=-(a.y+uy*d+ny),dx=ux*1.5,dz=-uy*1.5;windows.push(x,y,z,x+dx,y,z+dz,x+dx,y+2.5,z+dz,x,y,z,x+dx,y+2.5,z+dz,x,y+2.5,z)}}
  }
 });['#d5cec1','#c9c7bd','#dfd9cc','#c6c6bb','#d0cabe'].forEach((color,i)=>addMerged(root,buckets[i],color,true))
 const lineGeo=new T.BufferGeometry();lineGeo.setAttribute('position',new T.Float32BufferAttribute(outlines,3));root.add(new T.LineSegments(lineGeo,new T.LineBasicMaterial({color:'#f3eee4',transparent:true,opacity:.65})))
 const windowGeo=new T.BufferGeometry();windowGeo.setAttribute('position',new T.Float32BufferAttribute(windows,3));windowGeo.computeVertexNormals();root.add(new T.Mesh(windowGeo,new T.MeshStandardMaterial({color:'#819ba2',roughness:.55,side:T.DoubleSide})))
 const parkGeometries=dataset.parks.filter(p=>p.ring.length>=3).map(p=>{const g=new T.ShapeGeometry(shapeFrom(p.ring));g.rotateX(-Math.PI/2);g.translate(0,.02,0);g.deleteAttribute('uv');return g});addMerged(root,parkGeometries,'#bfe3a4')
 const count=dataset.trees.length,dummy=new T.Object3D(),trunks=new T.InstancedMesh(new T.CylinderGeometry(.35,.55,1,5),new T.MeshStandardMaterial({color:'#837d65',roughness:1}),count)
 trunks.castShadow=true;trunks.receiveShadow=true
 const canopy=new T.InstancedMesh(new T.IcosahedronGeometry(1,1),new T.MeshStandardMaterial({color:'#ffffff',flatShading:true,roughness:1}),count*3);canopy.castShadow=true;canopy.receiveShadow=true
 dataset.trees.forEach((tree,i)=>{
  const p=worldPoint(tree.position),h=Math.min(24,tree.height),r=Math.max(2.2,Math.min(7,tree.crownRadius));dummy.position.set(p.x,h*.3,p.z);dummy.scale.set(1,h*.6,1);dummy.rotation.set(0,0,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix)
  for(let j=0;j<3;j++){const angle=i*2.39+j*2.1;dummy.position.set(p.x+Math.cos(angle)*r*.4,h*.7+(j===0?r*.3:0),p.z+Math.sin(angle)*r*.4);dummy.scale.set(r*(j===0?1:.78),r*.85,r*(j===0?1:.78));dummy.rotation.set(i*.17,j*.7,i*.06);dummy.updateMatrix();canopy.setMatrixAt(i*3+j,dummy.matrix);canopy.setColorAt(i*3+j,new T.Color(['#8ca579','#9bb386','#78956d','#a7bb90'][(i+j)%4]))}
 });trunks.computeBoundingSphere();canopy.computeBoundingSphere();root.add(trunks,canopy)
 return root
}
function roadWidth(type:string){return ({motorway:20,trunk:18,primary:16,secondary:13,tertiary:10,residential:7,unclassified:7,service:5,pedestrian:8,cycleway:3,footway:2.6,path:2.2,steps:2.5,track:3.5} as Record<string,number>)[type]??4}
function strip(points:[number,number][],width:number,height:number){
 const p=points.map(([lat,lng])=>cityProjection.toXY({lat,lng})),vertices:number[]=[]
 for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1],len=Math.hypot(b.x-a.x,b.y-a.y);if(len<.1)continue;const x=-(b.y-a.y)/len*width/2,y=(b.x-a.x)/len*width/2;const v=[[a.x+x,height,-a.y-y],[a.x-x,height,-a.y+y],[b.x-x,height,-b.y+y],[b.x+x,height,-b.y-y]];for(const j of [0,1,2,0,2,3])vertices.push(...v[j])}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();return geometry
}
export function createContext(context:CityContext){const root=new T.Group(),roads:T.BufferGeometry[]=[],sidewalks:T.BufferGeometry[]=[],paths:T.BufferGeometry[]=[],waters:T.BufferGeometry[]=[]
 for(const f of context.features){if(f.points.length<2)continue;if(f.kind==='water'){if(f.points.length>=4){const g=new T.ShapeGeometry(shapeFrom(f.points.map(([lat,lng])=>({lat,lng}))));g.rotateX(-Math.PI/2);g.translate(0,.03,0);g.deleteAttribute('uv');waters.push(g)}continue}
  const type=f.roadType||'service';if(['proposed','construction','platform','elevator'].includes(type))continue
  if(['footway','path','cycleway','pedestrian','steps'].includes(type)){paths.push(strip(f.points,roadWidth(type),.15))}else{sidewalks.push(strip(f.points,roadWidth(type)+4,.07));roads.push(strip(f.points,roadWidth(type),.12))}
 }
 addMerged(root,waters,'#a8c9cd');addMerged(root,sidewalks,'#eeeae1');addMerged(root,roads,'#a9b1b5');addMerged(root,paths,'#e7e4d6');return root
}
export function disposeObject(object:T.Object3D){const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();object.traverse(child=>{const mesh=child as T.Mesh;if(mesh.geometry)geometries.add(mesh.geometry);if(mesh.material){for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(material)}if(child instanceof T.InstancedMesh)child.dispose()});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose())}
