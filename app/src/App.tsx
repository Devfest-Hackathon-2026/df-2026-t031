// 2026-11-10 期間内に書き直し（読み込み・保存・投稿・設定まわりの組み立てを整理）。
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Accessibility, ArrowRight, ArrowUpRight, Armchair, Check, ChevronLeft, ChevronRight, ChevronRight as Next, Clock, Cloud,
  Download, Droplets, Ellipsis, Flag, Footprints, Heart, HeartPulse, House, Info, Layers, Leaf, LocateFixed, MapPin, Menu,
  Navigation, Pause, PencilLine, Play, Plus, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Sparkles, Sun, Trash2, Undo2, X,
} from 'lucide-react'
import { AREA_CENTER, AREA_NAME, AREA_RADIUS_M, DEMO_USER_LOCATION, EXPLORER_FOCUS, inBounds } from './domain/area.ts'
import { heightStats } from './domain/osm.ts'
import { formatDistance, haversineM, walkMinutes } from './domain/geo.ts'
import { dayTypeOf, formatAgo, formatDateJa, formatTime, jstDate, jstParts } from './domain/time.ts'
import { COVERAGE_LABEL, isShaded, OVERCAST, SHADE_LABEL, ShadeEngine, shadeWindows, weatherShade, type ShadeCoverage } from './domain/shade.ts'
import { estimateWbgt, WBGT_LABEL, wbgtLevel } from './domain/wbgt.ts'
import { FLAG_HIDE_COUNT, type SpotFlagReason } from './domain/types.ts'
import { buildWalkGraph, findWalkRoute, routeShade, shadeFirstCost, type RouteSegment, type WalkFeature, type WalkGraph } from './domain/route.ts'
import { arrivalReason, hitRate, preferShadeFor, rankArrival, shadeSpan, spreadPicks } from './domain/arrival.ts'
import { sunPosition, sunTimes } from './domain/sun.ts'
import {
  CONFIDENCE_LABEL, hoursSinceRain, isSeatSpot, locationFactor, nearestDistanceMap, pct, postsApply, predictSeat,
  SEAT_LEVEL_LABEL, seatLevel, seatNeighborMap, TOILET_NEAR_M, type SeatLevel,
} from './domain/seat.ts'
import type { AreaDataset, AreaEvent, LatLng, SeatPrediction, SeatReport, ShadeState, Spot, SunPosition, WeatherCondition, WeatherForecast, XY } from './domain/types.ts'
import { rankRestSpots, restReasons, STATUS_LABEL, walkLimit, type RestItem, type RestReason } from './domain/restRank.ts'
import { DEFAULT_NEED, FATIGUE_LABEL as NEED_FATIGUE, HOT_WBGT, SAFETY_GUIDANCE, shouldSuggestRest, WALKED_LABEL, WISH_LABEL, type RestNeed } from './domain/restNeed.ts'
import MapView, { KIND_LABEL, kindIcons, spotName, type MapMode } from './components/MapView.tsx'
import Modal from './components/Modal.tsx'
import { DataSection, DeleteDataModal, MapKeySection } from './components/SettingsSections.tsx'
import SolarPanel from './components/SolarPanel.tsx'
import EdgeScrubbers from './components/EdgeScrubbers.tsx'
import MenuDrawer from './components/MenuDrawer.tsx'
import { RestSheet, RestSettings, fetchGoogleStatus, type GoogleStatus } from './components/RestSheet.tsx'
import { RestBanner } from './components/RestBanner.tsx'
import { EMPTY, exportSaved, persist, readSaved, validateSaved, type SavedData } from './lib/storage.ts'
import { demoWeather, googleWeather, openMeteo, weatherAt, WEATHER_LABEL } from './lib/weather.ts'
import { enableSharedReports, type ReportConnection } from './lib/shared.ts'
import { apiUrl } from './lib/api.ts'
import { bannerState, loadRestPrefs, saveRestPrefs, snooze, type RestPrefs } from './lib/restPrefs.ts'
import { fetchLiveDataset, loadAreaDataset } from './lib/loadArea.ts'

/** 地点データを読み終えるまでの画面。読めたら Explorer に渡す */
export default function App() {
  const [dataset, setDataset] = useState<AreaDataset | null>(null)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    loadAreaDataset(controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) setDataset(loaded)
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setLoadError(error.message)
      })
    return () => controller.abort()
  }, [attempt])

  if (dataset) return <Explorer initialDataset={dataset} />

  const retry = () => {
    setLoadError('')
    setAttempt((n) => n + 1)
  }
  return (
    <main className="loading">
      <div className="brand">
        <Leaf />
        Rest Care<span>ひと休みを、もっと気軽に。</span>
      </div>
      {loadError ? (
        <>
          <p>{loadError}</p>
          <button onClick={retry}>もう一度読み込む</button>
        </>
      ) : (
        <p>まちの休憩スポットを読み込んでいます…</p>
      )}
    </main>
  )
}
/** 「イベントのデモ」を入れたときに置く、広場の催し（10:00〜18:00・半径 650m） */
const DEMO_EVENT: AreaEvent = {
  id: 'demo-event',
  name: '広場イベント（デモ）',
  position: { lat: 35.4558, lng: 139.6363 },
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  dates: [],
  startMin: 10 * 60,
  endMin: 18 * 60,
  radiusM: 650,
  intensity: 1,
  isDemo: true,
}

