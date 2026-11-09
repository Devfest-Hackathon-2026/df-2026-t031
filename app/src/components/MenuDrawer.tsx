import {useEffect,useRef} from 'react'
import {Armchair,Heart,Sun,LocateFixed,Plus,SlidersHorizontal,Info,X,HelpCircle} from 'lucide-react'

/**
 * ハンバーガーメニュー（右から出る引き出し）。地図の表示はラジオボタン、表示の切り替えはチェック、
 * 歩ける時間はプルダウンで選ぶ。Esc か背景のタップで閉じる。
 */
interface Props{open:boolean;onClose:()=>void;favorites:number;mode:'model3d'|'model2d'|string;onMode:(m:'model3d'|'model2d')=>void;showShadow:boolean;onShadow:(v:boolean)=>void;showPath:boolean;onPath:(v:boolean)=>void;maxWalk:number;onMaxWalk:(m:number)=>void;followTime:boolean;onFollowTime:(v:boolean)=>void;lightQuality?:boolean;onLightQuality?:(v:boolean)=>void
 onList:()=>void;onFavorites:()=>void;onSun:()=>void;onLocate:()=>void;onAdd:()=>void;onHelp:()=>void;onSettings:()=>void;onAbout:()=>void}
export const WALK_OPTIONS=[10,15,20,30]
export default function MenuDrawer(p:Props){
 const first=useRef<HTMLButtonElement>(null)
 useEffect(()=>{if(!p.open)return;first.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')p.onClose()};addEventListener('keydown',key);return()=>removeEventListener('keydown',key)},[p.open])
 const go=(fn:()=>void)=>()=>{fn();p.onClose()}
 return <div className={'drawer-root'+(p.open?' is-open':'')} aria-hidden={!p.open}>
  <div className="drawer-backdrop" onClick={p.onClose}/>
  <nav className="drawer glass-panel" aria-label="メニュー" inert={!p.open}>
   <div className="drawer-head"><strong>メニュー</strong><button ref={first} className="icon-button" aria-label="メニューを閉じる" onClick={p.onClose}><X size={20}/></button></div>
   <section><h3>見る</h3>
    <button className="drawer-item" onClick={go(p.onList)}><Armchair size={18}/>休憩スポットの一覧</button>
    <button className="drawer-item" onClick={go(p.onFavorites)}><Heart size={18}/>保存した場所<span className="drawer-count">{p.favorites}</span></button>
    <button className="drawer-item" onClick={go(p.onSun)}><Sun size={18}/>太陽と日の出・日の入り</button>
   </section>
   <section><h3>地図</h3>
    <fieldset className="drawer-radio"><legend className="sr-only">地図の表示</legend>
     <label><input type="radio" name="map-mode" checked={p.mode==='model3d'} onChange={()=>p.onMode('model3d')}/><span>3D（立体）</span></label>
     <label><input type="radio" name="map-mode" checked={p.mode==='model2d'} onChange={()=>p.onMode('model2d')}/><span>2D（平面）</span></label>
    </fieldset>
    <label className="drawer-check"><input type="checkbox" checked={p.showShadow} onChange={e=>p.onShadow(e.target.checked)}/><span>建物の影を表示</span></label>
    <label className="drawer-check"><input type="checkbox" checked={p.showPath} onChange={e=>p.onPath(e.target.checked)}/><span>太陽の通り道を表示</span></label>
    {p.onLightQuality?<label className="drawer-check"><input type="checkbox" checked={!!p.lightQuality} onChange={e=>p.onLightQuality!(e.target.checked)}/><span>軽量表示（スマホ向け）<small>影や細部を減らして、動きを軽くします</small></span></label>:null}
   </section>
   <section><h3>探し方</h3>
    <label className="drawer-select"><span>歩ける時間</span><select value={p.maxWalk} onChange={e=>p.onMaxWalk(Number(e.target.value))}>{WALK_OPTIONS.map(m=><option key={m} value={m}>{m}分まで</option>)}</select></label>
    <label className="drawer-check"><input type="checkbox" checked={p.followTime} onChange={e=>p.onFollowTime(e.target.checked)}/><span>時刻を動かしたら候補も選び直す<small>オフのときは影だけ動き、候補の場所は変わりません</small></span></label>
    <button className="drawer-item" onClick={go(p.onLocate)}><LocateFixed size={18}/>現在地から探す</button>
   </section>
   <section><h3>その他</h3>
    <button className="drawer-item" onClick={go(p.onAdd)}><Plus size={18}/>スポットを追加</button>
    <button className="drawer-item" onClick={go(p.onHelp)}><HelpCircle size={18}/>使い方</button>
    <button className="drawer-item" onClick={go(p.onSettings)}><SlidersHorizontal size={18}/>設定とデータ</button>
    <button className="drawer-item" onClick={go(p.onAbout)}><Info size={18}/>データと予測について</button>
   </section>
  </nav>
 </div>
}
