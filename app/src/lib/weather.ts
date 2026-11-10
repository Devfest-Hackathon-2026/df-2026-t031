import {apiUrl} from './api.ts'
export async function googleWeather():Promise<WeatherForecast>{const r=await fetch(apiUrl('/api/weather'),{signal:AbortSignal.timeout(20000)});if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Weather APIサーバーは未接続です。');const d=await r.json();if(!r.ok)throw Error(d.error||'天気の取得に失敗しました。');return d}