type Result={spot:Spot;distance:number;shade:ShadeState;coverage:ShadeCoverage;prediction:SeatPrediction|null}
const segmentLength=(s:RouteSegment)=>s.points.reduce((sum,p,i)=>i?sum+haversineM(s.points[i-1],p):0,0)
/** 地図・候補・詳細・設定をまとめた画面本体 */
function Explorer({ initialDataset }: { initialDataset: AreaDataset }) {
  // 端末に保存した内容（読めなかったときは error に理由が入る）
  const initial = useMemo(() => readSaved(), [])
 const [dataset,setDataset]=useState(initialDataset),[saved,setSaved]=useState(initial.data),[notice,setNotice]=useState(initial.error||''),[modal,setModal]=useState<'settings'|'about'|'add'|'delete'|'help'|'rest'|null>(null)
 const [query,setQuery]=useState(''),[category,setCategory]=useState('rest'),[shadedOnly,setShadedOnly]=useState(false),[roofOnly,setRoofOnly]=useState(false),[favoriteOnly,setFavoriteOnly]=useState(false),[range,setRange]=useState(2000),[sort,setSort]=useState('recommended'),[seatableOnly,setSeatableOnly]=useState(false),[toiletNear,setToiletNear]=useState(false)
  // 表示する日時・天気。最初は今日の 15:30、気温 24℃ の晴れ（予報が取れたら予報を優先）
  const [day, setDay] = useState(() => jstParts(new Date()).dateKey)
  const [minutes, setMinutes] = useState(15 * 60 + 30)
  const [temp, setTemp] = useState(24)
  const [condition, setCondition] = useState<WeatherCondition>('clear')
  const [forecast, setForecast] = useState<WeatherForecast | null>(null)
  const [eventDemo, setEventDemo] = useState(false)
  // 地図と出発地点
  const [origin, setOrigin] = useState<LatLng>(DEMO_USER_LOCATION)
  const [mode, setMode] = useState<MapMode>('model3d')
  const [mapKey, setMapKey] = useState<string>(import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '')
  const [showShadow, setShowShadow] = useState(true)
  const [adding, setAdding] = useState(false)
  const [addPoint, setAddPoint] = useState<LatLng>(DEMO_USER_LOCATION)
 const [selected,setSelected]=useState(()=>initialDataset.spots.filter(isSeatSpot).sort((a,b)=>haversineM(a.position,EXPLORER_FOCUS)-haversineM(b.position,EXPLORER_FOCUS))[0]?.id||''),[busy,setBusy]=useState(''),[explanation,setExplanation]=useState<{spotId:string;text:string;key:string}|null>(null),[now,setNow]=useState(new Date()),[shared,setShared]=useState<SeatReport[]>([]),[sharing,setSharing]=useState(false),[limit,setLimit]=useState(12)
 const [panel,setPanel]=useState<'sun'|'spots'>('sun'),[solarOpen,setSolarOpen]=useState(()=>innerWidth>760),[showPath,setShowPath]=useState(true),[playing,setPlaying]=useState(false),[placeMenu,setPlaceMenu]=useState(false),[addKind,setAddKind]=useState('bench')
 const [routeTo,setRouteTo]=useState<string|null>(null),[shadeFirst,setShadeFirst]=useState(true),[pickIndex,setPickIndex]=useState(0),[mainMenu,setMainMenu]=useState(false),[maxWalk,setMaxWalk]=useState(20),[spotView,setSpotView]=useState<'list'|'detail'>('detail'),[restNeed,setRestNeed]=useState<RestNeed>(()=>({...DEFAULT_NEED,wishes:loadRestPrefs().lastWishes})),[followTime,setFollowTime]=useState(false),[showLabels,setShowLabels]=useState(true),[nudgeHidden,setNudgeHidden]=useState(''),[showSun,setShowSun]=useState(false),[walkGraph,setWalkGraph]=useState<WalkGraph|null>(null)
 const [quality,setQuality]=useState<'balanced'|'light'>(()=>innerWidth<=760?'light':'balanced')
  const share = useRef<ReportConnection | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  // 「いま」を 30 秒ごとに進める。画面を閉じるときは共有の接続も切る
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30_000)
    return () => {
      clearInterval(tick)
      share.current?.close()
    }
  }, [])
  // 再生中は 0.6 秒ごとに 10 分進め、19:00 を過ぎたら 5:00 に戻す
  useEffect(() => {
    if (!playing) return
    const step = setInterval(() => setMinutes((m) => (m >= 19 * 60 ? 5 * 60 : m + 10)), 600)
    return () => clearInterval(step)
  }, [playing])
 // 初めて開いたときだけ「使い方」を出す（保存できない環境では毎回は出さない）
 useEffect(()=>{try{if(!localStorage.getItem('epoku:help-seen'))setModal('help')}catch{}},[])
 const closeHelp=()=>{try{localStorage.setItem('epoku:help-seen','1')}catch{}setModal(null)}
  const notify = useCallback((message: string) => setNotice(message), [])
  /** 端末に保存して画面にも反映する。保存できなければ理由を出して false */
  const commit = useCallback(
    (next: SavedData) => {
      try {
        persist(next)
      } catch (error) {
        notify((error as Error).message)
        return false
      }
      setSaved(next)
      return true
    },
    [notify],
  )
  const time = useMemo(() => jstDate(day, minutes), [day, minutes])
  const sun = useMemo(() => sunPosition(time, AREA_CENTER), [time])
  const engine = useMemo(() => new ShadeEngine(dataset.buildings, dataset.trees, AREA_CENTER), [dataset])
  // 予報にその時刻があれば予報、なければ手で選んだ気温・天気のデモ
  const forecastHour = weatherAt(forecast, time)
  const weatherIsDemo = !forecastHour
  const weather = forecastHour ?? demoWeather(day, minutes, temp, condition)
  const events = useMemo<AreaEvent[]>(() => (eventDemo ? [DEMO_EVENT] : []), [eventDemo])
 const wbgt=estimateWbgt(weather,sun.altitude)
 // 休憩の提案（RC-5）：歩き続けた時間はアプリを開いた時か最後に休憩した時から数える
 const [restPrefs,setRestPrefsState]=useState<RestPrefs>(loadRestPrefs),[walkStart,setWalkStart]=useState(()=>Date.now()),[walkDemo,setWalkDemo]=useState(0),[google,setGoogle]=useState<GoogleStatus|null>(null)
 const setRestPrefs=useCallback((p:RestPrefs)=>{setRestPrefsState(p);saveRestPrefs(p)},[])
 const refreshGoogle=useCallback(()=>{void fetchGoogleStatus().then(setGoogle)},[])
 useEffect(()=>{refreshGoogle();const q=new URLSearchParams(location.search),h=q.get('health');if(!h)return;const msg:Record<string,string>={connected:'Googleに接続しました。休憩シートで Google Health の値を使えます。',denied:'Googleへの接続を取りやめました。手入力で使えます。',error:'Googleに接続できませんでした。手入力で使えます。','state-error':'接続の確認に失敗しました。もう一度お試しください。'};notify(msg[h]||msg.error);if(h==='connected')setModal('rest');q.delete('health');history.replaceState(null,'',location.pathname+(q.size?'?'+q:'')+location.hash)},[refreshGoogle,notify])
 const walkingMinutes=Math.max(0,Math.floor((now.getTime()-walkStart)/60000))+walkDemo
 const showRestBanner=modal===null&&shouldSuggestRest(walkingMinutes,wbgt,bannerState(restPrefs),now.getTime())
 // おすすめカードを横にスワイプすると画面の端にしまう（動画アプリの小窓のように）。端に残る矢印で戻す
 const [tucked,setTucked]=useState<null|'left'|'right'>(null),cardRef=useRef<HTMLElement>(null),swipe=useRef<{x:number;y:number;dx:number;id:number;on:boolean}|null>(null)
 const cardDown=(e:ReactPointerEvent<HTMLElement>)=>{const t=e.target as Element;if(t.closest('.best-track,input,select,textarea'))return;swipe.current={x:e.clientX,y:e.clientY,dx:0,id:e.pointerId,on:false}}
 const cardMove=(e:ReactPointerEvent<HTMLElement>)=>{const g=swipe.current,el=cardRef.current;if(!g||!el||g.id!==e.pointerId)return;const dx=e.clientX-g.x,dy=e.clientY-g.y;if(!g.on){if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){swipe.current=null;return}if(Math.abs(dx)<10)return;g.on=true;el.setPointerCapture(e.pointerId);el.classList.add('dragging')}g.dx=dx;el.style.transform=`translateX(${dx}px)`;el.style.opacity=String(Math.max(.35,1-Math.abs(dx)/400))}
 const cardUp=(e:ReactPointerEvent<HTMLElement>)=>{const g=swipe.current,el=cardRef.current;swipe.current=null;if(!g||!el||!g.on)return;el.classList.remove('dragging');el.style.transform='';el.style.opacity='';if(Math.abs(g.dx)>Math.min(90,el.offsetWidth*.25))setTucked(g.dx<0?'left':'right');e.preventDefault()}
 const cardClickGuard=(e:ReactMouseEvent)=>{if(cardRef.current?.classList.contains('dragging'))e.stopPropagation()}
 // 「休憩する」シートの入力（RC-1）で候補を選び直す（RC-3）。絞り込みや一覧ではなく、地図の上のカードに上位 3 件を出す
 const showRestSpots=(need:RestNeed)=>{setRestNeed(need);setModal(null);setPanel('sun');setRouteTo(null);setWalkStart(Date.now());setWalkDemo(0);notify(`いまの状態に合わせて、徒歩${walkLimit(need)}分以内を優先して候補を選びました。`)}
 const flagCount=useMemo(()=>{const m=new Map<string,number>();for(const f of saved.flags)m.set(f.spotId,(m.get(f.spotId)??0)+1);return m},[saved.flags])
  // 同梱（またはライブ取得）の地点に、この端末で登録した地点を足す
  const spots = useMemo(() => dataset.spots.concat(saved.spots), [dataset, saved.spots])
  const locations = useMemo(() => {
    const factors = new Map<string, ReturnType<typeof locationFactor>>()
    for (const spot of spots) factors.set(spot.id, locationFactor(spot, dataset.attractors))
    return factors
  }, [spots, dataset])
 const toiletDistance=useMemo(()=>nearestDistanceMap(spots,spots.filter(s=>s.kind==='toilet')),[spots])
  // 端末の投稿を優先し、共有から届いた投稿は同じ id がないものだけ足す
  const reports = useMemo(() => {
    const localIds = new Set(saved.reports.map((r) => r.id))
    return saved.reports.concat(shared.filter((r) => !localIds.has(r.id)))
  }, [saved.reports, shared])
 const neighbors=useMemo(()=>seatNeighborMap(spots),[spots])
 // 任意の時刻の空席予測（推移グラフと、投稿時の入力の記録に使う）
 const seatAt=useCallback((spot:Spot,t:Date)=>{const s=sunPosition(t,AREA_CENTER),p=jstParts(t),fw=weatherAt(forecast,t),w=fw??demoWeather(p.dateKey,p.minutesOfDay,temp,condition),shade=engine.coverageAtXY(engine.proj.toXY(spot.position),s,spot.roof==='yes').state,wb=estimateWbgt(w,s.altitude);return {shade,weather:w,wbgt:wb,prediction:predictSeat({spot,time:t,now,dayType:dayTypeOf(t),weather:w,wbgt:wb,shade,events,location:locations.get(spot.id)!,reports,neighbors:neighbors.get(spot.id),hoursSinceRain:forecast?hoursSinceRain(forecast.hours,t):null,weatherIsDemo:!fw})}},[forecast,temp,condition,engine,now,events,locations,reports,neighbors])
 const rainSince=forecast?hoursSinceRain(forecast.hours,time):null
 const results=useMemo(()=>spots.map(spot=>{const raw=engine.coverageAtXY(engine.proj.toXY(spot.position),sun,spot.roof==='yes'),shade=weatherShade(raw.state,weather.condition),coverage=shade==='cloud'?{level:'night' as const,ratio:1,state:shade}:raw;return {spot,shade,coverage,distance:haversineM(origin,spot.position),prediction:isSeatSpot(spot)?predictSeat({spot,time,now,dayType:dayTypeOf(time),weather,wbgt,shade,events,location:locations.get(spot.id)!,reports,neighbors:neighbors.get(spot.id),hoursSinceRain:rainSince,weatherIsDemo}):null}}),[spots,engine,sun,time,now,weather.temperatureC,weather.condition,weather.precipitationProbability,wbgt,events,locations,reports,origin,neighbors,rainSince,weatherIsDemo])
 const filtered=useMemo(()=>results.filter(r=>(category==='all'||category==='rest'&&isSeatSpot(r.spot)||category===r.spot.kind)&&(!query||(spotName(r.spot)+' '+r.spot.description+' '+KIND_LABEL[r.spot.kind]).toLowerCase().includes(query.trim().toLowerCase()))&&(!shadedOnly||isShaded(r.shade))&&(!roofOnly||r.spot.roof==='yes')&&(!favoriteOnly||saved.favorites.includes(r.spot.id))&&(!seatableOnly||!!r.prediction&&seatLevel(r.prediction.combined)==='high')&&(!toiletNear||(toiletDistance.get(r.spot.id)??Infinity)<=TOILET_NEAR_M)&&r.distance<=range&&(flagCount.get(r.spot.id)??0)<FLAG_HIDE_COUNT).sort((a,b)=>sort==='distance'?a.distance-b.distance:sort==='seats'?(b.prediction?.combined??0)-(a.prediction?.combined??0):(b.prediction?.combined??.5)-(a.prediction?.combined??.5)+(a.distance-b.distance)/6000),[results,category,query,shadedOnly,roofOnly,favoriteOnly,saved.favorites,range,sort,flagCount,seatableOnly,toiletNear,toiletDistance])
  // 詳細に出す地点。選んだ地点が絞り込みで消えたら先頭を出す
  const active = filtered.find((r) => r.spot.id === selected) ?? filtered[0] ?? null
 const explanationKey=`${active?.spot.id}:${day}:${minutes}:${weather.temperatureC}:${weather.condition}:${active?.prediction?.ai}`
  // 選んだ地点の 6:00〜19:00、15 分刻みの日陰の推移
  const timeline = useMemo(
    () => (active ? engine.timeline(active.spot.id, active.spot.position, active.spot.roof === 'yes', day, 6 * 60, 19 * 60, 15) : null),
    [active?.spot.id, active?.spot.roof, engine, day],
  )
 // 空席の推移（9〜21時・30分ごと）。今日なら、これからの時間で一番座りやすい時刻を示す
 const trend=useMemo(()=>active&&isSeatSpot(active.spot)?Array.from({length:25},(_,i)=>{const m=540+i*30;return {m,p:seatAt(active.spot,jstDate(day,m)).prediction.ai}}):null,[active?.spot.id,seatAt,day])
 const nowParts=jstParts(now),isToday=day===nowParts.dateKey,bestSlot=trend?trend.filter(x=>!isToday||x.m>=nowParts.minutesOfDay-15).reduce<{m:number;p:number}|null>((b,x)=>!b||x.p>b.p+.005?x:b,null):null
  const windows = useMemo(() => (timeline ? shadeWindows(timeline) : []), [timeline])
  const times = useMemo(() => sunTimes(day, AREA_CENTER), [day])
  const stats = useMemo(() => heightStats(dataset.buildings), [dataset])
 // 着いたとき日陰で座れるベンチ: 出発時刻＋徒歩の分数で着く時刻を出し、その時刻の日陰と空席で並べる
 const sunAtMin=useMemo(()=>{const cache=new Map<number,SunPosition>();return (m:number)=>{const k=Math.max(0,Math.min(1439,Math.round(m)));let s=cache.get(k);if(!s){s=sunPosition(jstDate(day,k),AREA_CENTER);cache.set(k,s)}return s}},[day])
 const preferShade=preferShadeFor(weather.temperatureC)
 // 着く時刻の日陰と空席の計算（いまの時刻で）。候補選びと、固定した候補の情報更新の両方で使う
 const arrivalOpts=useMemo(()=>({departMin:minutes,preferShade,shadeAt:(s:Spot,m:number)=>weatherShade(engine.stateAtXY(engine.proj.toXY(s.position),sunAtMin(m),s.roof==='yes'),(weatherAt(forecast,jstDate(day,m))??weather).condition),seatAt:(s:Spot,m:number,shade:ShadeState)=>{const at=jstDate(day,m);return predictSeat({spot:s,time:at,now,dayType:dayTypeOf(at),weather,wbgt,shade,events,location:locations.get(s.id)!,reports,neighbors:neighbors.get(s.id),hoursSinceRain:forecast?hoursSinceRain(forecast.hours,at):null,weatherIsDemo}).combined}}),[neighbors,forecast,weatherIsDemo,minutes,preferShade,engine,sunAtMin,day,now,weather.temperatureC,weather.condition,weather.precipitationProbability,wbgt,events,locations,reports])
 const rankedPicks=useMemo(()=>rankArrival(filtered.filter(r=>isSeatSpot(r.spot)).map(r=>({spot:r.spot,distanceM:r.distance})),{...arrivalOpts,maxWalkMin:maxWalk}).slice(0,80).filter((p,i,all)=>i===all.findIndex(q=>q.spot.id===p.spot.id)),[maxWalk,filtered,arrivalOpts])
 // いまの状態の希望（日陰・屋根・背もたれ・トイレ近く・段差なし）に合う数だけ順位を上げる
 // 休憩候補の順位付け（RC-3）: 着く時刻の日陰・空席に、いまの状態・希望・トイレや給水の距離・投稿を加えて並べる
 const waterDistance=useMemo(()=>nearestDistanceMap(spots,spots.filter(s=>s.kind==='water')),[spots])
 const restItemOf=useCallback((p:{spot:Spot;walkMin:number;arriveMin:number;shade:ShadeState;seat:number}):RestItem=>({spot:p.spot,walkMin:p.walkMin,arriveMin:p.arriveMin,shade:p.shade,seat:p.seat,toiletM:toiletDistance.get(p.spot.id)??Infinity,waterM:waterDistance.get(p.spot.id)??Infinity,reports:reports.filter(r=>r.spotId===p.spot.id).map(r=>({value:r.value,minutesAgo:Math.max(0,Math.round((now.getTime()-Date.parse(r.reportedAt))/60000))}))}),[toiletDistance,waterDistance,reports,now])
 const restRanked=useMemo(()=>rankRestSpots(rankedPicks.map(restItemOf),restNeed,{wbgt,cold:!preferShade}),[rankedPicks,restItemOf,restNeed,wbgt,preferShade])
 const livePicks=useMemo(()=>spreadPicks(restRanked.flatMap(r=>rankedPicks.filter(p=>p.spot.id===r.item.spot.id)),80,3),[restRanked,rankedPicks])
 const reasonsOf=(p:{spot:Spot;walkMin:number;arriveMin:number;shade:ShadeState;seat:number}):RestReason[]=>restReasons(restItemOf(p),restNeed)
 // 候補の固定: ふだんは時刻を動かしても候補の場所と順番は変えず、着く時刻・日陰・空席の表示だけ更新する。
 // 「この時刻で選び直す」、いまの状態・歩ける時間・出発地の変更、または追従モードのときだけ選び直す
 const [frozen,setFrozen]=useState<{ids:string[];day:string;minutes:number}|null>(null)
 const refreeze=()=>setFrozen({ids:livePicks.map(p=>p.spot.id),day,minutes})
 useEffect(()=>setFrozen(null),[restNeed,maxWalk,origin,followTime,weather.condition])
 useEffect(()=>{if(!frozen&&livePicks.length)setFrozen({ids:livePicks.map(p=>p.spot.id),day,minutes})},[frozen,livePicks])
 const frozenPicks=useMemo(()=>{if(!frozen)return livePicks;const items=frozen.ids.flatMap(id=>{const r=filtered.find(x=>x.spot.id===id);return r?[{spot:r.spot,distanceM:r.distance}]:[]});if(!items.length)return livePicks;const ranked=rankArrival(items,{...arrivalOpts,maxWalkMin:999});return items.flatMap(it=>ranked.filter(p=>p.spot.id===it.spot.id))},[frozen,filtered,arrivalOpts,livePicks])
 const picks=followTime?livePicks:frozenPicks
 const staleFrozen=!followTime&&!!frozen&&(frozen.day!==day||Math.abs(frozen.minutes-minutes)>=10)
 const picksKey=picks.map(p=>p.spot.id).join(',')
 useEffect(()=>setPickIndex(0),[picksKey])
 const pick=picks.length?picks[pickIndex%picks.length]:null
 useEffect(()=>{if(pick&&panel==='sun')setSelected(pick.spot.id)},[pick?.spot.id])
 // 地図の吹き出し: 1位は「!」、2〜5位はベンチと順位。押すと下のカードがその候補に変わる
 const bubbles=useMemo(()=>picks.map((p,i)=>({id:p.spot.id,position:p.spot.position,kind:i===0?'pick' as const:'cand' as const,rank:i+1,level:seatLevel(p.seat),active:picks.length>0&&i===pickIndex%picks.length,label:p.spot.name||KIND_LABEL[p.spot.kind]})),[picks,pickIndex])
 const onBubble=useCallback((id:string)=>{const i=picks.findIndex(p=>p.spot.id===id);if(i>=0){setPickIndex(i);setPanel('sun');setRouteTo(r=>r===id?r:null)}},[picks])
 // 名前のないベンチは、近く（500m以内）の名前のある施設を添えて「ベンチ（臨港パーク付近）」と表示する
 const placeLabel=useCallback((spot:Spot)=>{if(spot.name)return spot.name;let best:{name:string;d:number}|null=null;for(const a of dataset.attractors){if(!a.name)continue;const d=haversineM(a.position,spot.position);if(d<500&&(!best||d<best.d))best={name:a.name,d}}return best?`${KIND_LABEL[spot.kind]}（${best.name}付近）`:KIND_LABEL[spot.kind]},[dataset.attractors])
 const pickSpans=useMemo(()=>picks.map(p=>shadeSpan(engine.timeline(p.spot.id,p.spot.position,p.spot.roof==='yes',day,360,1140,15),p.arriveMin)),[picks,engine,day])
 const pickIdx=picks.length?pickIndex%picks.length:0
 // カルーセル: 横スワイプで止まった位置の候補を選ぶ。吹き出しのタップなどで選んだときはその位置までスクロールする
 const trackRef=useRef<HTMLDivElement>(null),scrollTimer=useRef(0)
 const goPick=(i:number)=>{if(!picks[i])return;setPickIndex(i);setRouteTo(r=>r===picks[i].spot.id?r:null)}
 // 1枚の幅（隣のカードが少し見える）＋すき間 10px を1ステップとして位置を計算する
 const slideStep=(t:HTMLDivElement)=>{const first=t.children[0] as HTMLElement|undefined;return first?first.offsetWidth+10:t.clientWidth}
 const onTrackScroll=()=>{clearTimeout(scrollTimer.current);scrollTimer.current=window.setTimeout(()=>{const t=trackRef.current;if(!t||!t.clientWidth)return;const i=Math.round(t.scrollLeft/slideStep(t));if(i!==pickIdx)goPick(i)},120)}
 useEffect(()=>{const t=trackRef.current;if(!t)return;const want=pickIdx*slideStep(t);if(Math.abs(t.scrollLeft-want)>4)t.scrollTo({left:want,behavior:'smooth'})},[pickIdx,picksKey])
 // アプリ内の徒歩ルート: 初めて使うときに道路データを読み、指定時刻の日陰で色分けする
 useEffect(()=>{if(!routeTo||walkGraph)return;const controller=new AbortController();fetch(`${import.meta.env.BASE_URL}data/area-context.json`,{signal:controller.signal}).then(r=>{if(!r.ok)throw Error('道路データを読めませんでした。直線で表示します。');return r.json()}).then((context:{features:WalkFeature[]})=>setWalkGraph(buildWalkGraph(context.features,engine.proj))).catch(e=>{if(e.name!=='AbortError'){notify(e.message);setWalkGraph(buildWalkGraph([],engine.proj))}});return()=>controller.abort()},[routeTo,walkGraph,engine,notify])
 const routeSpot=routeTo?spots.find(s=>s.id===routeTo)??null:null,stateAt=useCallback((p:XY)=>weatherShade(engine.stateAtXY(p,sun),weather.condition),[engine,sun,weather.condition])
 // 日陰優先の経路探索は重い（約0.2秒）ので、時刻を動かし終えて少したってから計算し直す。再生中は経路を固定して色だけ更新する
 const [routeStateAt,setRouteStateAt]=useState(()=>stateAt)
 useEffect(()=>{if(!shadeFirst||playing)return;const timer=setTimeout(()=>setRouteStateAt(()=>stateAt),250);return()=>clearTimeout(timer)},[stateAt,shadeFirst,playing])
 const route=useMemo(()=>walkGraph&&routeSpot?findWalkRoute(walkGraph,origin,routeSpot.position,shadeFirst?shadeFirstCost(walkGraph,routeStateAt):undefined):null,[walkGraph,routeSpot,origin,shadeFirst,shadeFirst?routeStateAt:null])
 // ルートの日陰は、歩いてその地点を通る時刻（出発時刻＋距離÷80m/分）の太陽で判定する
 const stateAlong=useCallback((p:XY,along:number)=>weatherShade(engine.stateAtXY(p,sunAtMin(minutes+along/80)),weather.condition),[engine,sunAtMin,minutes,weather.condition])
 const routeShading=useMemo(()=>route&&walkGraph?routeShade(route.points,stateAlong,walkGraph.proj):null,[route,stateAlong,walkGraph])
 const shortest=useMemo(()=>shadeFirst&&walkGraph&&routeSpot?findWalkRoute(walkGraph,origin,routeSpot.position):null,[shadeFirst,walkGraph,routeSpot,origin])
 const shortestSunMin=useMemo(()=>shortest&&walkGraph?Math.round(routeShade(shortest.points,stateAlong,walkGraph.proj).sunM/80):null,[shortest,stateAlong,walkGraph])
 const sunMin=routeShading?Math.round(routeShading.sunM/80):null
 const startRoute=(id:string)=>{setRouteTo(id);if(innerWidth<=760)setPanel('sun')}
 const shadeText=routeShading?routeShading.shadedRatio===null?'日没後のため日陰は計算しません':`日なたを歩く ${sunMin}分${shortestSunMin!==null&&shortestSunMin>sunMin!?`（最短ルートなら ${shortestSunMin}分）`:''}`:''
 const choose=useCallback((id:string)=>{setSelected(id);setExplanation(null);setPanel('spots');setSpotView('detail')},[])
  const mapSpots = useMemo(() => filtered.map((r) => r.spot), [filtered])
 // ピンの色分け（緑＝座れそう・黄＝五分五分・赤＝混みそう）。投稿を含めた値 combined で判定する
 const levels=useMemo(()=>new Map<string,SeatLevel>(filtered.flatMap(r=>r.prediction?[[r.spot.id,seatLevel(r.prediction.combined)] as [string,SeatLevel]]:[])),[filtered])
 // Androidの戻るボタン（epoku-back）とEscape: モーダル→メニュー→ルート→一覧・詳細→太陽パネルの順に閉じる
 useEffect(()=>{const back=()=>{if(modal){setModal(null);setAdding(false)}else if(mainMenu){setMainMenu(false)}else if(routeTo){setRouteTo(null)}else if(panel==='spots'){setPanel('sun')}else if(solarOpen){setSolarOpen(false);setShowSun(false)}else{setPanel('sun');setSolarOpen(false)}};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]'))back()};window.addEventListener('keydown',key);window.addEventListener('epoku-back',back);return()=>{window.removeEventListener('keydown',key);window.removeEventListener('epoku-back',back)}},[modal,mainMenu,routeTo,panel,solarOpen])
 useEffect(()=>setLimit(12),[query,category,shadedOnly,roofOnly,favoriteOnly,range,sort,seatableOnly,toiletNear])
  /** 時間のかかる処理を 1 つずつ走らせ、失敗したら理由を通知に出す */
  const run = async (label: string, task: () => Promise<void>) => {
    if (busy) return
    setBusy(label)
    try {
      await task()
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setBusy('')
    }
  }
  const saveFavorite = (id: string) => {
    const isFavorite = saved.favorites.includes(id)
    const favorites = isFavorite ? saved.favorites.filter((f) => f !== id) : saved.favorites.concat(id)
    if (!commit({ ...saved, favorites })) return
    notify(isFavorite ? '保存した場所から外しました。' : 'この端末の「保存した場所」に追加しました。')
  }

 // 現地での答え合わせ: いまの実際の様子と、いまの時刻のモデルの判定を並べて記録する
 const rate=hitRate(saved.checks)
 const check=(observed:'shade'|'sun')=>{if(!active)return;const state=engine.stateAtXY(engine.proj.toXY(active.spot.position),sunPosition(new Date(),AREA_CENTER),active.spot.roof==='yes');if(state==='night'){notify('日没後は日陰の答え合わせができません。');return}const predicted=isShaded(state)?'shade':'sun'
  if(commit({...saved,checks:[...saved.checks,{id:crypto.randomUUID(),spotId:active.spot.id,observed,predicted,checkedAt:new Date().toISOString()}]}))notify(observed===predicted?'予測と一致しました。答え合わせを記録しました。':'予測と違いました。答え合わせを記録しました（予測の見直しに使います）。')}
  /** 空席の投稿。同じ地点への 1 分以内の投稿は新しいもので置き換える */
  const post = (value: SeatReport['value']) => {
    if (!active) return
  const at=new Date(),snap=isSeatSpot(active.spot)?seatAt(active.spot,at):null
  // 投稿した時点のルール推定と入力を残す（端末内のみ。共有データベースには送らない）
  const report:SeatReport={id:crypto.randomUUID(),spotId:active.spot.id,value,reportedAt:at.toISOString(),origin:'local',...(snap?{features:{hour:jstParts(at).hour,dayType:dayTypeOf(at),temperatureC:snap.weather.temperatureC,wbgt:snap.wbgt,condition:snap.weather.condition,shade:snap.shade,roof:active.spot.roof==='yes',aiProbability:snap.prediction.rule}}:{})}
    const recentSame = (r: SeatReport) => r.spotId === report.spotId && Date.now() - Date.parse(r.reportedAt) < 60_000
    if (!commit({ ...saved, reports: saved.reports.filter((r) => !recentSame(r)).concat(report) })) return
  setNow(new Date());if(value==='facility'){notify('「設備が使えなかった」を記録しました。24時間はこの場所の順位を下げます（この端末のみ）。');return}
  notify('この端末に投稿しました。投稿は現在時刻の情報として記録されます。')
    const connection = share.current
    if (connection) {
      run('投稿の共有', async () => {
        await connection.post(report)
        notify('投稿を共有しました。')
      })
    }
 }
  /** 端末の現在地を出発地点にする。エリアの外なら基準地点のまま */
  const locate = () => {
    if (!navigator.geolocation) {
      notify('このブラウザーでは現在地を取得できません。')
      return
    }
    const onPosition = ({ coords }: GeolocationPosition) => {
      const here = { lat: coords.latitude, lng: coords.longitude }
      if (haversineM(here, AREA_CENTER) > AREA_RADIUS_M) {
        notify('現在地は対象エリア外です。桜木町の基準地点を表示しています。')
        return
      }
      setOrigin(here)
      notify('端末の現在地を検索の基準にしました。')
    }
    const onError = () => notify('現在地を取得できませんでした。位置情報の許可をご確認ください。')
    navigator.geolocation.getCurrentPosition(onPosition, onError, { timeout: 10_000, maximumAge: 60_000 })
  }
 const summerDay=`${jstParts(now).dateKey.slice(0,4)}-08-14`,isSummer=day===summerDay
 const toggleSummer=()=>{setPlaying(false);setRouteTo(null);if(isSummer){setToNow();setTemp(24)}else{setDay(summerDay);setMinutes(840);setTemp(33);setCondition('clear')}}
  const setToNow = () => {
    const current = new Date()
    const { dateKey, minutesOfDay } = jstParts(current)
    setDay(dateKey)
    setMinutes(minutesOfDay)
    setNow(current)
  }
  /** JSON のバックアップを読み込んで端末の保存内容を置き換える（5MB まで） */
  const importBackup = async (file: File) => {
    try {
      if (file.size > 5_000_000) throw new Error('5MB以下のバックアップを選んでください。')
      const restored = validateSaved(JSON.parse(await file.text()))
      if (!commit(restored)) return
      notify('バックアップを復元しました。')
      setSelected('')
    } catch (error) {
      notify((error as Error).message)
    }
  }
 const addSpot=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=new FormData(e.currentTarget);const position={lat:Number(form.get('lat')),lng:Number(form.get('lng'))};if(!inBounds(position)){notify('対象エリア（横浜・みなとみらい）内の地点を選んでください。');return}const seatText=String(form.get('seats')??'');const spot:Spot={id:'user:'+crypto.randomUUID(),name:String(form.get('name')).trim(),kind:form.get('kind') as Spot['kind'],position,origin:'user',seats:seatText?Number(seatText):null,roof:form.get('roof')==='on'?'yes':'unknown',roofSource:'user',backrest:'unknown',wheelchair:'unknown',cooling:form.get('cooling')==='on'?'yes':'unknown',stepFree:form.get('stepFree')==='on'?'yes':'unknown',infoSource:'user'};if(commit({...saved,spots:[...saved.spots,spot]})){setPanel('spots');setSelected(spot.id);setCategory('all');setModal(null);setAdding(false);notify('スポットをこの端末に追加しました。')}}
  // Overpass から対象エリアの最新データを取り直す（失敗したら今のデータのまま）
  const fetchLive = () =>
    run('OSMデータの取得', async () => {
      const live = await fetchLiveDataset()
      setDataset(live)
      notify(`${live.spots.length}地点のOSMデータを取得しました。`)
    })
  // 選んだ地点への、この端末からのいちばん新しい投稿
  const reportForActive = useMemo(() => {
    let latest: SeatReport | undefined
    for (const r of saved.reports) {
      if (r.spotId !== active?.spot.id) continue
      if (!latest || Date.parse(r.reportedAt) > Date.parse(latest.reportedAt)) latest = r
    }
    return latest
  }, [saved.reports, active?.spot.id])
  /** 自分で登録した地点を、保存・投稿ごと消す */
  const deleteOwnSpot = (id: string) => {
    const next = {
      ...saved,
      spots: saved.spots.filter((s) => s.id !== id),
      favorites: saved.favorites.filter((f) => f !== id),
      reports: saved.reports.filter((r) => r.spotId !== id),
    }
    if (commit(next)) notify('自分で登録したスポットを削除しました。')
  }
  /** Firebase 共有の開始・停止。止めても端末内の投稿は残す */
  const toggleSharing = () => {
    if (!sharing) {
      run('Firebaseへの接続', async () => {
        share.current = await enableSharedReports(setShared, notify)
        setSharing(true)
        notify('新しく行う投稿を共有します。過去の投稿は自動送信しません。')
      })
      return
    }
    share.current?.close()
    share.current = null
    setSharing(false)
    setShared([])
    notify('共有を停止しました。端末内の投稿は残っています。')
  }
 return <div data-back-active={!!modal||mainMenu||!!routeTo||panel==='spots'||solarOpen} className={`immersive-app simple quality-${quality} panel-${panel} ${solarOpen?'solar-expanded':'solar-collapsed'}${showSun?' show-sun':''}${routeTo?' has-route':''}`}>
  <header className="site-header"><a className="brand" href="./" aria-label="Rest Care ホーム"><span className="brand-mark"><Leaf size={23}/></span><span>Rest Care<span className="brand-dot">.</span></span></a><div className="header-place"><MapPin size={14}/><span>横浜・みなとみらい</span></div><nav className="view-nav" aria-label="表示するパネル"><button aria-pressed={panel==='sun'} onClick={()=>setPanel('sun')}><Sun size={15}/>探索</button><button aria-pressed={panel==='spots'} onClick={()=>setPanel('spots')}><Armchair size={15}/>休憩スポット</button></nav><div className="header-actions"><button className="icon-button menu-button" aria-label="メニューを開く" aria-expanded={mainMenu} onClick={()=>setMainMenu(true)}><Menu size={22}/></button></div></header>
  <MenuDrawer open={mainMenu} onClose={()=>setMainMenu(false)} favorites={saved.favorites.length} mode={mode} onMode={setMode} showShadow={showShadow} onShadow={setShowShadow} showPath={showPath} onPath={setShowPath} maxWalk={maxWalk} onMaxWalk={setMaxWalk} followTime={followTime} onFollowTime={setFollowTime} showLabels={showLabels} onShowLabels={setShowLabels} onRestSheet={()=>setModal('rest')} lightQuality={quality==='light'} onLightQuality={v=>setQuality(v?'light':'balanced')}
   onList={()=>{setFavoriteOnly(false);setPanel('spots');setSpotView('list')}} onFavorites={()=>{setFavoriteOnly(true);setPanel('spots');setSpotView('list')}} onSun={()=>{setShowSun(true);setSolarOpen(true);setPanel('sun')}} onLocate={locate} onAdd={()=>{if(mode.startsWith('google'))setMode('model2d');setAdding(true);setPanel('sun')}} onHelp={()=>setModal('help')} onSettings={()=>setModal('settings')} onAbout={()=>setModal('about')}/>
  {showRestBanner?<RestBanner walkingMinutes={walkingMinutes} hot={wbgt>=HOT_WBGT} onRest={()=>setModal('rest')} onSnooze={()=>setRestPrefs(snooze(restPrefs,Date.now()))} onDisable={()=>{setRestPrefs({...restPrefs,bannerDisabled:true,log:[...restPrefs.log,{at:Date.now(),action:'disable'}]});notify('休憩の提案を止めました。設定から戻せます。')}}/>:null}
  <main className="app-shell"><SolarPanel day={day} minutes={minutes} sun={sun} weather={weather} weatherSource={weatherIsDemo?'天気デモ':forecast?.sourceLabel||'予報'} onTime={m=>{setPlaying(false);setMinutes(m)}} onSettings={()=>setModal('settings')} onAbout={()=>setModal('about')} open={solarOpen} onToggle={()=>{if(solarOpen){setSolarOpen(false);setShowSun(false)}else setSolarOpen(true)}}/><section className="intro"><div><p className="eyebrow"><span/> A LITTLE PAUSE, A BETTER DAY</p><h1>ひと休みを、<span>もっと気軽に。</span></h1><p className="intro-copy">座れる場所も、心地いい日陰も。まちの中の、ちょうどいい休憩を。</p></div><button className="weather-pill" onClick={()=>setModal('settings')}>{weather.condition==='clear'?<Sun size={27}/>:<Cloud size={27}/>}<span><strong>{Math.round(weather.temperatureC)}<small>°C</small></strong><span>{WEATHER_LABEL[weather.condition]} <i>· {weatherIsDemo?'天気デモ':forecast?.sourceLabel}</i></span></span><ArrowUpRight size={16}/></button></section>
   <div className="workspace">
    <section className="map-panel" aria-label="スポット検索と地図">
    <div className="search-area">
     <label className="search-box">
      <Search size={21} />
      <input
       aria-label="スポットを検索"
       placeholder="公園、スポット名、設備から探す"
       value={query}
       onFocus={() => setPanel('spots')}
       onChange={(e) => setQuery(e.target.value)}
      />
      {query ? (
       <button aria-label="検索をクリア" onClick={() => setQuery('')}>
        <X size={16} />
       </button>
      ) : null}
      <span className="search-location">
       <MapPin size={14} />
       みなとみらい
      </span>
     </label>
     <button className="locate-search" aria-label="端末の現在地を取得" onClick={locate}>
      <LocateFixed size={20} />
     </button>
    </div>
   <div className="filter-row"><button aria-pressed={shadedOnly} onClick={()=>setShadedOnly(x=>!x)}><Leaf size={15}/>日陰</button><button aria-pressed={roofOnly} onClick={()=>setRoofOnly(x=>!x)}><House size={15}/>屋根あり</button><button aria-pressed={seatableOnly} onClick={()=>{setSeatableOnly(x=>!x);setPanel('spots')}}><Armchair size={15}/>座れそう</button><button aria-pressed={toiletNear} onClick={()=>{setToiletNear(x=>!x);setPanel('spots')}}><Accessibility size={15}/>トイレ近く</button></div>
   <div className="map-stage"><MapView weather={weather.condition} quality={quality} onQuality={()=>setQuality(v=>v==='light'?'balanced':'light')} dataset={dataset} spots={mapSpots} selected={active?.spot.id||''} sun={sun} day={day} minutes={minutes} showPath={showPath} mode={mode} apiKey={mapKey} location={origin} showShadow={showShadow} adding={adding} onSelect={choose} onPoint={p=>{setAddPoint(p);setModal('add')}} onError={notify} onMode={setMode} route={routeShading?.segments??null} levels={levels} showLabels={showLabels} bubbles={panel==='sun'||innerWidth>760?bubbles:[]} onBubble={onBubble}/>
   <div className="seat-legend glass-panel" aria-label="ピンの色: 空席予測"><span><i className="level-high"/>座れそう</span><span><i className="level-mid"/>五分五分</span><span><i className="level-low"/>混みそう</span></div>
   <div className="map-source"><i/>{dataset.meta.live?'OSM ライブ取得':dataset.meta.plateauBuildings?'OSM + PLATEAU 2024':'OSM 同梱データ'}<button aria-label="地図とデータについて" onClick={()=>setModal('about')}><Info size={14}/></button></div>
    <button
     className={adding ? 'add-spot on' : 'add-spot'}
     onClick={() => {
      // Google の地図ではタップ位置を取れないのでモデル地図に切り替える
      if (mode.startsWith('google')) setMode('model2d')
      setAdding((on) => !on)
     }}
    >
     {adding ? <X size={17} /> : <Plus size={17} />}
     <span>{adding ? '追加をキャンセル' : 'スポットを追加'}</span>
    </button>
   {adding?<div className="add-hint">追加する場所を地図上でタップ <button onClick={()=>{setAddPoint(origin);setModal('add')}}>基準地点に追加</button><button onClick={()=>setAdding(false)}>やめる</button></div>:null}
   {picks.length&&!(routeSpot&&!picks.some(p=>p.spot.id===routeTo))?<section ref={cardRef} className={'best-pick glass-panel'+(tucked?' tucked tucked-'+tucked:'')} aria-label="着いたときのおすすめ" aria-roledescription="カルーセル" aria-hidden={tucked?true:undefined} inert={tucked?true:undefined} onPointerDown={cardDown} onPointerMove={cardMove} onPointerUp={cardUp} onPointerCancel={cardUp} onClickCapture={cardClickGuard}><button className="best-tuck" aria-label="おすすめを端にしまう（横にスワイプでも）" onClick={()=>setTucked('left')}><ChevronLeft size={15}/></button><span className="best-grip" aria-hidden="true"/><button className="care-chip" onClick={()=>setModal('rest')} aria-label="いまの状態を変える（休憩する）"><HeartPulse size={14}/><span>いまの状態</span><b>疲れ{NEED_FATIGUE[restNeed.fatigue]} · {WALKED_LABEL[restNeed.walked]} · {restNeed.available}分休める{restNeed.wishes.length?' · '+restNeed.wishes.map(w=>WISH_LABEL[w]+(restNeed.must?.includes(w)?'（必須）':'')).join('・'):''}</b><PencilLine size={14}/></button>{restNeed.fatigue==='limit'?<p className="rest-safety-inline" role="alert"><ShieldAlert size={15}/>{SAFETY_GUIDANCE}</p>:null}{livePicks.length&&livePicks.every(p=>p.walkMin>walkLimit(restNeed))?<p className="rest-limit-note">徒歩{walkLimit(restNeed)}分以内に候補がないため、近い順に出しています。</p>:null}<div className="best-time"><span>{day===jstParts(now).dateKey?'出発':`${formatDateJa(day)} 出発`}</span><strong>{formatTime(minutes)}</strong><input className="best-slider" type="range" min="300" max="1260" step="5" aria-label="出発時刻" value={Math.max(300,Math.min(1260,minutes))} style={{'--time-progress':String((Math.max(300,Math.min(1260,minutes))-300)/960*100)+'%'} as React.CSSProperties} onChange={e=>{setPlaying(false);setMinutes(Number(e.target.value))}}/><button className="best-preset" onClick={()=>{setPlaying(false);setRouteTo(null);setToNow();if(isSummer)setTemp(24)}}>今</button><button className={'best-preset summer'+(isSummer?' on':'')} aria-pressed={isSummer} onClick={toggleSummer}>夏14時</button></div>{staleFrozen?<div className="repick-row"><span>候補は {frozen!.day!==day?formatDateJa(frozen!.day)+' ':''}{formatTime(frozen!.minutes)} 出発で選んだ場所です（影と表示は {formatTime(minutes)} のもの）</span><button onClick={refreeze}>この時刻で選び直す</button></div>:null}
    <div className="best-track" ref={trackRef} onScroll={onTrackScroll}>{picks.map((p,i)=>{const onRoute=routeTo===p.spot.id&&!!route,walk=onRoute?walkMinutes(route!.distance):p.walkMin,arrive=Math.min(1439,minutes+walk),shaded=isShaded(p.shade),level=seatLevel(p.seat),span=pickSpans[i]
     const shadeChip=p.shade==='night'?'着くころは日没後':p.shade==='cloud'?(weather.condition==='rain'||weather.condition==='heavy-rain'?'雨で日差しなし（屋根があると安心）':'くもりで日差しなし'):shaded?`着く時は日陰${span?.untilDark?'（日没まで）':span?.untilMin?`（${formatTime(span.untilMin)}まで）`:''}`:preferShade?`着く時は日なた${span?.nextShadeMin?`（${formatTime(span.nextShadeMin)}から日陰）`:''}`:'着く時は日なたで暖かい'
     return <article key={p.spot.id} className={'best-slide'+(i===pickIdx?' is-current':i<pickIdx?' is-prev':' is-next')} aria-roledescription="スライド" aria-label={`${i+1}件目（全${picks.length}件）`}>
      <div className="best-top"><span className="best-eyebrow">{i===0?(preferShade?'着いたとき日陰で座れる':'寒い日なので、着いたとき日なたの席'):`候補 ${i+1}`}</span>{picks.length>1?<span className="best-count">{i+1} / {picks.length}</span>:null}</div>
      <button className="best-name" onClick={()=>choose(p.spot.id)}><strong>{placeLabel(p.spot)}</strong><span>徒歩 {walk}分 · {formatTime(arrive)} 着</span></button>
      <div className="best-chips"><span className={'best-chip '+(p.shade==='night'?'chip-night':shaded?'chip-shade':'chip-sun')}>{shaded?<Leaf size={12}/>:<Sun size={12}/>}{shadeChip}<em className="st">推定</em></span>{p.spot.kind!=='indoor'?<span className={'best-chip chip-level level-'+level}><i/>座れる見込み {pct(p.seat)}<em className="st">推定</em></span>:null}{onRoute&&sunMin!==null&&routeShading?.shadedRatio!==null?<span className="best-chip chip-walk"><Footprints size={12}/>日なたを歩く {sunMin}分{shadeFirst&&shortestSunMin!==null&&shortestSunMin>sunMin?`（最短なら${shortestSunMin}分）`:''}</span>:null}{reasonsOf(p).filter(r=>r.key!=='walk'&&r.key!=='shade'&&r.key!=='seat').map(r=><span key={r.key} className={'best-chip reason-chip st-'+r.status+(r.ok===false?' ng':r.ok===null?' unk':' ok')}>{r.label}{r.key.endsWith(':must')?'（必須）':''}<em className="st">{STATUS_LABEL[r.status]}</em></span>)}</div>
      <p className="best-reason">{arrivalReason({shade:p.shade,preferShade,seat:p.seat,walkMin:walk})}{onRoute&&route!.fallback?' · 道がつながらないため直線表示':''}</p>
      {onRoute?<fieldset className="route-radio"><legend>道の選び方</legend><label><input type="radio" name={'route-mode-'+i} checked={shadeFirst} onChange={()=>setShadeFirst(true)}/><span>日陰を優先</span></label><label><input type="radio" name={'route-mode-'+i} checked={!shadeFirst} onChange={()=>setShadeFirst(false)}/><span>最短</span></label></fieldset>:null}
      {onRoute?<div className="arrive-feedback"><span>着いたら教えてください（1タップ）</span><div><button onClick={()=>post('sat')}>座れた</button><button onClick={()=>post('full')}>満席</button><button onClick={()=>check('shade')}>日陰だった</button><button onClick={()=>check('sun')}>日なただった</button><button onClick={()=>post('facility')}>設備が使えなかった</button></div></div>:null}
      <div className="best-actions">{onRoute?<button onClick={()=>setRouteTo(null)}><X size={14}/>ルートを閉じる</button>:<button className="primary" onClick={()=>{goPick(i);startRoute(p.spot.id)}}><Footprints size={16}/>ここへ行く</button>}<button onClick={()=>choose(p.spot.id)}>詳細</button></div>
     </article>})}</div>
    {picks.length>1?<div className="best-dots"><button className="best-arrow" aria-label="前の候補" disabled={pickIdx===0} onClick={()=>goPick(pickIdx-1)}><ChevronLeft size={16}/></button>{picks.map((p,i)=><button key={p.spot.id} className={'best-dot'+(i===pickIdx?' on':'')} aria-label={`候補${i+1}を表示`} aria-current={i===pickIdx} onClick={()=>goPick(i)}/>)}<button className="best-arrow" aria-label="次の候補" disabled={pickIdx===picks.length-1} onClick={()=>goPick(pickIdx+1)}><ChevronRight size={16}/></button></div>:null}
   </section>:null}
   {tucked&&picks.length?<button className={'pick-tab pick-tab-'+tucked} aria-label="おすすめを開く" onClick={()=>setTucked(null)} onPointerDown={e=>{swipe.current={x:e.clientX,y:e.clientY,dx:0,id:e.pointerId,on:false}}} onPointerUp={e=>{const g=swipe.current;swipe.current=null;if(g&&Math.abs(e.clientX-g.x)>30)setTucked(null)}}>{tucked==='left'?<ChevronRight size={20}/>:<ChevronLeft size={20}/>}<span>候補<b>{picks.length}</b></span></button>:null}
   {routeSpot&&route&&!picks.some(p=>p.spot.id===routeTo)?<div className="route-pill glass-panel" role="status"><Footprints size={17}/><button className="route-pill-copy" onClick={()=>choose(routeSpot.id)}><strong>{spotName(routeSpot)}まで 徒歩 約{walkMinutes(route.distance)}分</strong><small>{formatDistance(route.distance)}{shadeText?' · '+shadeText:''}{route.fallback?' · 直線表示':''}</small></button><button aria-label="ルートを閉じる" onClick={()=>setRouteTo(null)}><X size={16}/></button></div>:null}
   <div className="scene-place glass-panel"><button className="place-locate" aria-label="端末の現在地を取得" onClick={locate}><Navigation size={17}/></button><span><strong>{panel==='spots'&&active?spotName(active.spot):'横浜・みなとみらい'}</strong><small>横浜市 (JST)</small></span><button className="place-more" aria-label="表示の切り替え" aria-expanded={placeMenu} onClick={()=>setPlaceMenu(v=>!v)}><Ellipsis size={18}/></button>{placeMenu?<div className="place-menu glass-panel" role="menu"><button role="menuitem" onClick={()=>{setMode(mode==='model3d'?'model2d':'model3d');setPlaceMenu(false)}}>{mode==='model3d'?'2D表示にする':'3D表示にする'}</button><button role="menuitem" onClick={()=>setShowShadow(x=>!x)}>影を{showShadow?'隠す':'表示'}</button><button role="menuitem" onClick={()=>setShowPath(x=>!x)}>太陽の軌道を{showPath?'隠す':'表示'}</button><button role="menuitem" onClick={()=>{setModal('about');setPlaceMenu(false)}}>データと予測について</button></div>:null}</div>
   <EdgeScrubbers day={day} today={jstParts(now).dateKey} minutes={minutes} onMinutes={m=>{setPlaying(false);setMinutes(m)}} onDay={d=>{setPlaying(false);setDay(d)}} onNow={()=>{setPlaying(false);setToNow()}}/>
   <div className="time-panel glass-panel"><div className="time-heading"><span className="timeline-date"><input aria-label="予測日" type="date" value={day} onChange={e=>{if(e.target.value){setDay(e.target.value);setPlaying(false)}}}/></span><span className="time-display"><strong>{formatTime(minutes)}</strong><small>JST</small></span><div className="timeline-switches"><button className={'shadow-toggle '+(showShadow?'on':'')} aria-label="影を表示" aria-pressed={showShadow} onClick={()=>setShowShadow(x=>!x)}><Layers size={15}/><span>影</span></button><button className={'path-toggle '+(showPath?'on':'')} aria-label="太陽の軌道を表示" aria-pressed={showPath} onClick={()=>setShowPath(x=>!x)}><Sun size={16}/><span>軌道</span></button><button className={'summer-button '+(isSummer?'on':'')} aria-pressed={isSummer} title="8月14日 14:00・33℃で見る" onClick={toggleSummer}>夏14時</button><button className="now-button" onClick={()=>{setPlaying(false);setToNow()}}>Now</button></div></div><div className="timeline-track"><button className={'play-button '+(playing?'playing':'')} aria-label={playing?'時刻の再生を停止':'時刻を再生'} aria-pressed={playing} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={17} fill="currentColor"/>:<Play size={17} fill="currentColor"/>}</button><div className="slider-wrap"><input className="time-slider" aria-label="予測時刻" type="range" min="0" max="1439" step="1" value={minutes} style={{'--time-progress':String(minutes/1439*100)+'%'} as React.CSSProperties} onChange={e=>{setPlaying(false);setMinutes(Number(e.target.value))}}/><div className="time-ticks"><span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div></div></div><p className="time-footnote">{sun.altitude<=2?'日差しのない時間帯です。':`太陽の高度 ${Math.round(sun.altitude)}° · 暑さ指数（推定）${wbgt} ${WBGT_LABEL[wbgtLevel(wbgt)]} · 建物と樹木の3Dモデルで影を計算`}{eventDemo?' · イベント条件はデモ':''}</p></div>
   </div>
  </section>
  <aside className={'results-panel view-'+spotView}><button className="results-close" aria-label="閉じて地図に戻る" onClick={()=>setPanel('sun')}><X size={18}/></button><nav className="breadcrumb" aria-label="現在の場所"><ol><li><button onClick={()=>setPanel('sun')}>ホーム</button></li><li>{spotView==='detail'?<button onClick={()=>setSpotView('list')}>{favoriteOnly?'保存した場所':'一覧'}</button>:<span aria-current="page">{favoriteOnly?'保存した場所':'一覧'}</span>}</li>{spotView==='detail'&&active?<li><span aria-current="page">{placeLabel(active.spot)}</span></li>:null}</ol></nav><div className="results-header"><div><p className="eyebrow">YOUR NEXT REST STOP</p><h2>{favoriteOnly?'保存した場所':'近くの休憩スポット'}<span>{filtered.length}</span></h2></div><label className="sort-select"><span className="sr-only">並び順</span><select aria-label="並び順" value={sort} onChange={e=>setSort(e.target.value)}><option value="recommended">おすすめ順</option><option value="distance">距離が近い順</option><option value="seats">座れそうな順</option></select></label></div><div className="distance-row"><span><MapPin size={13}/>{origin===DEMO_USER_LOCATION?'桜木町の基準地点から':'端末の現在地から'}</span><select aria-label="検索距離" value={range} onChange={e=>setRange(Number(e.target.value))}><option value="500">500m以内</option><option value="1000">1km以内</option><option value="2000">2km以内</option><option value="3500">エリア全体</option></select></div><div className="legend-row"><span><i className="level-high"/>座れそう 70%〜</span><span><i className="level-mid"/>五分五分</span><span><i className="level-low"/>混みそう 〜40%</span></div>
   <div className="results-scroll">{!active?<div className="empty-state"><Leaf size={33}/><h3>ぴったりの場所を、もう一度。</h3><p>条件に合うスポットがありません。距離や日陰の条件を変えてみてください。</p><button className="primary" onClick={()=>{setQuery('');setShadedOnly(false);setRoofOnly(false);setFavoriteOnly(false);setSeatableOnly(false);setToiletNear(false);setCategory('all');setRange(3500)}}>条件をリセット</button></div>:<>
   <article className="featured-card"><div className="card-topline"><span className="recommend-tag"><Leaf size={13}/>{isSeatSpot(active.spot)?'ひと休みの候補':'近くの設備'}</span><button className={'heart-button '+(saved.favorites.includes(active.spot.id)?'saved':'')} aria-label={saved.favorites.includes(active.spot.id)?'保存を解除':'この場所を保存'} onClick={()=>saveFavorite(active.spot.id)}><Heart size={21} fill={saved.favorites.includes(active.spot.id)?'currentColor':'none'}/></button></div><div className="spot-kind"><span>{KIND_LABEL[active.spot.kind]}</span><span className="source-label">{active.spot.origin==='user'?'ユーザー投稿・未検証':'OSM掲載地点'}</span></div><h3>{placeLabel(active.spot)}</h3><p className="spot-distance">徒歩目安 {walkMinutes(active.distance)}分 <i/>直線 {formatDistance(active.distance)}</p><div className="spot-tags"><span className={isShaded(active.shade)?'green-tag':'neutral-tag'}>{isShaded(active.shade)?<Leaf size={13}/>:<Sun size={13}/>} {SHADE_LABEL[active.shade]}</span>{active.coverage.level==='high'||active.coverage.level==='partial'||active.coverage.level==='sun'?<span className={'coverage-tag coverage-'+active.coverage.level} title="中心と周り約1.5mの5点で調べた日陰の割合">{COVERAGE_LABEL[active.coverage.level]} {Math.round(active.coverage.ratio*100)}%</span>:null}{active.spot.roof==='yes'?<span className="neutral-tag"><House size={13}/>屋根あり{active.spot.roofSource==='inside-building'||active.spot.roofSource==='roof-polygon'?'（推定）':''}</span>:null}{active.spot.kind!=='toilet'&&(toiletDistance.get(active.spot.id)??Infinity)<=400?<span className="neutral-tag"><Accessibility size={13}/>トイレまで {formatDistance(toiletDistance.get(active.spot.id)!)}</span>:null}{active.spot.backrest==='yes'?<span className="neutral-tag">背もたれ</span>:null}{active.spot.wheelchair==='yes'?<span className="neutral-tag">車いす対応タグ</span>:null}</div>
    {active.spot.note?<p className="spot-note"><b>{active.spot.kind==='trash'?'捨てられる物':'メモ'}</b>{active.spot.note}</p>:null}{active.spot.description?<p className="spot-note"><b>利用条件・確認</b>{active.spot.description}</p>:null}
    {active.prediction?<div className={'seat-box level-box-'+seatLevel(active.prediction.combined)}><div><span>空席予測 <i>ルール推定</i></span><strong>{pct(active.prediction.ai)}</strong><small>{active.prediction.ai>=.7?'座れそうな見込み':active.prediction.ai>=.4?'空いている可能性あり':'混んでいる見込み'} · ピンの色: {SEAT_LEVEL_LABEL[seatLevel(active.prediction.combined)]}</small></div><div className="probability-ring" style={{'--prob':`${active.prediction.ai*100}%`} as React.CSSProperties}><Armchair size={25}/></div><div className={'confidence-row confidence-'+active.prediction.confidence.level}><b>確からしさ {CONFIDENCE_LABEL[active.prediction.confidence.level]}</b><span>80%の幅 {pct(active.prediction.confidence.low)}〜{pct(active.prediction.confidence.high)}</span>{active.prediction.confidence.notes.length?<small>{active.prediction.confidence.notes.join(' · ')}</small>:null}</div><p>実測で校正していない参考値です。空席を保証するものではありません。</p></div>:null}
    {trend?<div className="shade-preview seat-trend"><div><span><Armchair size={13}/> 空席の見込みの推移</span><small>{formatDateJa(day)}</small></div><div className="trend-bars" role="group" aria-label="9時から21時までの空席予測">{trend.map(x=><button key={x.m} className={'trend-bar level-'+seatLevel(x.p)+(Math.abs(x.m-minutes)<15?' current':'')+(bestSlot?.m===x.m?' best':'')} style={{'--h':`${Math.max(6,x.p*100)}%`} as React.CSSProperties} aria-label={`${formatTime(x.m)} ${pct(x.p)}`} title={`${formatTime(x.m)} ${pct(x.p)}`} onClick={()=>{setPlaying(false);setMinutes(x.m)}}><i/></button>)}</div><div className="shade-ticks"><span>9時</span><span>15時</span><span>21時</span></div><p>{bestSlot?`${formatTime(bestSlot.m)}ごろが座りやすい見込み（${pct(bestSlot.p)}）`:'今日のこれからの時間帯は表示範囲外です。'} · 棒を押すとその時刻へ</p></div>:null}
    {timeline?<details className="acc" open><summary>日陰の時間帯<small>{formatDateJa(day)}</small></summary><div className="shade-preview"><div><span><Clock size={13}/> 日陰の時間帯</span><small>{formatDateJa(day)}</small></div><div className="shade-strip" aria-label="6時から19時までの日陰予測">{timeline.states.map((s,i)=><span key={i} className={'shade-'+s} title={`${formatTime(timeline.startMin+i*timeline.stepMin)} ${SHADE_LABEL[s]}`}/>)}</div><div className="shade-ticks"><span>6時</span><span>12時</span><span>19時</span></div><p>{windows.length?windows.slice(0,2).map(w=>`${formatTime(w.startMin)}–${formatTime(Math.min(w.endMin,1140))}`).join(' / '):'このモデルでは、まとまった日陰は見つかりません。'}{windows.length?' ごろが日陰の見込み':''}</p></div></details>:null}
    {active.prediction?<details className="acc prediction-details"><summary>予測の理由</summary><ul>{active.prediction.factors.map(f=><li key={f.key}>{f.label}</li>)}{active.prediction.history?<li>この地点の過去の投稿（重み {active.prediction.history.n.toFixed(1)}）でルール推定 {pct(active.prediction.rule)} を {active.prediction.history.offset>=0?'+':''}{Math.round(active.prediction.history.offset*100)}ポイント補正</li>:null}{active.prediction.nearbyPosts?<li>150m以内の近くの地点の直近投稿 {active.prediction.nearbyPosts}件を弱く反映</li>:null}</ul><small>係数・独立着席を仮定したモデル v0。天気は{weatherIsDemo?'デモ':'取得した予報'}です。</small><button className="text-button" disabled={!!busy} onClick={()=>run('Geminiの説明',async()=>{const r=await fetch(apiUrl('/api/explain'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:spotName(active.spot),probability:active.prediction!.ai,reasons:active.prediction!.factors.map(f=>f.label)}),signal:AbortSignal.timeout(20000)});if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Geminiは未接続です。APIガイドに沿ってサーバーを起動してください。');const d=await r.json();if(!r.ok)throw Error(d.error||'説明の生成に失敗しました。');setExplanation({spotId:active.spot.id,text:d.text,key:explanationKey})})}><Sparkles size={13}/>Geminiに説明を依頼</button>{explanation?.spotId===active.spot.id&&explanation.key===explanationKey?<p>{explanation.text}</p>:null}</details>:null}{<details className="acc"><summary>情報の出どころ</summary><ul className="source-list"><li><b>場所</b>{active.spot.origin==='user'?'ユーザー投稿・未検証':`OpenStreetMap（同梱データ${dataset.meta.asOf?'・'+new Date(dataset.meta.asOf).toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'})+' 時点':''}）`}</li><li><b>日陰</b>建物・樹木の形と太陽の位置から計算した予測（{formatDateJa(day)} {formatTime(minutes)}）</li><li><b>座れる見込み</b>時間帯・曜日・天気からのルール推定。実測では未校正</li><li><b>実際の投稿</b>{reportForActive?`${formatAgo(Math.max(0,Math.round((now.getTime()-Date.parse(reportForActive.reportedAt))/60000)))}に「${reportForActive.value==='sat'?'座れた':reportForActive.value==='full'?'満席だった':reportForActive.value==='facility'?'設備が使えなかった':'見当たらなかった'}」（この端末）`:'まだありません'}</li><li><b>いまの状態</b>手入力（Google Health は未接続）</li></ul></details>}
    {(()=>{const rp=rankedPicks.find(p=>p.spot.id===active.spot.id);return rp?<details className="acc reason-section"><summary>条件と情報源<small>確認済み・投稿・推定・未確認</small></summary><ul className="reason-list">{reasonsOf(rp).map(r=><li key={r.key} className={'st-'+r.status+(r.ok===false?' ng':r.ok===null?' unk':' ok')}><em className="st">{STATUS_LABEL[r.status]}</em>{r.label}</li>)}</ul><small>未確認の設備は「ある」と断定していません。行く前に現地でお確かめください。</small></details>:null})()}
    <details className="acc report-section"><summary>現地の様子を教える<small>{sharing?'共有中':'この端末内に保存'}</small></summary>{isSeatSpot(active.spot)?<div className="report-buttons"><button onClick={()=>post('sat')}><Check size={16}/>座れた</button><button onClick={()=>post('full')}><Armchair size={16}/>満席だった</button></div>:null}<button className="missing-button" onClick={()=>post('missing')}>見当たらなかった</button><button className="missing-button" onClick={()=>post('facility')}>設備が使えなかった（トイレ・冷房・給水など）</button><div className="check-block"><span>日陰の答え合わせ（いまの様子）</span><div className="check-buttons"><button onClick={()=>check('shade')}><Leaf size={14}/>日陰だった</button><button onClick={()=>check('sun')}><Sun size={14}/>日なただった</button></div><small>{rate.ratio===null?'まだ答え合わせはありません。現地で押すと、予測が当たったかを記録します。':`これまで ${rate.total}件 · 予測と一致 ${pct(rate.ratio)}`}</small></div>
     {reportForActive?<div className="actual-report"><Check size={14}/><span>実投稿 · {formatAgo(Math.max(0,Math.round((now.getTime()-Date.parse(reportForActive.reportedAt))/60000)))}に「{reportForActive.value==='sat'?'座れた':reportForActive.value==='full'?'満席だった':reportForActive.value==='facility'?'設備が使えなかった':'見当たらなかった'}」</span><button aria-label="この投稿を取り消す" onClick={()=>run('投稿の取消',async()=>{if(share.current)await share.current.remove(reportForActive.id);if(commit({...saved,reports:saved.reports.filter(r=>r.id!==reportForActive.id)}))notify('投稿を取り消しました。')})}><Undo2 size={14}/></button></div>:<p className="no-posts">この端末からの投稿はまだありません。</p>}
     {active.prediction&&(active.prediction.posts.length||active.prediction.nearbyPosts)?<p className="combined-note">{postsApply(time,now)?`直近投稿${active.prediction.nearbyPosts?`（近くの地点 ${active.prediction.nearbyPosts}件を含む）`:''}を含めた参考値 ${pct(active.prediction.combined)}`:'指定時刻が現在から離れているため、実投稿は予測に反映していません。'}</p>:null}{shared.filter(r=>r.spotId===active.spot.id).slice(0,2).map(r=><p className="shared-report" key={r.id}>共有投稿 · {formatAgo(Math.max(0,Math.round((now.getTime()-Date.parse(r.reportedAt))/60000)))} · {r.value==='sat'?'座れた':r.value==='full'?'満席':'見当たらなかった'}</p>)}
    </details>
    {routeTo===active.spot.id?<div className="route-box"><div className="route-summary"><Footprints size={17}/><strong>{route?`徒歩 約${walkMinutes(route.distance)}分`:'ルートを計算中…'}</strong>{route?<span>{formatDistance(route.distance)}</span>:null}</div>
     {routeShading?.segments.length?<div className="route-bar" aria-hidden="true">{routeShading.segments.map((s,i)=><i key={i} className={'route-'+s.state} style={{flexGrow:segmentLength(s)}}/>)}</div>:null}{shadeText?<p className="route-shade-text">{shadeText}</p>:null}
     {route?.fallback?<p className="route-fallback">道路データでつながらない地点のため、直線で表示しています。</p>:null}
     <fieldset className="route-radio"><legend>道の選び方</legend><label><input type="radio" name="route-mode-detail" checked={shadeFirst} onChange={()=>setShadeFirst(true)}/><span>日陰を優先</span></label><label><input type="radio" name="route-mode-detail" checked={!shadeFirst} onChange={()=>setShadeFirst(false)}/><span>最短</span></label></fieldset><div className="route-actions"><button onClick={()=>setRouteTo(null)}><X size={14}/>ルートを閉じる</button></div></div>
    :<button className="primary route-button" onClick={()=>startRoute(active.spot.id)}><Footprints size={17}/>ここへ行く（徒歩ルート）</button>}
    <a className="route-external" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${active.spot.position.lat},${active.spot.position.lng}&travelmode=walking`}>Google マップで開く <ArrowUpRight size={12}/></a>
     {active.spot.origin === 'user' ? (
      <button className="delete-spot" onClick={() => deleteOwnSpot(active.spot.id)}>
       登録したスポットを削除
      </button>
     ) : null}
   </article>
   <div className="other-heading"><h3>{spotView==='list'?'候補の一覧':'ほかの候補もチェック'}</h3><span>{spotView==='list'?filtered.length:Math.max(0,filtered.length-1)}か所</span></div>{filtered.filter(r=>spotView==='list'||r.spot.id!==active.spot.id).slice(0,limit).map(r=>{const Icon=kindIcons[r.spot.kind];return <button className="result-card" key={r.spot.id} onClick={()=>choose(r.spot.id)}><span className="result-icon"><Icon size={21}/></span><span className="result-copy"><strong>{placeLabel(r.spot)}</strong><span>直線 {formatDistance(r.distance)} · {r.coverage.level==='partial'?COVERAGE_LABEL.partial:SHADE_LABEL[r.shade]}</span></span><span className={'result-prob'+(r.prediction?' level-text-'+seatLevel(r.prediction.combined):'')}>{r.prediction?pct(r.prediction.ai):<ArrowRight size={17}/>}<small>{r.prediction?'推定':''}</small></span></button>})}{filtered.length>limit+1?<button className="show-more" onClick={()=>setLimit(n=>n+12)}>もっと見る <Plus size={15}/></button>:null}
   </>}
    <p className="results-note">
     <Info size={14} />
     日陰は建物・樹木の近似モデルです。実際の設備や開放状況は現地でご確認ください。
    </p>
   </div>
  </aside></div><footer className="site-footer"><span><Leaf size={14}/>休むことも、まちを楽しむこと。</span><button onClick={()=>setModal('about')}>データと予測について <ArrowUpRight size={12}/></button><small>Rest Care / 0.3</small></footer></main>
   {notice ? (
    <div className="notice" role="status">
     <Info size={18} />
     <span>{notice}</span>
     <button aria-label="通知を閉じる" onClick={() => setNotice('')}>
      <X size={17} />
     </button>
    </div>
   ) : null}
   {busy ? (
    <div className="busy" role="status">
     <RefreshCw size={14} className="spin" />
     {busy}…
    </div>
   ) : null}
  {modal==='settings'?<Modal title="設定とAPI接続" onClose={()=>setModal(null)}><div className="modal-body"><p className="modal-lead">APIキーなしで、同梱のOSMデータと天気デモを使えます。</p><section className="setting-section"><h3><Sun size={17}/>天気とイベント</h3><div className="two-fields"><label>デモ気温（℃）<input type="number" min="-10" max="45" value={temp} onChange={e=>{setTemp(Math.max(-10,Math.min(45,Number(e.target.value))));setForecast(null)}}/></label><fieldset className="weather-radio"><legend>デモ天気</legend>{([['clear','晴れ'],['cloudy','くもり'],['rain','雨'],['snow','雪']] as [WeatherCondition,string][]).map(([v,l])=><label key={v}><input type="radio" name="demo-weather" checked={condition===v} onChange={()=>{setCondition(v);setForecast(null)}}/><span>{l}</span></label>)}</fieldset></div><div className="button-row"><button disabled={!!busy} onClick={()=>run('天気の取得',async()=>{setForecast(await openMeteo());notify('Open-Meteoの予報を取得しました。対応する日時に反映されます。')})}>Open-Meteoで取得</button><button disabled={!!busy} onClick={()=>run('Google Weatherの取得',async()=>{setForecast(await googleWeather());notify('Google Weatherの予報を取得しました。')})}>Google Weatherで取得</button></div><p className="field-note">取得した予報の対象外の日時では天気デモを表示します。Open-Meteoは通信が必要です。</p><label className="check-row"><input type="checkbox" checked={eventDemo} onChange={e=>setEventDemo(e.target.checked)}/>広場イベントを仮定する（10–18時・デモ）</label>{eventDemo?<p className="warning-inline">イベントは架空の条件です。実際の開催情報ではありません。</p>:null}</section>
   <RestSettings prefs={restPrefs} setPrefs={setRestPrefs} google={google} onGoogleChange={refreshGoogle} notify={notify} onWalkDemo={()=>{setWalkDemo(30);setRestPrefs({...restPrefs,snoozedUntil:null});setModal(null)}}/>
   <section className="setting-section"><h3><Layers size={17}/>3Dの表示品質</h3><div className="button-row"><button aria-pressed={quality==='light'} onClick={()=>setQuality('light')}>軽量（スマホ向け）</button><button aria-pressed={quality==='balanced'} onClick={()=>setQuality('balanced')}>標準</button></div><p className="field-note">軽量表示では影の解像度・樹木・建物の装飾を減らし、カメラ移動のアニメーションを省略します。日陰の判定と検索条件は共通です。</p></section>
    <MapKeySection
     mapKey={mapKey}
     busy={!!busy}
     onMapKey={setMapKey}
     onConnect={(next) => {
      setMode(next)
      setModal(null)
     }}
     onModelMap={() => setMode('model2d')}
    />
    <DataSection
     dataset={dataset}
     busy={!!busy}
     sharing={sharing}
     onFetchLive={fetchLive}
     onBundled={() => {
      setDataset(initialDataset)
      notify('同梱のOSMデータに戻しました。')
     }}
     onToggleSharing={toggleSharing}
    />
   <section className="setting-section"><h3><Download size={17}/>この端末のデータ</h3><p className="field-note">登録 {saved.spots.length}件・投稿 {saved.reports.length}件・保存 {saved.favorites.length}件・日陰の答え合わせ {rate.total}件{rate.ratio!==null?`（予測と一致 ${pct(rate.ratio)}）`:''}。復元すると端末内のデータを置き換えます。</p><div className="button-row"><button onClick={()=>exportSaved(saved)}>JSONで保存</button><button onClick={()=>importRef.current?.click()}>JSONから復元</button><button className="danger-button" onClick={()=>setModal('delete')}>端末内データを削除</button></div><input ref={importRef} type="file" accept=".json,application/json" className="sr-only" onChange={e=>{const f=e.target.files?.[0];if(f)importBackup(f);e.target.value=''}}/></section></div></Modal>:null}
  {modal==='help'?<Modal title="Rest Care の使い方" onClose={closeHelp}><div className="modal-body help"><p className="modal-lead">暑い日に、着いたとき日陰で座れるベンチを教えるマップです。</p><ol className="help-steps"><li><b>下のカード</b>がおすすめのベンチです。横にスワイプすると、ほかの候補に切り替わります。</li><li>地図の<b>「!」</b>やベンチの吹き出しをタップしても選べます。</li><li><b>右端の時刻</b>を上下にドラッグすると、時刻が変わって建物の影が動きます。候補の場所はそのままです。選び直すときは「この時刻で選び直す」を押してください（メニューで自動にもできます）。</li><li><b>「ここへ行く」</b>で、日陰の多い道と、日なたを歩く時間を表示します。</li></ol><details className="acc"><summary>色の意味</summary><ul className="help-legend"><li><i className="level-high"/>座れそう（70%以上）</li><li><i className="level-mid"/>五分五分</li><li><i className="level-low"/>混みそう（40%未満）</li><li><i className="dot-shade"/>道の青い部分は日陰、<i className="dot-sun"/>橙は日なた</li></ul></details><details className="acc"><summary>安全について</summary><p>epoku は医療的な判断をしません。暑さ指数の表示は推定の目安です。体調がすぐれないときは無理をせず、涼しい場所で休み、周りの人に声をかけてください。</p></details><details className="acc"><summary>予測について</summary><p>日陰は建物と木の形から計算した予測、座れる見込みは時間帯や天気からのルール推定です。現地で答え合わせをすると、予測が当たったかを記録できます。</p></details><button className="primary" onClick={closeHelp}>はじめる</button></div></Modal>:null}
  {modal==='rest'?<Modal title="休憩する" onClose={()=>setModal(null)}><RestSheet initial={restNeed} wbgt={wbgt} temperatureC={weather.temperatureC} walkingMinutes={walkingMinutes} prefs={restPrefs} setPrefs={setRestPrefs} google={google} onGoogleChange={refreshGoogle} onShowSpots={showRestSpots} notify={notify}/></Modal>:null}
  {modal==='about'?<Modal title="データと予測について" onClose={()=>setModal(null)}><div className="modal-body about"><p>Rest Care は、横浜・みなとみらいで休憩できる場所を探すプロトタイプです。</p><h3>地点と建物はOSMデータ</h3><p>APIキーがなくても、同梱のOSMスナップショットを使えます。実在するデータですが、未掲載・位置のずれ・更新の遅れがあります。施設の営業時間や利用条件は未収録です。</p><p>建物の高さ: タグあり {stats.measured}件 / 階数から推定 {stats.levels}件 / 仮定 {stats.assumed}件。</p><h3>日陰は計算モデル</h3><p>SunCalc v2で太陽位置を求め、建物を角柱、樹木の樹冠を円柱として光線の遮蔽を判定します。地形・植生の季節変化・建物の細部は反映していません。標準の3D描画は模型で、窓や樹冠の細部・色は実際の外観とは異なります。3Dの影と地点の日陰判定は、解像度などによって境界がずれることがあります。Googleの3D映像から形状を抽出しません。</p><p>{formatDateJa(day)}の日の出 {times.sunriseMin===null?'不明':formatTime(times.sunriseMin)} / 日の入り {times.sunsetMin===null?'不明':formatTime(times.sunsetMin)}</p><h3>空席予測と実投稿</h3><p>表示する確率は、学習済みAIではなく、時間帯・曜日・天気・周辺施設・席数によるルール推定です。実測による精度検証はまだ行っていません。投稿は別表示し、現在の15分前〜30分後の予測だけに補正として使います。</p><h3>保存とAPI</h3><p>初期状態の投稿・保存先・追加地点は、このブラウザーだけに保存されます。Firebase共有は自分で有効にした場合だけ行います。位置情報は取得ボタンを押したときに使います。</p><p>Web版は利用できます。Android APKは同梱の手順でビルドできます。バックグラウンド通知、健康データ連携、行政への送信は含まれていません。</p><div className="source-links"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap / ODbL</a><a href="https://github.com/mourner/suncalc" target="_blank" rel="noreferrer">SunCalc</a><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">天気: Open-Meteo (CC BY 4.0)</a></div></div></Modal>:null}
  {modal==='add'?<Modal title="スポットを追加" onClose={()=>{setModal(null);setAdding(false)}}><form className="modal-body add-form" onSubmit={addSpot}><p className="modal-lead">現地で見つけた場所を、この端末に登録します。</p><label>名前<input name="name" maxLength={80} required placeholder="例: 海辺の休憩ベンチ"/></label><label>設備の種類<select name="kind" value={addKind} onChange={e=>setAddKind(e.target.value)}>{Object.entries(KIND_LABEL).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><div className="two-fields"><label>緯度<input name="lat" type="number" step="any" defaultValue={addPoint.lat.toFixed(6)} required/></label><label>経度<input name="lng" type="number" step="any" defaultValue={addPoint.lng.toFixed(6)} required/></label></div><label>席数（不明なら空欄）<input name="seats" type="number" min="1" max="100"/></label><label className="check-row"><input name="roof" type="checkbox"/>屋根があることを確認した</label><label className="check-row"><input name="cooling" type="checkbox"/>冷房があることを確認した</label><label className="check-row"><input name="stepFree" type="checkbox"/>段差がないことを確認した</label><button className="primary" type="submit"><Plus size={17}/>この端末に追加</button></form></Modal>:null}
   {modal === 'delete' ? (
    <DeleteDataModal
     onBack={() => setModal('settings')}
     onDelete={() => {
      if (!commit(structuredClone(EMPTY))) return
      setModal(null)
      notify('端末内のデータを削除しました。')
     }}
    />
   ) : null}
  </div>
}
