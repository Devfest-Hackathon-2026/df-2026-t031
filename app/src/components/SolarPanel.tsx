// 2026-11-10 期間内に書き直し。
// 左上（スマホでは下）の「太陽と日陰」パネル。
// 太陽の方位・高度・影の長さ、その日の日の出・南中・日の入り、いまの天気を出す。
// スマホ幅ではボトムシートになり、つまみを上下にドラッグするかタップで開閉する。

import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { ArrowUpRight, ChevronRight, ChevronUp, Cloud, Compass, Info, Leaf, Sun, Sunrise, Sunset, X } from 'lucide-react'
import { AREA_CENTER } from '../domain/area.ts'
import { directionLabel } from '../domain/sun.ts'
import { nextSolarMoment, shadowRatio, solarMoments, solarTrack } from '../domain/solarScene.ts'
import { formatDateJa, formatTime } from '../domain/time.ts'
import { WEATHER_LABEL } from '../lib/weather.ts'
import type { SunPosition, WeatherHour } from '../domain/types.ts'
import SunDialCard from './SunDialCard.tsx'

interface Props {
  day: string
  minutes: number
  sun: SunPosition
  weather: WeatherHour
  weatherSource: string
  onTime: (minutes: number) => void
  onSettings: () => void
  onAbout: () => void
  open: boolean
  onToggle: () => void
}

const SHEET_QUERY = '(max-width:760px)'
/** これ以上動いたらタップではなくドラッグとみなす（px） */
const DRAG_START = 6
/** 開いているときは下へこれ以上、閉じているときは上へこれ以上引くと開閉する（px） */
const CLOSE_PULL = 60
const OPEN_PULL = 30

/** 0〜1439 分に丸めて "HH:MM"。無ければダッシュ */
function clock(m: number | null): string {
  if (m === null) return '—'
  return formatTime(((m % 1440) + 1440) % 1440)
}

/** 「あと 1 時間 5 分」のような残り時間 */
function remaining(min: number): string {
  if (min < 60) return `あと${min}分`
  const rest = min % 60
  return `あと${Math.floor(min / 60)}時間${rest ? `${rest}分` : ''}`
}

/** ボトムシートのドラッグ。指に少しだけ追従させ、離したときに開閉を決める */
function useSheetDrag(open: boolean, onToggle: () => void) {
  const start = useRef<{ y: number; moved: boolean } | null>(null)
  // ドラッグ直後に発生する click で二重に開閉しないためのフラグ
  const swallowClick = useRef(false)
  const [pull, setPull] = useState(0)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    swallowClick.current = false
    if (e.button !== 0 || !matchMedia(SHEET_QUERY).matches) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { y: e.clientY, moved: false }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    if (!s) return
    const dy = e.clientY - s.y
    if (!s.moved && Math.abs(dy) > DRAG_START) s.moved = true
    if (!s.moved) return
    // 開いているときは下方向だけそのまま、閉じているときは上方向に弱く（最大 48px）
    setPull(open ? Math.max(0, dy) : Math.min(0, Math.max(-48, dy * 0.35)))
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    start.current = null
    setPull(0)
    if (!s) return
    swallowClick.current = true
    setTimeout(() => { swallowClick.current = false }, 400)
    const dy = e.clientY - s.y
    const farEnough = open ? dy > CLOSE_PULL : dy < -OPEN_PULL
    if (!s.moved || farEnough) onToggle()
  }

  const onPointerCancel = () => {
    start.current = null
    setPull(0)
  }

  /** つまみのボタンの click。ドラッグで処理済みなら無視する */
  const onSummaryClick = () => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    onToggle()
  }

  return { pull, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }, onSummaryClick }
}

