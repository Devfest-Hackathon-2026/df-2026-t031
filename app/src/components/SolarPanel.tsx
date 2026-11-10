import {useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react'
import {ArrowUpRight,ChevronRight,ChevronUp,Cloud,Compass,Info,Moon,Sun,Sunrise,Sunset,Leaf,X,CloudSun,CloudMoon,MoonStar,SunDim} from 'lucide-react'
import {AREA_CENTER} from '../domain/area.ts'
import {formatDateJa,formatTime} from '../domain/time.ts'
import {solarMoments,shadowRatio,solarTrack,nextSolarMoment} from '../domain/solarScene.ts'
import SunDialCard from './SunDialCard.tsx'
import {directionLabel} from '../domain/sun.ts'
import {WEATHER_LABEL} from '../lib/weather.ts'
import type {SunPosition,WeatherNow} from '../domain/types.ts'
// 太陽と日陰のパネル（PC は左の縦長パネル、スマホは下から引き出すシート）。2026-11-10 に書き直し（期間中に足した部分はそのまま）
interface Props{day:string;minutes:number;sun:SunPosition;weather:Pick<WeatherNow,'temperatureC'|'condition'>;weatherSource:string;onTime:(m:number)=>void;onSettings:()=>void;onAbout:()=>void;open:boolean;onToggle:()=>void}
const length=(m:number|null)=>m===null?'—':`${Math.floor(m/60)}時間${m%60}分`
export default function SolarPanel({day,minutes,sun,weather,weatherSource,onTime,onSettings,onAbout,open,onToggle}:Props){
 const times=useMemo(()=>solarMoments(day,AREA_CENTER),[day]),track=useMemo(()=>solarTrack(day,AREA_CENTER,1),[day]),ratio=shadowRatio(sun.altitude),time=(m:number|null)=>m===null?'—':formatTime(((m%1440)+1440)%1440)
 const next=nextSolarMoment(times,minutes),until=(m:number)=>m<60?`あと${m}分`:`あと${Math.floor(m/60)}時間${m%60?`${m%60}分`:''}`
 // スマホ幅ではボトムシート。つまみを上下にドラッグ（またはタップ）で開閉する。指を離すまでは少しだけ追従させる
 const drag=useRef<{y:number;moved:boolean}|null>(null),suppress=useRef(false),[pull,setPull]=useState(0)
 const isSheet=()=>matchMedia('(max-width:760px)').matches
 const down=(e:ReactPointerEvent<HTMLDivElement>)=>{suppress.current=false;if(!isSheet()||e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={y:e.clientY,moved:false}}
 const move=(e:ReactPointerEvent<HTMLDivElement>)=>{const d=drag.current;if(!d)return;const dy=e.clientY-d.y;if(!d.moved&&Math.abs(dy)>6)d.moved=true;if(d.moved)setPull(open?Math.max(0,dy):Math.max(-48,Math.min(0,dy*.35)))}
 const up=(e:ReactPointerEvent<HTMLDivElement>)=>{const d=drag.current;drag.current=null;setPull(0);if(!d)return;suppress.current=true;setTimeout(()=>{suppress.current=false},400);const dy=e.clientY-d.y;if(!d.moved||(open?dy>60:dy<-30))onToggle()}
 const cancel=()=>{drag.current=null;setPull(0)}
 return <aside className={'solar-panel glass-panel '+(open?'is-open':'')+(pull?' is-dragging':'')} style={pull?{'--sheet-pull':`${pull}px`} as React.CSSProperties:undefined} aria-label="太陽と日陰の情報">
  <div className="solar-sheet-top" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}><span className="sheet-grabber" aria-hidden="true"/>
   <button className="solar-mobile-summary" aria-expanded={open} aria-label={open?'太陽パネルを閉じる':'太陽パネルを開く'} onClick={()=>{if(suppress.current){suppress.current=false;return}onToggle()}}><Sun className="summary-sun" size={19}/><span className="mini-dial" aria-hidden="true"><SunDialCard sun={sun} track={track}/></span><span className="summary-copy"><span>太陽と日陰</span>{next?<em>次は{next.label} {time(next.at)} · {until(next.inMin)}</em>:null}</span><strong>{Math.round(sun.altitude)}°<small>{directionLabel(sun.azimuth)}</small></strong><ChevronRight className="summary-chevron" size={17}/><ChevronUp className="summary-up" size={19}/></button>
  </div>
  <div className="solar-scroll">
   <div className="solar-heading"><span><Leaf size={15}/>太陽と日陰</span><button aria-label="データと計算について" onClick={onAbout}><Info size={16}/></button><button className="solar-close" aria-label="太陽パネルを閉じる" onClick={onToggle}><X size={16}/></button></div>
   <SunDialCard sun={sun} track={track}/>
   <button className="solar-weather" onClick={onSettings}><span><small>天気</small><strong>{weather.condition==='clear'?<Sun className="weather-sun" size={27}/>:<Cloud size={27}/>} {WEATHER_LABEL[weather.condition]}</strong><i>{Math.round(weather.temperatureC)}°C <b>· {weatherSource}</b></i></span><ChevronRight size={21}/></button>
   <div className="solar-metrics"><div><span>方位角 <Compass size={13}/></span><strong>{Math.round(sun.azimuth)}° <small>{directionLabel(sun.azimuth)}</small></strong><i>太陽の方位</i></div><div><span>高度 <ArrowUpRight size={14}/></span><strong>{Math.round(sun.altitude)}°</strong><i>太陽の高度</i></div><div><span>日影比率</span><strong>{ratio===null?'—':`${ratio.toFixed(1)}×`}</strong><i>高さに対する影の長さ</i></div></div>
   <div className="solar-day-heading"><span>{formatDateJa(day)}</span><small>日本時間</small></div>
   <div className="solar-sunline"><span><Sunrise size={16} strokeWidth={1.6}/>日の出 {time(times.sunrise)}</span><span><Sun size={16} strokeWidth={1.6}/>南中 {time(times.noon)}</span><span><Sunset size={16} strokeWidth={1.6}/>日の入り {time(times.sunset)}</span></div>
   <p className="solar-hint">ベンチの日陰は、地図の上のおすすめと「休憩スポット」で、着く時刻に合わせて表示します。</p>
   <div className="solar-events">{([['最初の光',times.dawn,SunDim],['青い時間',times.blueMorningEnd,MoonStar],['日の出',times.sunrise,Sunrise],['黄金時間の終わり',times.goldenMorningEnd,CloudSun]] as const).map(([label,m,Icon])=><button key={label} className="solar-event" onClick={()=>m!==null&&onTime(m)} disabled={m===null}><span><Icon size={15}/><small>{label}</small></span><strong>{time(m)}</strong></button>)}</div>
   <div className="solar-events">{([['黄金時間',times.goldenEveningStart,CloudMoon],['日没',times.sunset,Sunset],['青い時間の終わり',times.blueEveningStart,MoonStar],['最後の光',times.dusk,Moon]] as const).map(([label,m,Icon])=><button key={label} className="solar-event" onClick={()=>m!==null&&onTime(m)} disabled={m===null}><span><Icon size={15}/><small>{label}</small></span><strong>{time(m)}</strong></button>)}</div>
   <div className="solar-lengths"><div><small>昼の長さ</small><strong>{length(times.dayLength)}</strong></div><div><small>太陽の真夜中</small><strong>{time(times.nadir)}</strong></div></div>
   <button className="solar-up" aria-label="上へ戻る" onClick={e=>e.currentTarget.closest('.solar-scroll')?.scrollTo({top:0,behavior:'smooth'})}><ChevronUp size={16}/></button>
  </div>
 </aside>
}

