// 2026-11-10 期間内に書き直し。
// 地図の枠。モデル地図（SVG の 2D と Three.js の 3D）と Google 地図（2D・3D）を切り替え、
// 共通のボタン・凡例・出典表示を重ねる。

import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  Accessibility, Armchair as Bench, Building2, Cloud, CloudRain, Droplets, House,
  LocateFixed, MapPin, Minus, Navigation, Plus, Snowflake, Trash2,
} from 'lucide-react'
import { LocalProjection } from '../domain/geo.ts'
import { AREA_CENTER, DEMO_USER_LOCATION } from '../domain/area.ts'
import { buildShadowShapes } from '../domain/shadowPolygons.ts'
import { skyPalette, weatherPalette } from '../domain/skyPalette.ts'
import { OVERCAST } from '../domain/shade.ts'
import { isSeatSpot, type SeatLevel } from '../domain/seat.ts'
import { LANDMARKS } from '../domain/landmarks.ts'
import type { RouteSegment } from '../domain/route.ts'
import type { AreaDataset, LatLng, Spot, SunPosition, WeatherCondition, XY } from '../domain/types.ts'
import { WEATHER_LABEL } from '../lib/weather.ts'
import { connectGoogle, type ConnectedMap } from '../lib/maps.ts'
import { LEVEL_COLOR, type Bubble, type CityHandle } from './CityMap.tsx'

const CityMap = lazy(() => import('./CityMap.tsx'))

export type MapMode = 'model2d' | 'model3d' | 'google2d' | 'google3d'

export const kindIcons = {
  bench: Bench, shelter: House, picnic: Bench, toilet: Accessibility,
  trash: Trash2, water: Droplets, indoor: Building2,
}
export const KIND_LABEL = {
  bench: 'ベンチ', shelter: '休憩所', picnic: 'ピクニックテーブル', toilet: 'トイレ',
  trash: 'ゴミ箱・回収', water: '水飲み場', indoor: '屋内休憩所',
}
/** 名前のない地点は種類名で呼ぶ */
export const spotName = (s: Spot) => s.name || KIND_LABEL[s.kind]

const projection = new LocalProjection(AREA_CENTER)

/** SVG では y が下向きなので、北向きの y を反転して置く */
const toSvg = (p: LatLng) => {
  const { x, y } = projection.toXY(p)
  return { x, y: -y }
}
const pointsAttr = (ring: XY[], dx = 0, dy = 0) => ring.map((p) => `${p.x + dx},${-p.y + dy}`).join(' ')
const latLngPoints = (list: LatLng[]) => list.map((p) => { const q = toSvg(p); return `${q.x},${q.y}` }).join(' ')

/** Enter・Space でもクリックと同じにする */
const activateOnKey = (action: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  action()
}

/** モデル地図の表示範囲。中心 (x, y) は SVG 座標、span は横幅（m） */
interface View { x: number; y: number; span: number }
const INITIAL_VIEW: View = { x: 0, y: 180, span: 1500 }
const WHOLE_AREA: View = { x: 0, y: 0, span: 2300 }
const MIN_SPAN = 350
const MAX_SPAN = 4000
const ZOOM_STEP = 0.75

interface Props {
  dataset: AreaDataset
  spots: Spot[]
  selected: string
  sun: SunPosition
  day: string
  minutes: number
  showPath: boolean
  mode: MapMode
  apiKey: string
  location: LatLng
  showShadow: boolean
  adding: boolean
  onSelect: (id: string) => void
  onPoint: (p: LatLng) => void
  onError: (s: string) => void
  onMode: (s: MapMode) => void
  route?: RouteSegment[] | null
  levels?: ReadonlyMap<string, SeatLevel>
  quality?: 'balanced' | 'light'
  onQuality?: () => void
  bubbles?: Bubble[]
  onBubble?: (id: string) => void
  showLabels?: boolean
  weather?: WeatherCondition
}

/* ── Google 地図 ────────────────────────────── */