export default function SolarPanel({ day, minutes, sun, weather, weatherSource, onSettings, onAbout, open, onToggle }: Props) {
  const moments = useMemo(() => solarMoments(day, AREA_CENTER), [day])
  const track = useMemo(() => solarTrack(day, AREA_CENTER, 1), [day])
  const ratio = shadowRatio(sun.altitude)
  const next = nextSolarMoment(moments, minutes)
  const direction = directionLabel(sun.azimuth)
  const { pull, handlers, onSummaryClick } = useSheetDrag(open, onToggle)

  const className = ['solar-panel', 'glass-panel', open && 'is-open', pull && 'is-dragging'].filter(Boolean).join(' ')
  const style = pull ? ({ '--sheet-pull': `${pull}px` } as CSSProperties) : undefined
  const toggleLabel = open ? '太陽パネルを閉じる' : '太陽パネルを開く'

  return (
    <aside className={className} style={style} aria-label="太陽と日陰の情報">
      <div className="solar-sheet-top" {...handlers}>
        <span className="sheet-grabber" aria-hidden="true" />
        <button className="solar-mobile-summary" aria-expanded={open} aria-label={toggleLabel} onClick={onSummaryClick}>
          <Sun className="summary-sun" size={19} />
          <span className="mini-dial" aria-hidden="true">
            <SunDialCard sun={sun} track={track} />
          </span>
          <span className="summary-copy">
            <span>太陽と日陰</span>
            {next && <em>次は{next.label} {clock(next.at)} · {remaining(next.inMin)}</em>}
          </span>
          <strong>
            {Math.round(sun.altitude)}°<small>{direction}</small>
          </strong>
          <ChevronRight className="summary-chevron" size={17} />
          <ChevronUp className="summary-up" size={19} />
        </button>
      </div>

      <div className="solar-scroll">
        <div className="solar-heading">
          <span>LIGHT & SHADE</span>
          <button aria-label="太陽パネルを閉じる" onClick={onToggle}>
            <X size={16} />
          </button>
        </div>

        <SunDialCard sun={sun} track={track} />

        <button className="solar-weather" onClick={onSettings}>
          <span>
            <small>天気</small>
            <strong>
              {weather.condition === 'clear' ? <Sun className="weather-sun" size={27} /> : <Cloud size={27} />}{' '}
              {WEATHER_LABEL[weather.condition]}
            </strong>
            <i>
              {Math.round(weather.temperatureC)}°C <b>· {weatherSource}</b>
            </i>
          </span>
          <ChevronRight size={21} />
        </button>

        <div className="solar-metrics">
          <div>
            <span>方位角 <Compass size={13} /></span>
            <strong>{Math.round(sun.azimuth)}° <small>{direction}</small></strong>
            <i>太陽の方位</i>
          </div>
          <div>
            <span>高度 <ArrowUpRight size={14} /></span>
            <strong>{Math.round(sun.altitude)}°</strong>
            <i>太陽の高度</i>
          </div>
          <div>
            <span>日影比率</span>
            <strong>{ratio === null ? '—' : `${ratio.toFixed(1)}×`}</strong>
            <i>高さに対する影の長さ</i>
          </div>
        </div>

        <div className="solar-day-heading">
          <span>{formatDateJa(day)}</span>
          <small>日本時間</small>
        </div>
        <div className="solar-sunline">
          <span><Sunrise size={16} strokeWidth={1.6} />日の出 {clock(moments.sunrise)}</span>
          <span><Sun size={16} strokeWidth={1.6} />南中 {clock(moments.noon)}</span>
          <span><Sunset size={16} strokeWidth={1.6} />日の入り {clock(moments.sunset)}</span>
        </div>

        <p className="solar-hint">ベンチの日陰は、地図の上のおすすめと「休憩スポット」で、着く時刻に合わせて表示します。</p>
        <div className="solar-panel-note">
          <Leaf size={14} />
          <span>太陽の動きに合わせて、<br />心地いいひと休みを見つけよう。</span>
        </div>
        <button className="solar-about" onClick={onAbout}>
          <Info size={12} />データと予測について<ArrowUpRight size={12} />
        </button>
      </div>
    </aside>
  )
}
