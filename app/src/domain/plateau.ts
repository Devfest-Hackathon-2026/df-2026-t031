import {LocalProjection,pointInRing} from './geo.ts'
import {AREA_CENTER} from './area.ts'
import type {AreaDataset,Building,LatLng,XY} from './types.ts'
const centroid=(ring:XY[])=>({x:ring.reduce((n,p)=>n+p.x,0)/ring.length,y:ring.reduce((n,p)=>n+p.y,0)/ring.length})
export interface PlateauSubset {origin:LatLng;year:number;lod:number;buildings:Building[];sourcePage:string;licenseUrl:string}
/** Keep the two sources separate; replace overlapping OSM building volumes, not POIs or trees. */
export function withPlateau(dataset:AreaDataset,subset:PlateauSubset):AreaDataset{
 if(subset.year!==2024||subset.lod!==2||!Array.isArray(subset.buildings)||Math.abs(subset.origin.lat-AREA_CENTER.lat)>.00001||Math.abs(subset.origin.lng-AREA_CENTER.lng)>.00001)return dataset
 const projection=new LocalProjection(AREA_CENTER)
 const shapes=subset.buildings.filter(b=>b.heightSource==='plateau'&&Number.isFinite(b.height)&&b.height>0&&b.footprint.length>=3).map(b=>({building:b,ring:b.footprint.map(p=>projection.toXY(p))}))
 const buildings=dataset.buildings.filter(b=>{const ring=b.footprint.map(p=>projection.toXY(p)),center=centroid(ring);return !shapes.some(s=>pointInRing(center,s.ring)||pointInRing(centroid(s.ring),ring))})
 return {...dataset,buildings:[...buildings,...shapes.map(s=>s.building)],meta:{...dataset.meta,plateauBuildings:shapes.length,sourceLabel:'OSM + PLATEAU 横浜市2024 LOD2',attribution:dataset.meta.attribution+' / 国土交通省 Project PLATEAU 横浜市2024年度データを加工'}}
}
