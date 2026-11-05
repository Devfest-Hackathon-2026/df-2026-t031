import {useMemo} from 'react'
import {ArrowUpRight,ChevronRight,Cloud,Compass,Info,Moon,Sun,Sunrise,Sunset,Clock,Leaf,X} from 'lucide-react'
import {AREA_CENTER} from '../domain/area.ts'
import {directionLabel} from '../domain/sun.ts'
import {solarMoments,shadowRatio} from '../domain/solarScene.ts'
import {formatDateJa,formatTime} from '../domain/time.ts'
import {WEATHER_LABEL} from '../lib/weather.ts'
import type {SunPosition,WeatherHour} from '../domain/types.ts'
interface Props{day:string;minutes:number;sun:SunPosition;weather:WeatherHour;weatherSource:string;onTime:(n:number)=>void;onSettings:()=>void;onAbout:()=>void;open:boolean;onToggle:()=>void}
export default function SolarPanel({day,minutes,sun,weather,weatherSource,onTime,onSettings,onAbout,open,onToggle}:Props){
 const times=useMemo(()=>solarMoments(day,AREA_CENTER),[day]),ratio=shadowRatio(sun.altitude),time=(m:number|null)=>m===null?'—':formatTime(m)
 const rows=[
  {label:'夜明け',english:'First light',at:times.dawn,end:null,Icon:Moon,tone:'blue'},
  {label:'朝の薄明',english:'Morning twilight',at:times.dawn,end:times.sunrise,Icon:Sunrise,tone:'blue'},
  {label:'日の出',english:'Sunrise',at:times.sunrise,end:null,Icon:Sunrise,tone:'mint'},
  {label:'朝のゴールデンアワー',english:'Golden hour',at:times.sunrise,end:times.goldenMorningEnd,Icon:Sun,tone:'gold'},
  {label:'太陽が最も高くなる時刻',english:'Solar noon',at:times.noon,end:null,Icon:Sun,tone:'yellow'},
  {label:'夕方のゴールデンアワー',english:'Golden hour',at:times.goldenEveningStart,end:times.sunset,Icon:Sunset,tone:'gold'},
  {label:'日の入り',english:'Sunset',at:times.sunset,end:null,Icon:Sunset,tone:'orange'},
  {label:'夕方の薄明',english:'Evening twilight',at:times.sunset,end:times.dusk,Icon:Moon,tone:'blue'}
 ]
 return <aside className={'solar-panel glass-panel '+(open?'is-open':'')} aria-label="太陽と日陰の情報">
  <button className="solar-mobile-summary" onClick={onToggle}><Sun size={19}/><span>太陽と日陰</span><strong>{Math.round(sun.altitude)}°</strong><ChevronRight size={17}/></button>
  <div className="solar-scroll"><div className="solar-heading"><span>LIGHT & SHADE</span><button aria-label="太陽パネルを閉じる" onClick={onToggle}><X size={16}/></button></div>
   <button className="solar-weather" onClick={onSettings}><span><small>Weather</small><strong>{weather.condition==='clear'?<Sun className="weather-sun" size={27}/>:<Cloud size={27}/>} {WEATHER_LABEL[weather.condition]}</strong><i>{Math.round(weather.temperatureC)}°C <b>· {weatherSource}</b></i></span><ChevronRight size={21}/></button>
   <div className="solar-metrics"><div><span>Azimuth <Compass size={13}/></span><strong>{Math.round(sun.azimuth)}° <small>{directionLabel(sun.azimuth)}</small></strong><i>太陽の方位</i></div><div><span>Altitude <ArrowUpRight size={14}/></span><strong>{Math.round(sun.altitude)}°</strong><i>太陽の高度</i></div><div><span>Shadow</span><strong>{ratio===null?'—':`${ratio.toFixed(1)}×`}</strong><i>高さに対する影の長さ</i></div></div>
   <div className="solar-day-heading"><span>{formatDateJa(day)}</span><small>JAPAN STANDARD TIME</small></div>
   <div className="solar-events">{rows.map((row,index)=>{const active=row.at!==null&&minutes>=row.at&&minutes<(row.end??row.at+35);return <button key={row.label} className={'solar-event '+row.tone+(active?' current':'')+(index===4?' solar-noon':'')} disabled={row.at===null} onClick={()=>row.at!==null&&onTime(Math.max(0,Math.min(1439,row.at)))}><span><small>{row.english}</small><strong>{time(row.at)}{row.end!==null?<><em>→</em>{time(row.end)}</>:null}</strong><i>{row.label}</i></span><row.Icon size={23} strokeWidth={1.5}/></button>})}</div>
   <div className="solar-panel-note"><Leaf size={14}/><span>太陽の動きに合わせて、<br/>心地いいひと休みを見つけよう。</span></div><button className="solar-about" onClick={onAbout}><Info size={12}/>データと予測について<ArrowUpRight size={12}/></button>
  </div>
 </aside>
}
