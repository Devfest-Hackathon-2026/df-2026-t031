import type {WeatherHour,WeatherForecast,WeatherCondition} from '../domain/types.ts'
import {jstDate,jstParts} from '../domain/time.ts'
export function demoWeather(day:string,minutes:number,temp=24,condition:WeatherCondition='clear'):WeatherHour{return {time:jstDate(day,minutes).toISOString(),temperatureC:temp,condition,humidity:60,precipitationProbability:condition==='rain'?90:10,solarRadiation:null,windSpeed:2}}
export function weatherAt(forecast:WeatherForecast|null,time:Date):WeatherHour|null{const target=time.getTime();return forecast?.hours.find(h=>target>=Date.parse(h.time)&&target<Date.parse(h.time)+3600000)??null}
const conditionOf=(n:number):WeatherCondition=>n===0?'clear':n<=2?'partly-cloudy':n===3?'cloudy':n<=48?'fog':n>=71&&n<=77?'snow':n>=95?'heavy-rain':'rain'
export async function openMeteo():Promise<WeatherForecast>{
 const r=await fetch('https://api.open-meteo.com/v1/forecast?latitude=35.45765&longitude=139.6356&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m,shortwave_radiation&wind_speed_unit=ms&timezone=Asia%2FTokyo&forecast_days=7',{signal:AbortSignal.timeout(15000)})
 if(!r.ok)throw Error('天気を取得できませんでした。手動デモを引き続き使えます。')
 const h=(await r.json()).hourly
 if(!Array.isArray(h?.time)||!Array.isArray(h.temperature_2m)||!Array.isArray(h.weather_code))throw Error('天気データの形式が不正です。')
 const hours:WeatherHour[]=h.time.flatMap((time:string,i:number)=>Number.isFinite(h.temperature_2m[i])&&Number.isFinite(h.weather_code[i])?[{time:new Date(`${time}+09:00`).toISOString(),temperatureC:h.temperature_2m[i],condition:conditionOf(h.weather_code[i]),humidity:h.relative_humidity_2m?.[i]??null,precipitationProbability:h.precipitation_probability?.[i]??null,solarRadiation:h.shortwave_radiation?.[i]??null,windSpeed:h.wind_speed_10m?.[i]??null}]:[])
 if(!hours.length)throw Error('有効な天気データがありません。')
 return {hours,sourceLabel:'Open-Meteo',isDemo:false,fetchedAt:new Date().toISOString()}
}
export async function googleWeather():Promise<WeatherForecast>{const r=await fetch('/api/weather',{signal:AbortSignal.timeout(20000)});if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Weather APIサーバーは未接続です。');const d=await r.json();if(!r.ok)throw Error(d.error||'天気の取得に失敗しました。');return d}
export const WEATHER_LABEL:Record<WeatherCondition,string>={clear:'晴れ','partly-cloudy':'晴れ時々くもり',cloudy:'くもり',fog:'霧',rain:'雨','heavy-rain':'強い雨',snow:'雪',unknown:'不明'}