/**
 * mode が google2d / google3d のあいだ Google 地図をつなぐ。
 * 読み込みや認証に失敗したらエラーを出してモデル地図へ戻す
 */
function useGoogleMap(
  container: React.RefObject<HTMLDivElement | null>,
  mode: MapMode,
  apiKey: string,
  spots: Spot[],
  selected: string,
  handlers: Pick<Props, 'onSelect' | 'onError' | 'onMode'>,
) {
  const connected = useRef<ConnectedMap | null>(null)
  // つなぎ直さずに最新の値を読むための入れ物
  const handlerRef = useRef(handlers)
  handlerRef.current = handlers
  const latest = useRef({ spots, selected })
  latest.current = { spots, selected }
  const active = mode === 'google2d' || mode === 'google3d'

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const fallBack = (message: string) => {
      handlerRef.current.onError(message)
      handlerRef.current.onMode('model2d')
    }
    connectGoogle(container.current!, apiKey, mode, (id) => handlerRef.current.onSelect(id))
      .then((map) => {
        if (cancelled) return map.destroy()
        connected.current = map
        map.update(latest.current.spots, latest.current.selected)
      })
      .catch((e: Error) => {
        if (!cancelled) fallBack(e.message)
      })
    const onAuthError = () => fallBack('Google Mapsの認証に失敗しました。モデル地図に戻りました。')
    window.addEventListener('epoku-map-auth-error', onAuthError)
    return () => {
      cancelled = true
      connected.current?.destroy()
      connected.current = null
      window.removeEventListener('epoku-map-auth-error', onAuthError)
    }
  }, [mode, apiKey, active, container])

  useEffect(() => {
    connected.current?.update(spots, selected)
  }, [spots, selected])

  return active
}

/* ── モデル地図（SVG） ──────────────────────── */

interface ModelMapProps extends Pick<Props,
  'dataset' | 'spots' | 'selected' | 'sun' | 'location' | 'adding' | 'onSelect' | 'onPoint' |
  'route' | 'levels' | 'bubbles' | 'onBubble' | 'weather'> {
  view: View
  setView: React.Dispatch<React.SetStateAction<View>>
  shadowOn: boolean
  showLabels: boolean
}

