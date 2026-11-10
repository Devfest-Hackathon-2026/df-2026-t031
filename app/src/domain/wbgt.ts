// 暑さ指数（WBGT）のおおよその推定。気温・湿度・日射（太陽高度と天気）から求める参考値で、環境省の実況値や予報ではない
import type {WeatherNow} from './types.ts'
export type WbgtLevel='safe'|'caution'|'warning'|'severe'|'danger'
export const WBGT_LABEL:Record<WbgtLevel,string>={safe:'ほぼ安全',caution:'注意',warning:'警戒',severe:'厳重警戒',danger:'危険'}
/** 環境省の指針の区切り（21・25・28・31） */
export const wbgtLevel=(w:number):WbgtLevel=>w>=31?'danger':w>=28?'severe':w>=25?'warning':w>=21?'caution':'safe'
const SKY:Record<string,number>={clear:1,'partly-cloudy':.7,cloudy:.3,fog:.2,rain:.1,'heavy-rain':.05,snow:.1,unknown:.6}
/** 日なたの WBGT の推定（℃・小数1桁）。気温が分からなければ 20℃ とみなす */
export function estimateWbgt(w:Pick<WeatherNow,'temperatureC'|'condition'>&{humidity?:number|null},sunAltitude:number):number{
 const t=Number.isFinite(w.temperatureC)?w.temperatureC:20
 const rh=Math.max(5,Math.min(100,w.humidity??60))
 // 湿球温度の近似（Stull 2011）
 const tw=t*Math.atan(.151977*Math.sqrt(rh+8.313659))+Math.atan(t+rh)-Math.atan(rh-1.676331)+.00391838*rh**1.5*Math.atan(.023101*rh)-4.686035
 const sky=SKY[w.condition]??.6,solar=sunAltitude>0?Math.sin(sunAltitude*Math.PI/180)*sky:0
 const globe=t+solar*12 // 黒球温度のおおよそ（日射が強いほど高い）
 return Math.round((.7*tw+.2*globe+.1*t)*10)/10
}
