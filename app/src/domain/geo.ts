// 緯度経度と平面座標（m）の変換。2026-11-10 に開始後のコードとして書き直し
import type {LatLng,XY} from './types.ts'
const R=6371008.8,rad=(d:number)=>d*Math.PI/180
/** 2点間の大円距離（m） */
export function haversineM(a:LatLng,b:LatLng){const dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng),h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(h)))}
/** 原点まわり数km の範囲で使う正距円筒近似。x は東、y は北（m） */
export class LocalProjection{
 readonly kx:number;readonly ky:number
 constructor(readonly origin:LatLng){this.ky=rad(1)*R;this.kx=this.ky*Math.cos(rad(origin.lat))}
 toXY(p:LatLng):XY{return {x:(p.lng-this.origin.lng)*this.kx,y:(p.lat-this.origin.lat)*this.ky}}
 toLatLng(p:XY):LatLng{return {lat:this.origin.lat+p.y/this.ky,lng:this.origin.lng+p.x/this.kx}}
}
/** 点が多角形の内側か（偶奇判定） */
export function pointInRing(p:XY,ring:XY[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside}return inside}
/** 多角形の重心（頂点の平均） */
export const centroidXY=(ring:XY[]):XY=>({x:ring.reduce((n,p)=>n+p.x,0)/Math.max(1,ring.length),y:ring.reduce((n,p)=>n+p.y,0)/Math.max(1,ring.length)})
