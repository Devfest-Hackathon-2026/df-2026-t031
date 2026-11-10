// 画面の入口。2026-11-10 に書き直し
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import App from './App.tsx'
import './style.css'
import './immersive.css'
import './mobile.css'
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
// 本番だけ、オフライン用のサービスワーカー（scripts/generate-sw.mjs が作る sw.js）を登録する
if(import.meta.env.PROD&&'serviceWorker' in navigator&&location.protocol==='https:')addEventListener('load',()=>{navigator.serviceWorker.register('./sw.js').catch(()=>{})})
