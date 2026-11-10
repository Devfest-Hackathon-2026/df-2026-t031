// 2D 地図に描く建物の影の形。建物の外形を太陽と反対向きに「高さ ÷ tan(高度)」だけずらし、元の外形とつないだ凸包にする。2026-11-10 作成
import type {SunPosition,XY} from './types.ts'
function hull(pts:XY[]):XY[]{
 const p=[...pts].sort((a,b)=>a.x-b.x||a.y-b.y);if(p.length<3)return p
 const cross=(o:XY,a:XY,b:XY)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x),lower:XY[]=[],upper:XY[]=[]
 for(const q of p){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],q)<=0)lower.pop();lower.push(q)}
 for(const q of p.reverse()){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],q)<=0)upper.pop();upper.push(q)}
 return lower.slice(0,-1).concat(upper.slice(0,-1))
}
/** 1 つの建物の影。太陽が地平線の下なら null。影の長さは maxLength で打ち切る */
export function shadowPolygon(ring:XY[],height:number,sun:SunPosition,maxLength=600):XY[]|null{
 if(sun.altitude<=0.5||ring.length<3||!(height>0))return null
 const len=Math.min(maxLength,height/Math.tan(sun.altitude*Math.PI/180)),a=sun.azimuth*Math.PI/180,dx=-Math.sin(a)*len,dy=-Math.cos(a)*len
 return hull([...ring,...ring.map(p=>({x:p.x+dx,y:p.y+dy}))])
}
/** 樹木の影（円を太陽と反対向きにずらした楕円の近似。中心と半径を返す） */
export function treeShadow(c:XY,height:number,radius:number,sun:SunPosition){if(sun.altitude<=0.5)return null;const len=Math.min(200,height*.75/Math.tan(sun.altitude*Math.PI/180)),a=sun.azimuth*Math.PI/180;return {x:c.x-Math.sin(a)*len,y:c.y-Math.cos(a)*len,r:radius}}
