import {useRef,useState,type ReactNode} from 'react'
import {ChevronUp,ChevronDown} from 'lucide-react'
export type SheetSnap='peek'|'half'|'full'
const snaps:SheetSnap[]=['peek','half','full']
export default function BottomSheet({snap,onSnap,children}:{snap:SheetSnap;onSnap:(snap:SheetSnap)=>void;children:ReactNode}){
 const start=useRef<number|null>(null),suppressClick=useRef(false),[drag,setDrag]=useState(0)
 const step=(direction:number)=>onSnap(snaps[Math.max(0,Math.min(2,snaps.indexOf(snap)+direction))])
 return <div className={`bottom-sheet sheet-${snap}`} style={{'--sheet-drag':`${drag}px`} as React.CSSProperties} data-snap={snap}>
  <div className="sheet-handle-row">
   <button className="sheet-handle" aria-label="休憩スポットのシートを切り替える" aria-expanded={snap!=='peek'} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return}step(snap==='full'?-1:1)}} onPointerDown={e=>{start.current=e.clientY;suppressClick.current=false;e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(start.current!==null)setDrag(Math.max(-140,Math.min(140,e.clientY-start.current)))}} onPointerUp={e=>{if(start.current!==null){const delta=e.clientY-start.current;if(Math.abs(delta)>30){suppressClick.current=true;step(delta<0?1:-1)}start.current=null;setDrag(0)}}} onPointerCancel={()=>{start.current=null;setDrag(0)}}><span/></button>
   <button className="sheet-size" aria-label={snap==='full'?'シートを小さくする':'シートを広げる'} onClick={()=>step(snap==='full'?-1:1)}>{snap==='full'?<ChevronDown size={20}/>:<ChevronUp size={20}/>}</button>
  </div>
  {children}
 </div>
}