function ModelMap(props: ModelMapProps) {
  const { dataset, spots, selected, sun, location, adding, view, setView, route, levels, bubbles, weather } = props
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)

  const projected = useMemo(() => ({
    buildings: dataset.buildings.map((b) => ({ ...b, xy: b.footprint.map((p) => projection.toXY(p)) })),
    trees: dataset.trees.map((t) => ({ ...t, xy: projection.toXY(t.position) })),
    parks: dataset.parks.map((p) => ({ ...p, xy: p.ring.map((q) => projection.toXY(q)) })),
  }), [dataset])
  const shadows = useMemo(
    () => (props.shadowOn ? buildShadowShapes(dataset.buildings, dataset.trees, sun, projection) : { buildings: [], trees: [] }),
    [dataset, sun, props.shadowOn],
  )

  /** 表示範囲の少し外まで描く */
  const inView = (p: XY) => Math.abs(p.x - view.x) < view.span * 0.7 && Math.abs(-p.y - view.y) < view.span * 0.7
  /** 画面 1px が SVG で何 m か。文字や吹き出しを画面上で同じ大きさに保つ */
  const metersPerPx = view.span / (svg.current?.getBoundingClientRect().width || 700)
  const lineScale = view.span / 1500
  const me = toSvg(location)
  const sky = weatherPalette(skyPalette(sun.altitude), weather)

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('[data-marker]')) return
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    // 6px までは手ぶれとみなし、タップとして扱う
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true
    if (!d.moved) return
    const k = view.span / (svg.current?.getBoundingClientRect().width || 700)
    setView((v) => ({ ...v, x: d.vx - dx * k, y: d.vy - dy * k }))
  }
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    drag.current = null
    if (!adding || !d || d.moved) return
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(e.currentTarget.getScreenCTM()!.inverse())
    props.onPoint(projection.toLatLng({ x: p.x, y: -p.y }))
  }

  return (
    <svg
      ref={svg}
      className="model-map"
      viewBox={`${view.x - view.span / 2} ${view.y - view.span * 0.48} ${view.span} ${view.span * 0.96}`}
      role="group"
      aria-label="OSMの建物と地点を示すモデル地図"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <defs>
        <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1.5" fill="#d9dece" />
        </pattern>
      </defs>
      <rect x="-6000" y="-6000" width="12000" height="12000" fill="#eff0e3" />
      <rect x="-6000" y="-6000" width="12000" height="12000" fill="url(#grid)" />

      {projected.parks.map((p) => (
        <polygon key={p.id} points={pointsAttr(p.xy)} fill="#d5dfba" stroke="#c8d3b0" strokeWidth="2" />
      ))}

      <g opacity=".19" fill="#355c50">
        {shadows.buildings.map((ring, i) => <polygon key={'b' + i} points={pointsAttr(ring)} />)}
        {shadows.trees.map((ring, i) => <polygon key={'t' + i} points={pointsAttr(ring)} />)}
      </g>

      {projected.buildings.filter((b) => b.xy.some(inView)).map((b) => (
        <polygon
          key={b.id}
          points={pointsAttr(b.xy)}
          fill={b.kind === 'roof' ? '#d0dbbd' : '#e1e2d3'}
          stroke="#c4cbb8"
          strokeWidth="1.5"
        />
      ))}

      {projected.trees.filter((t) => inView(t.xy)).map((t) => (
        <circle key={t.id} cx={t.xy.x} cy={-t.xy.y} r={Math.max(3, t.crownRadius)} fill="#a6ba90" opacity=".9" />
      ))}

      {sky.tintOpacity > 0.01 && (
        <rect
          className="sky-tint" x="-6000" y="-6000" width="12000" height="12000"
          fill={sky.tint} opacity={sky.tintOpacity} style={{ mixBlendMode: 'multiply' }} pointerEvents="none"
        />
      )}

      {route?.length ? <RouteLine route={route} scale={lineScale} /> : null}

      <circle cx={me.x} cy={me.y} r={28 * lineScale} fill="#6b93c1" opacity=".15" />
      <circle cx={me.x} cy={me.y} r={8 * lineScale} fill="#5a8ec3" stroke="white" strokeWidth="3" />

      {spots.filter((s) => inView(projection.toXY(s.position))).map((s) => (
        <SpotMarker
          key={s.id}
          spot={s}
          active={s.id === selected}
          level={levels?.get(s.id)}
          scale={view.span / 1250}
          hideName={!!bubbles?.some((b) => b.id === s.id)}
          onSelect={props.onSelect}
        />
      ))}

      {props.showLabels && (
        <g className="svg-landmarks" pointerEvents="none">
          {LANDMARKS.filter((l) => l.rank === 1 || view.span < 1800).map((l) => {
            const p = toSvg(l.position)
            return (
              <text
                key={l.label} x={p.x} y={p.y - 14 * metersPerPx} textAnchor="middle"
                fontSize={11 * metersPerPx} fontWeight="700" fill="#33373c"
                stroke="#fbfaf5" strokeWidth={3.2 * metersPerPx} paintOrder="stroke"
              >
                {l.label}
              </text>
            )
          })}
        </g>
      )}

      {/* 先頭（1 位）を最後に描いて、いちばん上に重ねる */}
      {bubbles?.slice().reverse().map((b) => (
        <BubbleMarker key={'bubble' + b.id} bubble={b} scale={metersPerPx} onBubble={props.onBubble} />
      ))}
    </svg>
  )
}

