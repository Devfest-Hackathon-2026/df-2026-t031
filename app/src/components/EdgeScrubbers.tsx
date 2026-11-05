import {useRef,type PointerEvent as ReactPointerEvent} from 'react'
import {formatTime,formatDateJa} from '../domain/time.ts'

/**
 * Sunlitt 風の「画面の端をなぞって時刻・日付を変える」操作。
 * 右端の時刻ピルを上下にドラッグすると時刻が（上で進む・下で戻る）、左端の日付ピルで日付が変わる。
 * タップだけなら何もしない。キーボードでは ↑↓ で同じ操作ができる。
 */
interface Props{day:string;today:string;minutes:number;onMinutes:(m:number)=>void;onDay:(d:string)=>void;onNow:()=>void}
export function shiftDay(day:string,delta:number){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10)}
const MINUTES_PER_PX=2,PX_PER_DAY=22

export default function EdgeScrubbers({day,today,minutes,onMinutes,onDay,onNow}:Props){
 const drag=useRef<{kind:'time'|'day';y:number;start:number;startDay:string}|null>(null)
 const begin=(kind:'time'|'day')=>(e:ReactPointerEvent<HTMLButtonElement>)=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={kind,y:e.clientY,start:minutes,startDay:day}}
 const move=(e:ReactPointerEvent<HTMLButtonElement>)=>{const d=drag.current;if(!d)return;const dy=d.y-e.clientY
  if(d.kind==='time')onMinutes(Math.max(0,Math.min(1439,Math.round(d.start+dy*MINUTES_PER_PX))))
  else{const days=Math.round(dy/PX_PER_DAY),next=shiftDay(d.startDay,days);if(next!==day)onDay(next)}}
 const end=()=>{drag.current=null}
 const isToday=day===today
 return <>
  <button className="edge-pill edge-day" aria-label={`日付 ${formatDateJa(day)}。上下にドラッグで変更`} onPointerDown={begin('day')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
   onKeyDown={e=>{if(e.key==='ArrowUp'){e.preventDefault();onDay(shiftDay(day,1))}if(e.key==='ArrowDown'){e.preventDefault();onDay(shiftDay(day,-1))}}}>
   {isToday?'今日':formatDateJa(day)}
  </button>
  <button className="edge-pill edge-time" aria-label={`時刻 ${formatTime(minutes)}。上下にドラッグで変更`} onPointerDown={begin('time')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
   onKeyDown={e=>{if(e.key==='ArrowUp'){e.preventDefault();onMinutes(Math.min(1439,minutes+15))}if(e.key==='ArrowDown'){e.preventDefault();onMinutes(Math.max(0,minutes-15))}}}>
   {formatTime(minutes)}
  </button>
  <button className="edge-now" aria-label="いまの時刻に戻す" onClick={onNow}>今</button>
 </>
}
