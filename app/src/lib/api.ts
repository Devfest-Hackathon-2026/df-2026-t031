/** APK and static hosting have no development proxy. Configure only a public HTTPS endpoint. */
export function apiUrl(path:string){
 const base=(import.meta.env.VITE_API_BASE_URL||'').replace(/\/$/,'')
 if(base&&!base.startsWith('https://')&&!(import.meta.env.DEV&&/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(base)))throw Error('API接続先にはHTTPSのURLを設定してください。')
 if(!base&&location.protocol==='https:'&&location.hostname==='localhost')throw Error('このAPKの外部APIは未接続です。基本機能はオフラインで使えます。')
 return `${base}${path}`
}