/** 歩くルート。白い縁取りの上に、日陰・日なた・不明で色分けした区間を重ねる */
function RouteLine({ route, scale }: { route: RouteSegment[]; scale: number }) {
  const stateColor = (state: RouteSegment['state']) => (state === 'shade' ? '#3d5f86' : state === 'sun' ? '#f0952c' : '#8a9099')
  return (
    <g className="route-line" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={latLngPoints(route.flatMap((s) => s.points))} stroke="#ffffff" strokeWidth={11 * scale} />
      {route.map((s, i) => (
        <polyline key={i} points={latLngPoints(s.points)} stroke={stateColor(s.state)} strokeWidth={6 * scale} />
      ))}
    </g>
  )
}

interface SpotMarkerProps {
  spot: Spot
  active: boolean
  level: SeatLevel | undefined
  scale: number
  /** 吹き出しが出ている地点では名前の札を出さない */
  hideName: boolean
  onSelect: (id: string) => void
}

function SpotMarker({ spot, active, level, scale, hideName, onSelect }: SpotMarkerProps) {
  const p = toSvg(spot.position)
  const Icon = kindIcons[spot.kind]
  const levelColor = level ? LEVEL_COLOR[level] : null
  const select = () => onSelect(spot.id)

  // 選択中は濃い緑、空席の目安があればその色、なければ座れる地点を少し明るく
  const fill = active ? '#284e42' : levelColor ?? (isSeatSpot(spot) ? '#fffdf4' : '#f2f5e9')
  const stroke = active ? levelColor ?? '#dceb9c' : levelColor ? '#ffffff' : '#bfcdb8'
  const strokeWidth = active ? 5 : levelColor ? 2.5 : 1.5
  const iconColor = active ? '#ecf1c9' : levelColor ? '#ffffff' : '#4e6956'

  return (
    <g
      data-marker
      role="button"
      tabIndex={0}
      aria-label={spotName(spot)}
      className={'map-marker ' + (active ? 'active' : '')}
      transform={`translate(${p.x} ${p.y}) scale(${scale})`}
      onClick={(e) => { e.stopPropagation(); select() }}
      onKeyDown={activateOnKey(select)}
    >
      <circle r={active ? 23 : 16} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      <g transform="translate(-8 -8)">
        <Icon size={16} color={iconColor} strokeWidth={1.8} />
      </g>
      {active && !hideName && (
        <g>
          <rect x="-91" y="-62" width="182" height="29" rx="14.5" fill="#284e42" />
          <text y="-43" textAnchor="middle" fill="white" fontSize="12">{spotName(spot).slice(0, 14)}</text>
        </g>
      )}
    </g>
  )
}

/** 候補の吹き出し。kind==='pick' はおすすめ（黄色の「!」）、それ以外は順位つき */
function BubbleMarker({ bubble: b, scale, onBubble }: { bubble: Bubble; scale: number; onBubble?: (id: string) => void }) {
  const p = toSvg(b.position)
  const pick = b.kind === 'pick'
  const fill = pick ? '#ffd24d' : '#fffdf7'
  const ring = pick ? '#ffffff' : b.level ? LEVEL_COLOR[b.level] : '#cfd6cc'
  const r = pick ? 24 : 19
  const cy = -r - 22
  const open = () => onBubble?.(b.id)

  return (
    <g
      data-marker
      role="button"
      tabIndex={0}
      aria-label={pick ? `おすすめ: ${b.label}` : `候補${b.rank}: ${b.label}`}
      className={'svg-bubble' + (b.active ? ' is-active' : '')}
      transform={`translate(${p.x} ${p.y}) scale(${scale * (b.active ? 1.12 : 1)})`}
      onClick={(e) => { e.stopPropagation(); open() }}
      onKeyDown={activateOnKey(open)}
    >
      <path d={`M -9 ${-r - 14} L 0 -10 L 9 ${-r - 14} Z`} fill={ring} />
      <circle cy={cy} r={r} fill={fill} stroke={ring} strokeWidth="3.5" />
      {b.active && <circle cy={cy} r={r + 6} fill="none" stroke="#ffffff" strokeWidth="3" opacity=".8" />}
      {pick ? (
        <text y={-r - 11} textAnchor="middle" fontSize="30" fontWeight="900" fill="#3a2a00">!</text>
      ) : (
        <>
          <g transform={`translate(-9 ${-r - 31})`}>
            <Bench size={18} color={ring} strokeWidth={2.2} />
          </g>
          <circle cx={r - 3} cy={-2 * r - 17} r="9" fill="#3a3d42" stroke="#fffdf7" strokeWidth="2" />
          <text x={r - 3} y={-2 * r - 13} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{b.rank}</text>
        </>
      )}
    </g>
  )
}

