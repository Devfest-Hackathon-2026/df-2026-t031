import {useMemo} from 'react'
import type {SunPosition} from '../domain/types.ts'

/**
 * パネル上部の日時計カード（Sunlitt の石柱表示を参考にした図）。
 * 空の色の背景に、その日の太陽の軌道・いまの太陽・石柱と影を、斜め上から見た図で描く。
 */
type TrackPoint={sun:SunPosition}
const SKY:Record<'day'|'golden'|'blue'|'night',[string,string]>={day:['#f7d653','#f1c33f'],golden:['#f6b25b','#ec8d4a'],blue:['#7090d6','#4b69b3'],night:['#27324f','#161c2f']}
export function skyTone(altitude:number){return altitude>6?'day':altitude>-4?'golden':altitude>-6?'blue':'night'}

export default function SunDialCard({sun,track}:{sun:SunPosition;track:TrackPoint[]}){
 const W=320,H=196,R=92,cx=W/2+6,cy=H/2+34,look=340,el=24*Math.PI/180
 const tone=skyTone(sun.altitude),[c1,c2]=SKY[tone],dark=tone==='night'||tone==='blue'
 const drawing=useMemo(()=>{
  const proj=(az:number,r:number,u:number):[number,number]=>{const a=(az-look)*Math.PI/180,x=r*Math.sin(a),d=r*Math.cos(a);return [cx+x,cy-(u*Math.cos(el)+d*Math.sin(el))]}
  const xy=(e:number,n:number,u:number)=>proj(Math.atan2(e,n)*180/Math.PI,Math.hypot(e,n),u)
  const sky=(s:SunPosition):[number,number]=>{const alt=Math.max(s.altitude,-2)*Math.PI/180;return proj(s.azimuth,R*Math.cos(alt),Math.max(0,R*Math.sin(alt)))}
  const ground=Array.from({length:61},(_,i)=>proj(i*6,R,0).join(',')).join(' ')
  const arc=track.map(p=>sky(p.sun).join(',')).join(' ')
  const a=15,h=30,base:[number,number][]=[[-a,-a],[a,-a],[a,a],[-a,a]]
  let shadow:string|null=null
  if(sun.altitude>.5){const L=Math.min(h/Math.tan(sun.altitude*Math.PI/180),150),az=sun.azimuth*Math.PI/180,dx=-Math.sin(az)*L,dy=-Math.cos(az)*L;shadow=hull([...base,...base.map(([e,n])=>[e+dx,n+dy] as [number,number])].map(([e,n])=>xy(e,n,0))).map(p=>p.join(',')).join(' ')}
  const lookRad=look*Math.PI/180,cam=[-Math.sin(lookRad),-Math.cos(lookRad)],sunH=[Math.sin(sun.azimuth*Math.PI/180),Math.cos(sun.azimuth*Math.PI/180)]
  const faces:{pts:string;fill:string}[]=[]
  for(const [i,j,nx,ny] of [[0,1,0,-1],[1,2,1,0],[2,3,0,1],[3,0,-1,0]] as const){
   if(nx*cam[0]+ny*cam[1]<=0)continue
   const lit=sun.altitude>0?Math.max(0,nx*sunH[0]+ny*sunH[1]):0,v=Math.round(176+lit*62)
   faces.push({pts:[xy(...base[i],0),xy(...base[j],0),xy(...base[j],h),xy(...base[i],h)].map(p=>p.join(',')).join(' '),fill:`rgb(${v},${v},${v+4})`})
  }
  const top=base.map(([e,n])=>xy(e,n,h).join(',')).join(' ')
  return {ground,arc,shadow,faces,top,sunAt:sun.altitude>-8?sky(sun):null}
 },[sun.azimuth,sun.altitude,track])
 return <div className={'solar-dial tone-'+tone} style={{background:`linear-gradient(180deg,${c1},${c2})`}}>
  <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`太陽の方位 ${Math.round(sun.azimuth)}度、高度 ${Math.round(sun.altitude)}度`}>
   <polygon points={drawing.ground} fill="none" stroke={dark?'rgba(255,255,255,.3)':'rgba(80,62,14,.3)'} strokeWidth="1.5"/>
   {drawing.shadow?<polygon points={drawing.shadow} fill="rgba(70,52,8,.3)"/>:null}
   {drawing.arc?<polyline points={drawing.arc} fill="none" stroke={dark?'rgba(255,255,255,.5)':'rgba(255,255,255,.92)'} strokeWidth="2.2" strokeDasharray="1 5" strokeLinecap="round"/>:null}
   {drawing.faces.map((f,i)=><polygon key={i} points={f.pts} fill={f.fill}/>)}
   <polygon points={drawing.top} fill="#f7f7f9"/>
   {drawing.sunAt?<g><circle cx={drawing.sunAt[0]} cy={drawing.sunAt[1]} r="11" fill={sun.altitude>0?'#fff':'rgba(255,255,255,.5)'}/><circle cx={drawing.sunAt[0]} cy={drawing.sunAt[1]} r="15.5" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="2"/></g>:null}
  </svg>
 </div>
}

function hull(points:[number,number][]){
 const p=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(o:number[],a:number[],b:number[])=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
 const half=(list:[number,number][])=>{const out:[number,number][]=[];for(const q of list){while(out.length>=2&&cross(out[out.length-2],out[out.length-1],q)<=0)out.pop();out.push(q)}out.pop();return out}
 return [...half(p),...half([...p].reverse())]
}
