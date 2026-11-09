/** Small, offline PLATEAU LOD2 subset. npm ci; node scripts/prepare-plateau.mjs */
import {mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),draco=await require('draco3d').createDecoderModule({})
const catalogUrl='https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets'
const sourcePage='https://www.geospatial.jp/ckan/dataset/plateau-14100-yokohama-shi-2024'
const origin={lat:35.45765,lng:139.6356},radians=Math.PI/180,R=6371008.8
// A bounded sample in Nishi ward; individual landmark coverage is not guaranteed.
const bounds={west:139.6285,south:35.4525,east:139.639,north:35.4625}
async function json(url){const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`${response.status}: ${url}`);return response.json()}
const catalog=await json(catalogUrl),entry=catalog.datasets.find(d=>d.id==='14103_bldg_lod2_no_texture'&&d.year===2024)
if(!entry)throw Error('Expected Yokohama 2024 Nishi LOD2 dataset unavailable; do not silently change source')
const tree=await json(entry.url),tiles=[]
function visit(tile){
 const region=tile.content?.boundingVolume?.region??tile.boundingVolume?.region
 if(region&&(region[2]/radians<bounds.west||region[0]/radians>bounds.east||region[3]/radians<bounds.south||region[1]/radians>bounds.north))return
 if(tile.children?.length){tile.children.forEach(visit);return}
 if(tile.content?.uri)tiles.push(tile.content.uri)
}
visit(tree.root);if(tiles.length>16)throw Error('Sample unexpectedly exceeds 16 tiles')
const phi=origin.lat*radians,lambda=origin.lng*radians,sinPhi=Math.sin(phi),cosPhi=Math.cos(phi),sinLambda=Math.sin(lambda),cosLambda=Math.cos(lambda)
const a=6378137,e2=6.69437999014e-3,N=a/Math.sqrt(1-e2*sinPhi*sinPhi),center=[N*cosPhi*cosLambda,N*cosPhi*sinLambda,N*(1-e2)*sinPhi]
function local(x,y,z){const dx=x-center[0],dy=y-center[1],dz=z-center[2];return [-sinLambda*dx+cosLambda*dy,cosPhi*cosLambda*dx+cosPhi*sinLambda*dy+sinPhi*dz,-(-sinPhi*cosLambda*dx-sinPhi*sinLambda*dy+cosPhi*dz)]}
function geo(x,z){return {lat:origin.lat-z/(R*radians),lng:origin.lng+x/(R*radians*cosPhi)}}
function hull(points){const sorted=[...new Map(points.map(p=>[`${p[0].toFixed(2)},${p[1].toFixed(2)}`,p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(sorted.length<3)return [];const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),half=p=>{const h=[];for(const v of p){while(h.length>1&&cross(h.at(-2),h.at(-1),v)<=0)h.pop();h.push(v)}return h};const lower=half(sorted),upper=half([...sorted].reverse());return [...lower.slice(0,-1),...upper.slice(0,-1)]}
const positions=[],indices=[],buildings=[],tileRecords=[]
for(const uri of tiles){
 const url=new URL(uri,entry.url).href,response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`${response.status}: ${url}`)
 const b=Buffer.from(await response.arrayBuffer());if(b.length>5000000||b.toString('utf8',0,4)!=='b3dm')throw Error('Unexpected tile format/size')
 tileRecords.push({url,sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length})
 const lengths=[12,16,20,24].map(i=>b.readUInt32LE(i)),offset=28+lengths.reduce((a,b)=>a+b),glb=b.subarray(offset),gltf=JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)).trim())
 if(!gltf.extensions?.CESIUM_RTC?.center||gltf.nodes.length!==1||gltf.nodes[0].matrix)throw Error('Unsupported transform: extend converter explicitly')
 const rtc=gltf.extensions.CESIUM_RTC.center,primitive=gltf.meshes[0].primitives[0],compression=primitive.extensions.KHR_draco_mesh_compression,view=gltf.bufferViews[compression.bufferView],binOffset=20+glb.readUInt32LE(12)+8
 const bytes=glb.subarray(binOffset+(view.byteOffset||0),binOffset+(view.byteOffset||0)+view.byteLength),decoder=new draco.Decoder(),buffer=new draco.DecoderBuffer(),mesh=new draco.Mesh();buffer.Init(new Int8Array(bytes),bytes.length)
 const status=decoder.DecodeBufferToMesh(buffer,mesh);if(!status.ok())throw Error(status.error_msg())
 const attribute=decoder.GetAttributeByUniqueId(mesh,compression.attributes.POSITION),values=new draco.DracoFloat32Array();decoder.GetAttributeFloatForAllPoints(mesh,attribute,values)
 const batchAttribute=decoder.GetAttributeByUniqueId(mesh,compression.attributes._BATCHID),batchValues=new draco.DracoInt32Array();decoder.GetAttributeInt32ForAllPoints(mesh,batchAttribute,batchValues)
 const byBatch=new Map(),vertices=[]
 for(let i=0;i<mesh.num_points();i++){
  // 3D Tiles applies glTF Y-up -> Z-up, then CESIUM_RTC ECEF translation.
  const p=local(values.GetValue(i*3)+rtc[0],-values.GetValue(i*3+2)+rtc[1],values.GetValue(i*3+1)+rtc[2]),id=batchValues.GetValue(i)
  vertices.push(p);if(!byBatch.has(id))byBatch.set(id,[]);byBatch.get(id).push(p)
 }
 const keep=new Set()
 for(const [id,points] of byBatch){
  const footprint=hull(points.map(p=>[p[0],p[2]]));if(footprint.length<3)continue
  const centerGeo=geo(footprint.reduce((n,p)=>n+p[0],0)/footprint.length,footprint.reduce((n,p)=>n+p[1],0)/footprint.length)
  if(centerGeo.lat<bounds.south||centerGeo.lat>bounds.north||centerGeo.lng<bounds.west||centerGeo.lng>bounds.east)continue
  const min=Math.min(...points.map(p=>p[1])),max=Math.max(...points.map(p=>p[1]));if(max-min<2||max-min>350)continue
  // Use the model's own bottom as local ground; no terrain model is included.
  for(const p of points)p[1]-=min
  buildings.push({id:`plateau:${uri}:${id}`,kind:'building',height:Math.round((max-min)*100)/100,minHeight:0,heightSource:'plateau',footprint:footprint.map(([x,z])=>geo(x,z))});keep.add(id)
 }
 const base=positions.length/3;vertices.forEach(p=>positions.push(...p.map(v=>Math.round(v*100)/100)))
 const face=new draco.DracoInt32Array(),faceCount=mesh.num_faces();for(let i=0;i<faceCount;i++){decoder.GetFaceFromMesh(mesh,i,face);if(keep.has(batchValues.GetValue(face.GetValue(0))))indices.push(base+face.GetValue(0),base+face.GetValue(1),base+face.GetValue(2))}
 ;[face,batchValues,values,mesh,buffer,decoder].forEach(v=>draco.destroy(v))
 console.log(`${uri}: ${keep.size} buildings, ${faceCount} source triangles`)
}
if(buildings.length<10||indices.length<300)throw Error('Sample conversion did not yield sufficient verified geometry')
const p=Float32Array.from(positions),ix=Uint32Array.from(indices),binary=Buffer.concat([Buffer.from(p.buffer),Buffer.from(ix.buffer)])
const minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i++){minimum[i%3]=Math.min(minimum[i%3],positions[i]);maximum[i%3]=Math.max(maximum[i%3],positions[i])}
const gltf={asset:{version:'2.0',generator:'epoku PLATEAU offline subset converter'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.83,.81,.76,1],roughnessFactor:1,metallicFactor:0},doubleSided:true}],buffers:[{byteLength:binary.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:p.byteLength,target:34962},{buffer:0,byteOffset:p.byteLength,byteLength:ix.byteLength,target:34963}],accessors:[{bufferView:0,componentType:5126,count:p.length/3,type:'VEC3',min:minimum,max:maximum},{bufferView:1,componentType:5125,count:ix.length,type:'SCALAR'}]}
let header=Buffer.from(JSON.stringify(gltf));header=Buffer.concat([header,Buffer.alloc((4-header.length%4)%4,32)]);const out=Buffer.alloc(12+8+header.length+8+binary.length);out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(header.length,12);out.writeUInt32LE(0x4e4f534a,16);header.copy(out,20);const bo=20+header.length;out.writeUInt32LE(binary.length,bo);out.writeUInt32LE(0x004e4942,bo+4);binary.copy(out,bo+8)
await mkdir('public/data',{recursive:true});await writeFile('public/data/plateau-nishi.glb',out)
await writeFile('public/data/plateau-nishi.json',JSON.stringify({origin,bounds,year:2024,lod:2,sourcePage,tileset:entry.url,license:'PLATEAU Site Policy section 3',licenseUrl:'https://www.mlit.go.jp/plateau/site-policy/',attribution:'国土交通省 Project PLATEAU / 横浜市2024年度データを加工',ground:'building-local minimum; terrain not included',sha256:createHash('sha256').update(out).digest('hex'),buildings,tileRecords}))
console.log(JSON.stringify({buildings:buildings.length,triangles:indices.length/3,bytes:out.length,bounds:minimum.concat(maximum)}))