/* ── 天気の重ね表示 ─────────────────────────── */

function WeatherOverlay({ weather, mode }: { weather: WeatherCondition; mode: MapMode }) {
  const falling = weather === 'rain' || weather === 'heavy-rain' || weather === 'snow'
  const Icon = weather === 'snow' ? Snowflake : weather === 'rain' || weather === 'heavy-rain' ? CloudRain : Cloud
  return (
    <>
      {/* 3D は CityMap が自前で雨・雪を描く */}
      {falling && mode !== 'model3d' && <div className={'weather-fx fx-' + weather} aria-hidden="true" />}
      {OVERCAST.has(weather) && (
        <div className="weather-badge" role="status">
          <Icon size={13} />
          {WEATHER_LABEL[weather]}
          <small>日差しなし・街全体が日陰</small>
        </div>
      )}
    </>
  )
}

/* ── 地図全体 ───────────────────────────────── */

export default memo(function MapView(props: Props) {
  const { dataset, spots, selected, mode, apiKey, location, route, quality = 'balanced', weather } = props
  const city = useRef<CityHandle>(null)
  const googleEl = useRef<HTMLDivElement>(null)
  const [bearing, setBearing] = useState(0)
  const [view, setView] = useState<View>(INITIAL_VIEW)
  const isModel3d = mode === 'model3d'

  const useGoogle = useGoogleMap(googleEl, mode, apiKey, spots, selected, props)

  // 選んだ地点が画面の端寄りなら、そこへ寄せる
  const spotsRef = useRef(spots)
  spotsRef.current = spots
  useEffect(() => {
    const spot = spotsRef.current.find((s) => s.id === selected)
    if (!spot) return
    const p = toSvg(spot.position)
    setView((v) => (Math.abs(p.x - v.x) > v.span * 0.32 || Math.abs(p.y - v.y) > v.span * 0.26 ? { ...v, x: p.x, y: p.y } : v))
  }, [selected])

  // 新しいルートが出たら、2D の表示範囲をルート全体に合わせる（同じ始点・終点なら動かさない）
  const routeStart = route?.[0]?.points[0]
  const routeEnd = route?.at(-1)?.points.at(-1)
  const routeKey = routeStart && routeEnd ? `${routeStart.lat},${routeStart.lng}>${routeEnd.lat},${routeEnd.lng}` : ''
  useEffect(() => {
    if (!route?.length) return
    const pts = route.flatMap((s) => s.points).map(toSvg)
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    setView({
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      span: Math.min(MAX_SPAN, Math.max(500, (maxX - minX) * 1.3, (maxY - minY) * 1.45)),
    })
    // routeKey が同じなら合わせ直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey])

  const zoomIn = () => (isModel3d ? city.current?.zoom(0.8) : setView((v) => ({ ...v, span: Math.max(MIN_SPAN, v.span * ZOOM_STEP) })))
  const zoomOut = () => (isModel3d ? city.current?.zoom(1.25) : setView((v) => ({ ...v, span: Math.min(MAX_SPAN, v.span / ZOOM_STEP) })))
  const locate = () => {
    if (isModel3d) return city.current?.locate(location)
    const p = toSvg(location)
    setView((v) => ({ ...v, x: p.x, y: p.y }))
  }
  const showAll = () => (isModel3d ? city.current?.reset() : setView(WHOLE_AREA))
  const fallBackTo2d = (message: string) => {
    props.onError(message)
    props.onMode('model2d')
  }

  let canvas
  if (useGoogle) {
    canvas = <div ref={googleEl} className="google-map" aria-label="Google Maps" />
  } else if (isModel3d) {
    canvas = (
      <Suspense fallback={<div className="scene-loading"><span />3Dマップを読み込んでいます</div>}>
        <CityMap
          ref={city}
          dataset={dataset} spots={spots} selected={selected} sun={props.sun} day={props.day} minutes={props.minutes}
          showPath={props.showPath} showShadow={props.showShadow} adding={props.adding}
          onSelect={props.onSelect} onPoint={props.onPoint} onBearing={setBearing}
          route={route} levels={props.levels} bubbles={props.bubbles} onBubble={props.onBubble}
          showLabels={props.showLabels ?? true} weather={weather} quality={quality}
          onError={fallBackTo2d}
        />
      </Suspense>
    )
  } else {
    canvas = (
      <ModelMap
        dataset={dataset} spots={spots} selected={selected} sun={props.sun} location={location}
        adding={props.adding} onSelect={props.onSelect} onPoint={props.onPoint}
        route={route} levels={props.levels} bubbles={props.bubbles} onBubble={props.onBubble} weather={weather}
        view={view} setView={setView}
        shadowOn={props.showShadow && mode === 'model2d'}
        showLabels={props.showLabels ?? true}
      />
    )
  }

  return (
    <div className={`map-content ${props.adding ? 'adding' : ''}`}>
      {canvas}
      {weather && <WeatherOverlay weather={weather} mode={mode} />}

      {/* 2D は Google 地図（キーがなければモデル地図）、3D は OSM のモデル */}
      <div className="map-mode">
        <button aria-label="2D地図" aria-pressed={mode === 'model2d' || mode === 'google2d'} onClick={() => props.onMode(apiKey.trim() ? 'google2d' : 'model2d')}>2D</button>
        <button aria-label="3Dモデル" aria-pressed={isModel3d} onClick={() => props.onMode('model3d')}>3D</button>
        {useGoogle && <span>Google {mode === 'google3d' ? '3D' : '2D'}</span>}
      </div>

      <button className="north" aria-label="北を上に" onClick={() => city.current?.north()}>
        <Navigation size={17} fill="currentColor" style={{ transform: `rotate(${isModel3d ? -bearing : 0}deg)` }} />
        <span>N</span>
      </button>

      {!useGoogle && (
        <div className="map-tools">
          <button aria-label="拡大" onClick={zoomIn}><Plus size={19} /></button>
          <button aria-label="縮小" onClick={zoomOut}><Minus size={19} /></button>
          <button aria-label="基準地点に戻る" onClick={locate}><LocateFixed size={19} /></button>
          <button aria-label={isModel3d ? '最初の視点に戻る' : 'エリア全体'} onClick={showAll}><MapPin size={19} /></button>
        </div>
      )}

      {props.onQuality && (
        <button className="quality-toggle" aria-pressed={quality === 'light'} onClick={props.onQuality}>
          {quality === 'light' ? '軽量表示' : '標準表示'}
        </button>
      )}

      <div className="map-key">
        <span><i className="shade-dot" />予測される日陰</span>
        <span><i className="origin-dot" />{location.lat === DEMO_USER_LOCATION.lat ? '基準地点（桜木町）' : '端末の現在地'}</span>
      </div>

      <p className="attribution">
        {useGoogle ? '日陰判定はOSM由来の別モデル · ' : ''}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
        {dataset.meta.plateauBuildings ? (
          <> · <a href="https://www.mlit.go.jp/plateau/site-policy/" target="_blank" rel="noreferrer">PLATEAU 横浜2024・加工</a></>
        ) : null}
        {' · '}
        {useGoogle ? '' : '建物・公園のモデル表示'}
      </p>
    </div>
  )
})
