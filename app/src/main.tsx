import React from 'react'
import {createRoot} from 'react-dom/client'
import App from './App.tsx'
import './style.css'
import './immersive.css'
import './mobile.css'
class ErrorBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return {failed:true}}render(){return this.state.failed?<main className="fatal"><h1>画面を開けませんでした</h1><p>保存データはこの端末に残っています。再読み込みしてお試しください。</p><button onClick={()=>location.reload()}>再読み込み</button></main>:this.props.children}}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App/></ErrorBoundary>)
if('serviceWorker' in navigator&&import.meta.env.PROD)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}))
