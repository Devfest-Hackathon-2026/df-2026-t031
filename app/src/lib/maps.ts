// Google Maps JavaScript API の読み込み（ブラウザー用キー。HTTPリファラーで制限して使う）。2026-11-10 作成
let loading:Promise<typeof google.maps>|null=null,loadedKey=''
export function loadGoogleMaps(key:string):Promise<typeof google.maps>{
 if(!/^[A-Za-z0-9_-]{20,60}$/.test(key))return Promise.reject(Error('Google Maps のキーの形式を確認してください。'))
 if(loading&&loadedKey===key)return loading
 loadedKey=key
 loading=new Promise((resolve,reject)=>{
  const w=window as unknown as {google?:{maps?:typeof google.maps};__restCareMaps?:()=>void}
  if(w.google?.maps?.Map){resolve(w.google.maps);return}
  w.__restCareMaps=()=>w.google?.maps?resolve(w.google.maps):reject(Error('Google Maps を読み込めませんでした。'))
  const s=document.createElement('script')
  s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=ja&region=JP&callback=__restCareMaps&loading=async`
  s.async=true;s.onerror=()=>{loading=null;reject(Error('Google Maps を読み込めませんでした。キーの制限（リファラー）と通信を確認してください。'))}
  document.head.appendChild(s)
  setTimeout(()=>reject(Error('Google Maps の読み込みがタイムアウトしました。')),20000)
 })
 return loading
}
/** ブラウザー用キー（ビルド時の VITE_GOOGLE_MAPS_API_KEY）。無ければ空文字 */
export const defaultMapsKey=()=>String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY||'').trim()
