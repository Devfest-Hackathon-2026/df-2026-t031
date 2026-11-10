// 天気（Open-Meteo の予報、サーバー経由の Google Weather、APIなしのデモ値）。2026-11-10 に書き直し
import type {WeatherCondition,WeatherForecast,WeatherHour,WeatherNow} from '../domain/types.ts'
import {apiUrl} from './api.ts'
import {AREA_CENTER} from '../domain/area.ts'
import {jstDate} from '../domain/time.ts'
export const WEATHER_LABEL:Record<WeatherCondition,string>={clear:'晴れ','partly-cloudy':'晴れ時々くもり',cloudy:'くもり',fog:'霧',rain:'雨','heavy-rain':'強い雨',snow:'雪',unknown:'不明'}
/** APIなしで使う天気。11月の横浜の平年並みの気温を、日の出前に低く・14時ごろに高くなるように作る */
export function demoWeather(day:string,minutes:number,temperatureC?:number,condition:WeatherCondition='clear'):WeatherNow{
 const month=Number(day.slice(5,7))||11,mean=[6,6.5,9.5,14.5,19,22,26,27.5,24,19,14,9][month-1],range=7
 const t=temperatureC??Math.round((mean+range/2*Math.cos((minutes/60-14)/24*2*Math.PI))*10)/10
 return {temperatureC:t,condition,humidity:60,precipitationProbability:condition==='rain'||condition==='heavy-rain'?80:10,windSpeed:3,solarRadiation:null}
}
/** WMO の天気コードを区分に */
export function wmoCondition(code:number):WeatherCondition{if(code===0||code===1)return 'clear';if(code===2)return 'partly-cloudy';if(code===3)return 'cloudy';if(code===45||code===48)return 'fog';if(code>=71&&code<=77||code===85||code===86)return 'snow';if(code===65||code===67||code===82||code>=95)return 'heavy-rain';if(code>=51&&code<=82)return 'rain';return 'unknown'}
/** Open-Meteo（キー不要）の 1 時間ごとの予報（今日・明日） */
export async function openMeteo(at=AREA_CENTER):Promise<WeatherForecast>{
 const u=`https://api.open-meteo.com/v1/forecast?latitude=${at.lat}&longitude=${at.lng}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m,shortwave_radiation&wind_speed_unit=ms&timezone=Asia%2FTokyo&forecast_days=2`
 const r=await fetch(u,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('天気予報を取得できませんでした。デモの天気を使います。')
 const d=await r.json(),h=d.hourly
 const hours:WeatherHour[]=h.time.map((t:string,i:number)=>({time:jstDate(t.slice(0,10),Number(t.slice(11,13))*60).toISOString(),temperatureC:h.temperature_2m[i],condition:wmoCondition(h.weather_code[i]),humidity:h.relative_humidity_2m[i]??null,precipitationProbability:h.precipitation_probability[i]??null,windSpeed:h.wind_speed_10m[i]??null,solarRadiation:h.shortwave_radiation[i]??null}))
 return {source:'open-meteo',sourceLabel:'Open-Meteo 予報',fetchedAt:new Date().toISOString(),hours}
}
/** 予報のうち、時刻 t を含む 1 時間の値（予報の範囲外なら null） */
export function weatherAt(f:WeatherForecast|null|undefined,t:Date):WeatherHour|null{if(!f)return null;const x=t.getTime();return f.hours.find(h=>x>=Date.parse(h.time)&&x<Date.parse(h.time)+3600_000)??null}
export async function googleWeather():Promise<WeatherForecast>{const r=await fetch(apiUrl('/api/weather'),{signal:AbortSignal.timeout(20000)});if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Weather APIサーバーは未接続です。');const d=await r.json();if(!r.ok)throw Error(d.error||'天気の取得に失敗しました。');return d}


