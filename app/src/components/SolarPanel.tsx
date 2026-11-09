import {useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react'
import {ArrowUpRight,ChevronRight,ChevronUp,Cloud,Compass,Info,Moon,Sun,Sunrise,Sunset,Leaf,X,CloudSun,CloudMoon,MoonStar,SunDim} from 'lucide-react'
import {AREA_CENTER} from '../domain/area.ts'
import {directionLabel} from '../domain/sun.ts'
import {solarMoments,shadowRatio,solarTrack,nextSolarMoment} from '../domain/solarScene.ts'
import SunDialCard from './SunDialCard.tsx'
import {formatDateJa,formatTime} from '../domain/time.ts'
import {WEATHER_LABEL} from '../lib/weather.ts'
import type {SunPosition,WeatherHour} from '../domain/types.ts'
interface Props{day:string;minutes:number;sun:SunPosition;weather:WeatherHour;weatherSource:string;onTime:(n:number)=>void;onSettings:()=>void;onAbout:()=>void;open:boolean;onToggle:()=>void}
export default function SolarPanel({day,minutes,sun,weather,weatherSource,onTime,onSettings,onAbout,open,onToggle}:Props){
 const times=useMemo(()=>solarMoments(day,AREA_CENTER),[day]),track=useMemo(()=>solarTrack(day,AREA_CENTER,1),[day]),ratio=shadowRatio(sun.altitude),time=(m:number|null)=>m===null?'—':formatTime(((m%1440)+1440)%1440),length=(m:number|null)=>m===null?'—':`${Math.floor(m/60)} 時間 ${m%60} 分`
 type Row={label:string;at:number|null;end:number|null;Icon:typeof Sun;tone:string}
 const groups:Row[][]=[
  [{label:'最初の光',at:times.dawn,end:null,Icon:SunDim,tone:'blue'},
   {label:'青い時間',at:times.dawn,end:times.blueMorningEnd,Icon:CloudMoon,tone:'blue'},
   {label:'日の出',at:times.sunrise,end:null,Icon:Sunrise,tone:'mint'},
   {label:'黄金時間',at:times.blueMorningEnd,end:times.goldenMorningEnd,Icon:CloudSun,tone:'gold'}],
  [{label:'太陽南中',at:times.noon,end:null,Icon:Sun,tone:'yellow'}],
  [{label:'黄金時間',at:times.goldenEveningStart,end:times.blueEveningStart,Icon:CloudSun,tone:'gold'},
   {label:'日没',at:times.sunset,end:null,Icon:Sunset,tone:'orange'},
   {label:'青い時間',at:times.blueEveningStart,end:times.dusk,Icon:CloudMoon,tone:'blue'},
   {label:'最後の光',at:times.dusk,end:null,Icon:Moon,tone:'blue'}],
  [{label:'太陽の真夜中',at:times.nadir,end:null,Icon:MoonStar,tone:'blue'}],
 ]
 const next=nextSolarMoment(times,minutes),until=(m:number)=>m<60?`あと${m}分`:`あと${Math.floor(m/60)}時間${m%60?`${m%60}分`:''}`
 // スマホ幅ではボトムシート。つまみを上下にドラッグ（またはタップ）で開閉する。指を離すまでは少しだけ追従させる
 const drag=useRef<{y:number;moved:boolean}|null>(null),suppress=useRef(false),[pull,setPull]=useState(0)
 const isSheet=()=>matchMedia('(max-width:760px)').matches
 const down=(e:ReactPointerEvent<HTMLDivElement>)=>{suppress.current=false;if(!isSheet()||e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={y:e.clientY,moved:false}}
 const move=(e:ReactPointerEvent<HTMLDivElement>)=>{const d=drag.current;if(!d)return;const dy=e.clientY-d.y;if(!d.moved&&Math.abs(dy)>6)d.moved=true;if(d.moved)setPull(open?Math.max(0,dy):Math.max(-48,Math.min(0,dy*.35)))}
 const up=(e:ReactPointerEvent<HTMLDivElement>)=>{const d=drag.current;drag.current=null;setPull(0);if(!d)return;suppress.current=true;setTimeout(()=>{suppress.current=false},400);const dy=e.clientY-d.y;if(!d.moved||(open?dy>60:dy<-30))onToggle()}
 const cancel=()=>{drag.current=null;setPull(0)}
 const current=(row:Row)=>row.at!==null&&minutes>=row.at&&minutes<(row.end??row.at+35)
 return <aside className={'solar-panel glass-panel '+(open?'is-open':'')+(pull?' is-dragging':'')} style={pull?{'--sheet-pull':`${pull}px`} as React.CSSProperties:undefined} aria-label="太陽と日陰の情報">
  <div className="solar-sheet-top" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}><span className="sheet-grabber" aria-hidden="true"/>
   <button className="solar-mobile-summary" aria-expanded={open} aria-label={open?'太陽パネルを閉じる':'太陽パネルを開く'} onClick={()=>{if(suppress.current){suppress.current=false;return}onToggle()}}><Sun className="summary-sun" size={19}/><span className="mini-dial" aria-hidden="true"><SunDialCard sun={sun} track={track}/></span><span className="summary-copy"><span>太陽と日陰</span>{next?<em>次は{next.label} {time(next.at)} · {until(next.inMin)}</em>:null}</span><strong>{Math.round(sun.altitude)}°<small>{directionLabel(sun.azimuth)}</small></strong><ChevronRight className="summary-chevron" size={17}/><ChevronUp className="summary-up" size={19}/></button>
  </div>
  <div className="solar-scroll"><div className="solar-heading"><span>LIGHT & SHADE</span><button aria-label="太陽パネルを閉じる" onClick={onToggle}><X size={16}/></button></div>
   <SunDialCard sun={sun} track={track}/>
   <button className="solar-weather" onClick={onSettings}><span><small>天気</small><strong>{weather.condition==='clear'?<Sun className="weather-sun" size={27}/>:<Cloud size={27}/>} {WEATHER_LABEL[weather.condition]}</strong><i>{Math.round(weather.temperatureC)}°C <b>· {weatherSource}</b></i></span><ChevronRight size={21}/></button>
   <div className="solar-metrics"><div><span>方位角 <Compass size={13}/></span><strong>{Math.round(sun.azimuth)}° <small>{directionLabel(sun.azimuth)}</small></strong><i>太陽の方位</i></div><div><span>高度 <ArrowUpRight size={14}/></span><strong>{Math.round(sun.altitude)}°</strong><i>太陽の高度</i></div><div><span>日影比率</span><strong>{ratio===null?'—':`${ratio.toFixed(1)}×`}</strong><i>高さに対する影の長さ</i></div></div>
   <div className="solar-day-heading"><span>{formatDateJa(day)}</span><small>日本時間</small></div>
   {groups.map((group,g)=><div className="solar-events" key={g}>{group.map(row=><button key={row.label+row.at} className={'solar-event '+row.tone+(current(row)?' current':'')+(g===1?' solar-noon':'')} disabled={row.at===null} onClick={()=>row.at!==null&&onTime(Math.max(0,Math.min(1439,row.at%1440)))}><span><small>{row.label}</small><strong>{time(row.at)}{row.end!==null?<><em>→</em>{time(row.end)}</>:null}</strong></span><row.Icon size={22} strokeWidth={1.5}/></button>)}</div>)}
   <div className="solar-lengths"><div><small>日</small><strong>{length(times.dayLength)}</strong></div><div><small>夜</small><strong>{times.dayLength===null?'—':length(1440-times.dayLength)}</strong></div></div>
   <div className="solar-panel-note"><Leaf size={14}/><span>太陽の動きに合わせて、<br/>心地いいひと休みを見つけよう。</span></div><button className="solar-about" onClick={onAbout}><Info size={12}/>データと予測について<ArrowUpRight size={12}/></button>
  </div>
 </aside>
}
