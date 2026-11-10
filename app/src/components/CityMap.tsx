// 2026-11-10 期間内に書き直し。
// 3D の街（Three.js）。建物・日時計・太陽・雨や雪・徒歩ルート・スポットの印を描き、
// 吹き出しや目印の名前は HTML を 3D の位置に重ねて出す。

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Armchair } from 'lucide-react'
import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createCity, createContext, disposeObject, worldPoint, strip, tintByHeight, type CityContext } from './cityGeometry.ts'
import { LANDMARKS } from '../domain/landmarks.ts'
import { solarTrack, solarVector } from '../domain/solarScene.ts'
import { skyPalette, weatherPalette, WEATHER_LOOK } from '../domain/skyPalette.ts'
import { AREA_CENTER, EXPLORER_FOCUS } from '../domain/area.ts'
import { formatTime } from '../domain/time.ts'
import type { AreaDataset, LatLng, Spot, SunPosition, WeatherCondition } from '../domain/types.ts'
import type { RouteSegment } from '../domain/route.ts'
import type { SeatLevel } from '../domain/seat.ts'

/** 空席確率による色: 緑＝座れそう・黄＝五分五分・赤＝混みそう */
export const LEVEL_COLOR: Record<SeatLevel, string> = { high: '#4f9d69', mid: '#dcae35', low: '#d9604c' }

/** 親（App）から視点を動かすための口 */
export interface CityHandle {
  zoom: (factor: number) => void
  locate: (p: LatLng) => void
  reset: () => void
  north: () => void
}

/** 建物の上に浮かぶ吹き出しのピン。pick＝一番のおすすめ（「!」）、cand＝ほかの候補（ベンチと順位） */
export interface Bubble {
  id: string
  position: LatLng
  kind: 'pick' | 'cand'
  rank: number
  level?: SeatLevel
  active: boolean
  label: string
}

interface Props {
  dataset: AreaDataset
  spots: Spot[]
  selected: string
  sun: SunPosition
  day: string
  minutes: number
  showShadow: boolean
  showPath: boolean
  adding: boolean
  onSelect: (id: string) => void
  onPoint: (p: LatLng) => void
  onError: (message: string) => void
  onBearing?: (degrees: number) => void
  route?: RouteSegment[] | null
  levels?: ReadonlyMap<string, SeatLevel>
  quality?: 'balanced' | 'light'
  bubbles?: Bubble[]
  onBubble?: (id: string) => void
  showLabels?: boolean
  weather?: WeatherCondition
}

/** 一度作った 3D の部品と、あとから差し替える部品 */
interface Runtime {
  scene: T.Scene
  camera: T.PerspectiveCamera
  controls: OrbitControls
  /** 日時計（日付が変わると作り直す） */
  dial: T.Group
  markers: T.InstancedMesh | null
  route: T.Group | null
  anchor: T.Vector3
  invalidate: () => void
  flyTo: (target: T.Vector3, distance?: number) => void
  reset: () => void
}

const DEFAULT_FOCUS = EXPLORER_FOCUS
/** 日時計の半径（m） */
const RADIUS = 145
const SPOT_FALLBACK = '休憩スポット'
const ROUTE_COLOR = { shade: '#3d5f86', sun: '#f0952c', night: '#8a9099' } as const
const EARTH_RADIUS = 6371008.8
/** 動かしたとみなさず「タップ」と判断するずれ（px） */
const TAP_SLOP = 6
/** 視点を寄せるときの 1 フレームの割合 */
const FLY_STEP = 0.12

const lookOf = (c: WeatherCondition | undefined) => WEATHER_LOOK[c ?? 'clear'] ?? WEATHER_LOOK.clear

function makeLine(points: T.Vector3[], color: string, opacity = 1) {
  const material = new T.LineBasicMaterial({ color, transparent: opacity < 1, opacity })
  return new T.Line(new T.BufferGeometry().setFromPoints(points), material)
}

/** 中心から azimuth の向きへ、from〜to の距離に地面の帯を置く */
function radialBar(azimuth: number, from: number, to: number, width: number, color: string, y = 0.7) {
  const length = to - from
  const geometry = new T.PlaneGeometry(width, length)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, y, -(from + length / 2))
  const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }))
  mesh.rotation.y = (-azimuth * Math.PI) / 180
  mesh.renderOrder = 2
  return mesh
}

/** 日時計: 地平線の円・15° ごとの目盛り・北の印・日の出／日の入りの向き・太陽の通り道・中心の石柱 */
function buildSunDial(day: string, anchor: T.Vector3): T.Group {
  const dial = new T.Group()
  dial.position.copy(anchor)
  const track = solarTrack(day, AREA_CENTER, RADIUS)

  if (track.length >= 2) {
    const curve = new T.CatmullRomCurve3(track.map(({ point }) => new T.Vector3(point.x, point.y, point.z)))
    dial.add(new T.Mesh(new T.TubeGeometry(curve, 120, 0.9, 6, false), new T.MeshBasicMaterial({ color: '#3a3d42', transparent: true, opacity: 0.82 })))
  }
  // 1 時間ごとの白い点
  for (const { minute, point } of track) {
    if (minute % 60 !== 0) continue
    const dot = new T.Mesh(new T.SphereGeometry(1.3, 8, 6), new T.MeshBasicMaterial({ color: '#ffffff' }))
    dot.position.set(point.x, point.y, point.z)
    dial.add(dot)
  }

  const ring: T.Vector3[] = []
  for (let i = 0; i <= 160; i++) {
    const a = (i / 160) * Math.PI * 2
    ring.push(new T.Vector3(Math.sin(a) * RADIUS, 0.5, Math.cos(a) * RADIUS))
  }
  dial.add(makeLine(ring, '#55595f', 0.42))

  for (let deg = 15; deg < 360; deg += 15) {
    const major = deg % 90 === 0
    dial.add(radialBar(deg, RADIUS * (major ? 0.9 : 0.94), RADIUS * 0.99, major ? 1.1 : 0.7, '#6b6f76', 0.55))
  }

  const arrow = new T.Shape()
  arrow.moveTo(0, RADIUS * 1.05)
  arrow.lineTo(-3.6, RADIUS * 0.95)
  arrow.lineTo(3.6, RADIUS * 0.95)
  arrow.closePath()
  const north = new T.Mesh(new T.ShapeGeometry(arrow), new T.MeshBasicMaterial({ color: '#e4483b', side: T.DoubleSide, depthWrite: false }))
  north.rotation.x = -Math.PI / 2
  north.position.y = 0.75
  north.renderOrder = 2
  dial.add(north)

  if (track.length >= 2) {
    dial.add(radialBar(track[0].sun.azimuth, 4, RADIUS, 1.7, '#f29d38')) // 日の出
    dial.add(radialBar(track[track.length - 1].sun.azimuth, 4, RADIUS, 1.7, '#6f8ea8')) // 日の入り
  }

  const pillar = new T.Mesh(new T.BoxGeometry(7, 11, 7), new T.MeshStandardMaterial({ color: '#f8f8f9', roughness: 0.6 }))
  pillar.position.y = 5.5
  pillar.castShadow = true
  pillar.receiveShadow = true
  dial.add(pillar)
  return dial
}

function createRenderer(light: boolean): T.WebGLRenderer {
  const renderer = new T.WebGLRenderer({ antialias: !light, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  const maxRatio = light ? 1 : innerWidth < 700 ? 1.35 : 1.75
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxRatio))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = T.PCFShadowMap
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.22
  renderer.domElement.tabIndex = 0
  renderer.domElement.setAttribute('aria-label', '3D都市。ドラッグで回転、ホイールまたはピンチで拡大縮小。')
  return renderer
}

function createSunLight(light: boolean): T.DirectionalLight {
  const sun = new T.DirectionalLight('#fff3df', 3)
  const size = light ? 1024 : innerWidth < 700 ? 1536 : 2048
  sun.castShadow = true
  sun.shadow.mapSize.set(size, size)
  Object.assign(sun.shadow.camera, { left: -650, right: 650, top: 650, bottom: -650, near: 5, far: 3200 })
  sun.shadow.normalBias = 0.32
  sun.shadow.bias = -0.00008
  sun.shadow.radius = 3
  return sun
}

/** 雨・雪の粒。カメラの前の箱の中を落とし続ける線分の集まり */
function createPrecipitation(count: number) {
  const positions = new Float32Array(count * 6)
  const seeds = Float32Array.from({ length: count * 3 }, () => Math.random())
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3))
  const material = new T.LineBasicMaterial({ color: '#e4ebf2', transparent: true, opacity: 0.5, depthWrite: false })
  const mesh = new T.LineSegments(geometry, material)
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.renderOrder = 6

  function update(kind: 'rain' | 'snow', amount: number, seconds: number, center: T.Vector3, distance: number) {
    const rain = kind === 'rain'
    const box = Math.max(140, Math.min(700, distance * 0.75))
    const height = box * 0.8
    const visible = Math.round(count * amount)
    const speed = rain ? height * 1.3 : height * 0.1
    const length = rain ? height * 0.045 : height * 0.008
    for (let i = 0; i < visible; i++) {
      const sx = seeds[i * 3]
      const sy = seeds[i * 3 + 1]
      const sz = seeds[i * 3 + 2]
      const fall = (sy * height + seconds * speed * (0.8 + sz * 0.4)) % height
      const sway = rain ? 0 : Math.sin(seconds * 1.3 + sx * 20) * height * 0.015
      const x = center.x + (sx - 0.5) * box + sway
      const y = center.y + height / 2 - fall
      const z = center.z + (sz - 0.5) * box
      positions.set([x, y, z, x + length * (rain ? 0.12 : 0.3), y - length, z], i * 6)
    }
    geometry.setDrawRange(0, visible * 2)
    geometry.attributes.position.needsUpdate = true
    material.color.set(rain ? '#dfe6ee' : '#ffffff')
    material.opacity = rain ? 0.42 + amount * 0.18 : 0.85
  }
  return { mesh, update }
}

/** 徒歩ルート: 白いふちの上に、日陰の区間は濃い青、日なたは橙、夜は灰色で地面に描く */
function buildRoute(segments: RouteSegment[]): T.Group {
  const group = new T.Group()
  const paint = (color: string) => new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.96, depthWrite: false, side: T.DoubleSide })
  const pairs = (s: RouteSegment) => s.points.map((p) => [p.lat, p.lng] as [number, number])

  const edge = new T.Mesh(strip(segments.flatMap(pairs), 7.5, 0.85), paint('#ffffff'))
  edge.renderOrder = 3
  group.add(edge)
  for (const s of segments) {
    const line = new T.Mesh(strip(pairs(s), 4.4, 0.9), paint(ROUTE_COLOR[s.state as keyof typeof ROUTE_COLOR] ?? ROUTE_COLOR.night))
    line.renderOrder = 4
    group.add(line)
  }

  const ends: [LatLng, string][] = [
    [segments[0].points[0], '#4f86c6'],
    [segments[segments.length - 1].points.at(-1)!, '#2f6b4f'],
  ]
  for (const [p, color] of ends) {
    const pin = new T.Mesh(new T.CylinderGeometry(4.5, 4.5, 2, 20), new T.MeshBasicMaterial({ color }))
    pin.position.copy(worldPoint(p, 1.2))
    pin.renderOrder = 5
    group.add(pin)
  }
  return group
}

/** ルート全体が画面に入るための中心と距離 */
function routeFrame(segments: RouteSegment[], aspect: number) {
  const box = new T.Box3()
  for (const s of segments) for (const p of s.points) box.expandByPoint(worldPoint(p))
  const size = box.getSize(new T.Vector3())
  const distance = Math.min(2000, Math.max(380, (Math.max(size.x, size.z) * 1.25) / Math.min(1, aspect * 1.4)))
  return { center: box.getCenter(new T.Vector3()), distance }
}

/** スポットの印（球）。選択中は大きく浮かせ、空席の見込みがあればその色にする */
function buildMarkers(spots: Spot[], selected: string, levels?: ReadonlyMap<string, SeatLevel>): T.InstancedMesh {
  const markers = new T.InstancedMesh(new T.SphereGeometry(2.4, 8, 6), new T.MeshBasicMaterial({ color: '#ffffff', depthTest: false }), spots.length)
  markers.renderOrder = 3
  const dummy = new T.Object3D()
  spots.forEach((spot, i) => {
    const active = spot.id === selected
    dummy.position.copy(worldPoint(spot.position, active ? 5 : 3))
    dummy.scale.setScalar(active ? 2 : 1)
    dummy.updateMatrix()
    markers.setMatrixAt(i, dummy.matrix)
    const level = levels?.get(spot.id)
    markers.setColorAt(i, new T.Color(level ? LEVEL_COLOR[level] : active ? '#f9c874' : '#7194a2'))
  })
  markers.computeBoundingSphere()
  return markers
}

/** 地面上の点（m）を緯度経度に戻す */
function cityToGeo(p: T.Vector3): LatLng {
  const rad = Math.PI / 180
  return {
    lat: AREA_CENTER.lat - p.z / (EARTH_RADIUS * rad),
    lng: AREA_CENTER.lng + p.x / (EARTH_RADIUS * rad * Math.cos(AREA_CENTER.lat * rad)),
  }
}

const CityMap = forwardRef<CityHandle, Props>(function CityMap(props, ref) {
  const container = useRef<HTMLDivElement>(null)
  const sunLabel = useRef<HTMLDivElement>(null)
  const selectedLabel = useRef<HTMLDivElement>(null)
  const bubbleEls = useRef(new Map<string, HTMLDivElement>())
  const landmarkEls = useRef<(HTMLDivElement | null)[]>([])
  const runtime = useRef<Runtime | null>(null)
  // 作り直したときに元の視点へ戻すため
  const savedView = useRef<{ position: T.Vector3; target: T.Vector3 } | null>(null)
  const latest = useRef(props)
  latest.current = props
  const [ready, setReady] = useState(false)

  useImperativeHandle(ref, () => ({
    zoom(factor) {
      const r = runtime.current
      if (!r) return
      r.camera.position.sub(r.controls.target).multiplyScalar(factor).add(r.controls.target)
      r.controls.update()
      r.invalidate()
    },
    locate(p) {
      runtime.current?.flyTo(worldPoint(p))
    },
    reset() {
      runtime.current?.reset()
    },
    north() {
      const r = runtime.current
      if (!r) return
      const distance = r.camera.position.distanceTo(r.controls.target)
      r.camera.position.copy(r.controls.target).add(new T.Vector3(0, distance * 0.65, distance * 0.8))
      r.controls.update()
      r.invalidate()
    },
  }), [])

  // 街・光・カメラを用意して描画ループを回す。データか画質が変わったら作り直す
  useEffect(() => {
    const element = container.current!
    const light = props.quality === 'light'
    let renderer: T.WebGLRenderer
    try {
      renderer = createRenderer(light)
    } catch {
      latest.current.onError('この端末では3Dを表示できないため、2Dモデルに切り替えます。')
      return
    }
    const canvas = renderer.domElement
    element.prepend(canvas)

    const scene = new T.Scene()
    scene.background = new T.Color('#efe6e2')
    scene.fog = new T.Fog('#efe6e2', 1700, 4000)

    const anchor = worldPoint(DEFAULT_FOCUS, 0.6)
    const camera = new T.PerspectiveCamera(43, 1, 1, 6000)
    camera.position.copy(anchor).add(new T.Vector3(300, 315, -360))
    const controls = new OrbitControls(camera, canvas)
    controls.target.copy(anchor)
    Object.assign(controls, {
      enableDamping: true, dampingFactor: 0.09,
      minPolarAngle: 0.12, maxPolarAngle: Math.PI * 0.46,
      minDistance: 100, maxDistance: 2100, maxTargetRadius: 2400,
      screenSpacePanning: false,
    })
    controls.listenToKeyEvents(canvas)
    controls.saveState()
    if (savedView.current) {
      camera.position.copy(savedView.current.position)
      controls.target.copy(savedView.current.target)
      controls.update()
    }

    const hemi = new T.HemisphereLight('#f6f5f3', '#a5a29b', 2.2)
    const sunLight = createSunLight(light)
    scene.add(hemi, sunLight, sunLight.target)

    const city = createCity(props.dataset, light)
    scene.add(city)
    const wheelLamps = (city.getObjectByName('ferris-wheel')?.userData.lights ?? []) as T.MeshStandardMaterial[]
    const windowDetail = city.getObjectByName('city-window-detail')

    const dial = buildSunDial(props.day, anchor)
    const sunOrb = new T.Mesh(new T.SphereGeometry(6, 20, 14), new T.MeshBasicMaterial({ color: '#fffdf1', depthTest: false }))
    sunOrb.renderOrder = 4
    sunOrb.add(new T.Mesh(new T.SphereGeometry(9.2, 16, 12), new T.MeshBasicMaterial({ color: '#ffedbd', transparent: true, opacity: 0.16, depthWrite: false })))
    const sunRay = makeLine([anchor.clone(), anchor.clone().add(new T.Vector3(RADIUS, 0, 0))], '#edac4d')
    const originDot = new T.Mesh(new T.CircleGeometry(3, 20), new T.MeshBasicMaterial({ color: '#6e9bba', side: T.DoubleSide }))
    originDot.rotation.x = -Math.PI / 2
    originDot.visible = false
    const precipitation = createPrecipitation(light ? 700 : 1800)
    scene.add(dial, sunOrb, sunRay, originDot, precipitation.mesh)

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    let dirty = true
    let flight: { target: T.Vector3; distance: number | null } | null = null
    const invalidate = () => { dirty = true }

    const r: Runtime = {
      scene, camera, controls, dial, markers: null, route: null, anchor, invalidate,
      flyTo(target, distance) {
        if (reducedMotion || light) {
          camera.position.add(target.clone().sub(controls.target))
          controls.target.copy(target)
          if (distance) camera.position.copy(controls.target).add(camera.position.clone().sub(controls.target).setLength(distance))
        } else {
          flight = { target: target.clone(), distance: distance ?? null }
        }
        dirty = true
      },
      reset() {
        flight = null
        controls.reset()
        dirty = true
      },
    }
    runtime.current = r
    controls.addEventListener('change', invalidate)

    // PLATEAU の建物モデルがあれば、仮の箱と入れ替える
    let disposed = false
    if (props.dataset.meta.plateauBuildings) {
      new GLTFLoader().load(
        `${import.meta.env.BASE_URL}data/plateau-nishi.glb`,
        (gltf) => {
          if (disposed) return disposeObject(gltf.scene)
          const fallback = city.getObjectByName('plateau-fallback')
          if (fallback) {
            city.remove(fallback)
            disposeObject(fallback)
          }
          gltf.scene.traverse((o) => {
            if (!(o instanceof T.Mesh)) return
            o.castShadow = true
            o.receiveShadow = true
            if (o.material instanceof T.MeshStandardMaterial) tintByHeight(o)
          })
          scene.add(gltf.scene)
          renderer.shadowMap.needsUpdate = true
          element.dataset.plateau = 'ready'
          invalidate()
        },
        undefined,
        () => {
          element.dataset.plateau = 'fallback'
          invalidate()
        },
      )
    }

    // 広い画面では右のパネルに隠れないよう、中心を少し左へずらす
    const resize = () => {
      const w = element.clientWidth
      const h = element.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.clearViewOffset()
      if (w > 900) camera.setViewOffset(w, h, -w * 0.105, 0, w, h)
      camera.updateProjectionMatrix()
      dirty = true
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()

    // 周辺の街（エリア外）の薄い形。なくても動く
    const contextFetch = new AbortController()
    fetch(`${import.meta.env.BASE_URL}data/area-context.json`, { signal: contextFetch.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((context: CityContext | null) => {
        if (!context?.features || contextFetch.signal.aborted) return
        scene.add(createContext(context))
        invalidate()
      })
      .catch(() => {})

    // タップ: 追加モードなら地面の位置を、そうでなければ当たったスポットを返す
    const raycaster = new T.Raycaster()
    const ground = new T.Plane(new T.Vector3(0, 1, 0), 0)
    let pressAt: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => { pressAt = { x: e.clientX, y: e.clientY } }
    const onUp = (e: PointerEvent) => {
      if (!pressAt || Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > TAP_SLOP) return
      const rect = canvas.getBoundingClientRect()
      const ndc = new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const p = latest.current
      if (p.adding) {
        const point = raycaster.ray.intersectPlane(ground, new T.Vector3())
        if (point) p.onPoint(cityToGeo(point))
        return
      }
      if (!r.markers) return
      const index = raycaster.intersectObject(r.markers)[0]?.instanceId
      const spot = index === undefined ? undefined : p.spots[index]
      if (spot) p.onSelect(spot.id)
    }
    const onLost = (e: Event) => {
      e.preventDefault()
      latest.current.onError('3D表示が中断されたため、2Dモデルに切り替えます。')
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('webglcontextlost', onLost)

    /** 3D の点を画面の px に。カメラの外なら null */
    const toScreen = (point: T.Vector3): [number, number] | null => {
      const v = point.clone().project(camera)
      if (v.z > 1 || v.z < -1) return null
      return [(v.x * 0.5 + 0.5) * element.clientWidth, (-v.y * 0.5 + 0.5) * element.clientHeight]
    }
    const pin = (el: HTMLDivElement | null, point: T.Vector3) => {
      if (!el) return
      const xy = toScreen(point)
      el.style.display = xy ? '' : 'none'
      if (xy) el.style.transform = `translate3d(${xy[0]}px,${xy[1]}px,0)`
    }

    const stepFlight = () => {
      if (!flight) return
      const move = flight.target.clone().sub(controls.target).multiplyScalar(FLY_STEP)
      controls.target.add(move)
      camera.position.add(move)
      if (flight.distance) {
        const offset = camera.position.clone().sub(controls.target)
        const d = offset.length()
        offset.setLength(d + (flight.distance - d) * FLY_STEP)
        camera.position.copy(controls.target).add(offset)
      }
      dirty = true
      if (move.length() < 0.06) flight = null
    }

    const applySky = (sun: SunPosition, look: ReturnType<typeof lookOf>) => {
      const p = latest.current
      const toSun = solarVector(sun, 1500)
      sunLight.position.copy(controls.target).add(new T.Vector3(toSun.x, Math.max(15, toSun.y), toSun.z))
      sunLight.target.position.copy(controls.target)
      const palette = weatherPalette(skyPalette(sun.altitude), p.weather)
      const lamp = sun.altitude > 2 ? 0 : sun.altitude > -4 ? 0.7 : 1.6
      for (const m of wheelLamps) m.emissiveIntensity = lamp
      sunLight.color.set(palette.sun)
      sunLight.intensity = palette.sunIntensity
      sunLight.castShadow = p.showShadow && sun.altitude > 2 && look.shadows
      hemi.color.set(palette.hemiSky)
      hemi.groundColor.set(palette.hemiGround)
      hemi.intensity = palette.hemiIntensity
      renderer.toneMappingExposure = palette.exposure
      ;(scene.background as T.Color).set(palette.sky)
      if (scene.fog instanceof T.Fog) {
        scene.fog.color.set(palette.sky)
        scene.fog.near = look.fogNear
        scene.fog.far = look.fogFar
      }
    }

    /** 吹き出しは順位の高い順に置き、上位と重なる下位の吹き出しは隠す（「別の候補」からは選べる） */
    const placeBubbles = (bubbles: Bubble[]): [number, number][] => {
      const placed: [number, number][] = []
      for (const b of bubbles) {
        const el = bubbleEls.current.get(b.id)
        if (!el) continue
        const v = worldPoint(b.position, b.kind === 'pick' ? 9 : 6).project(camera)
        const x = (v.x * 0.5 + 0.5) * element.clientWidth
        const y = (-v.y * 0.5 + 0.5) * element.clientHeight
        el.style.transform = `translate3d(${x}px,${y}px,0)`
        const hidden = v.z > 1 || v.z < -1 || placed.some(([px, py]) => Math.hypot(px - x, py - y) < 46)
        el.style.display = hidden ? 'none' : ''
        el.style.zIndex = String(10 - b.rank)
        if (!hidden) placed.push([x, y])
      }
      return placed
    }

    /** 目印の建物の名前: 吹き出しと重なるもの、ほかの札と重なるもの、遠くて小さい（2番手）ものは隠す */
    const placeLandmarks = (bubbleSpots: [number, number][]) => {
      const show = latest.current.showLabels !== false
      const far = camera.position.distanceTo(controls.target) > 1250
      const w = element.clientWidth
      const h = element.clientHeight
      const taken: [number, number][] = []
      LANDMARKS.forEach((landmark, i) => {
        const el = landmarkEls.current[i]
        if (!el) return
        if (!show || (far && landmark.rank === 2)) {
          el.style.display = 'none'
          return
        }
        const xy = toScreen(worldPoint(landmark.position, landmark.height + 4))
        const hidden = !xy
          || xy[0] < 0 || xy[0] > w || xy[1] < 40 || xy[1] > h
          || bubbleSpots.some(([bx, by]) => Math.abs(bx - xy[0]) < 40 && by - xy[1] < 70 && by - xy[1] > -20)
          || taken.some(([tx, ty]) => Math.abs(tx - xy[0]) < 96 && Math.abs(ty - xy[1]) < 24)
        el.style.display = hidden ? 'none' : ''
        if (!hidden) {
          el.style.transform = `translate3d(${xy[0]}px,${xy[1]}px,0)`
          taken.push(xy)
        }
      })
    }

    let frame = 0
    let lastBearing = -999
    let lastStatsAt = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      if (document.hidden) return
      stepFlight()
      const p = latest.current
      const look = lookOf(p.weather)
      const moved = controls.update()
      if (look.precip && !reducedMotion) dirty = true
      if (!dirty && !moved) return

      anchor.copy(controls.target)
      r.dial.position.copy(anchor)
      originDot.position.copy(anchor).add(new T.Vector3(0, 0.6, 0))
      applySky(p.sun, look)

      precipitation.mesh.visible = !!look.precip
      if (look.precip) {
        const distance = camera.position.distanceTo(controls.target)
        precipitation.update(look.precip, look.precipAmount, reducedMotion ? 0 : performance.now() / 1000, camera.position.clone().lerp(controls.target, 0.3), distance)
      }

      r.dial.visible = p.showPath
      sunOrb.visible = p.showPath && p.sun.altitude > 0
      sunRay.visible = false
      const toSun = solarVector(p.sun, RADIUS)
      sunOrb.position.copy(anchor).add(new T.Vector3(toSun.x, toSun.y, toSun.z))
      sunRay.geometry.setFromPoints([anchor.clone(), anchor.clone().add(new T.Vector3(toSun.x, 0.8, toSun.z))])
      if (windowDetail) windowDetail.visible = camera.position.distanceTo(controls.target) < 1050
      renderer.render(scene, camera)

      if (performance.now() - lastStatsAt > 1000) {
        element.dataset.drawCalls = String(renderer.info.render.calls)
        element.dataset.triangles = String(renderer.info.render.triangles)
        element.dataset.quality = p.quality ?? 'balanced'
        lastStatsAt = performance.now()
      }

      pin(sunLabel.current, sunOrb.position)
      if (sunLabel.current) sunLabel.current.style.visibility = sunOrb.visible ? 'visible' : 'hidden'
      const bubbles = p.bubbles ?? []
      const chosen = p.spots.find((s) => s.id === p.selected)
      if (chosen && !bubbles.some((b) => b.id === chosen.id)) pin(selectedLabel.current, worldPoint(chosen.position, 10))
      else if (selectedLabel.current) selectedLabel.current.style.display = 'none'
      placeLandmarks(placeBubbles(bubbles))

      const look3 = camera.position.clone().sub(controls.target)
      const bearing = Math.round((Math.atan2(look3.x, look3.z) * 180) / Math.PI)
      if (bearing !== lastBearing) {
        p.onBearing?.(bearing)
        lastBearing = bearing
      }
      dirty = false
    }
    animate()
    setReady(true)

    return () => {
      savedView.current = { position: camera.position.clone(), target: controls.target.clone() }
      disposed = true
      contextFetch.abort()
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('webglcontextlost', onLost)
      disposeObject(scene)
      sunLight.shadow.dispose()
      renderer.dispose()
      canvas.remove()
      runtime.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dataset, props.quality])

  // 日付が変わったら日時計を作り直す
  useEffect(() => {
    const r = runtime.current
    if (!r) return
    const next = buildSunDial(props.day, r.anchor)
    r.scene.remove(r.dial)
    disposeObject(r.dial)
    r.dial = next
    r.scene.add(next)
    r.invalidate()
  }, [props.day, props.dataset, props.quality, ready])

  useEffect(() => {
    runtime.current?.invalidate()
  }, [props.sun, props.showShadow, props.showPath, props.minutes, props.bubbles, props.showLabels, props.weather])

  const routeKey = useRef('')
  useEffect(() => {
    const r = runtime.current
    if (!r) return
    if (r.route) {
      r.scene.remove(r.route)
      disposeObject(r.route)
      r.route = null
    }
    const segments = props.route
    if (!segments?.length) {
      routeKey.current = ''
      r.invalidate()
      return
    }
    r.route = buildRoute(segments)
    r.scene.add(r.route)
    // 新しいルートのときだけ、全体が入るように視点を動かす（時刻を変えて色だけ変わるときは動かさない）
    const first = segments[0].points[0]
    const last = segments[segments.length - 1].points.at(-1)!
    const key = `${first.lat},${first.lng}>${last.lat},${last.lng}`
    if (routeKey.current !== key) {
      routeKey.current = key
      const { center, distance } = routeFrame(segments, r.camera.aspect)
      r.flyTo(center, distance)
    }
    r.invalidate()
  }, [props.route, props.dataset, props.quality, ready])

  // 選んだ地点が変わったら（3D の準備ができた直後も）そこへ視点を動かす
  const lastSelection = useRef('')
  useEffect(() => {
    const r = runtime.current
    if (!r) return
    if (r.markers) {
      r.scene.remove(r.markers)
      disposeObject(r.markers)
    }
    r.markers = buildMarkers(props.spots, props.selected, props.levels)
    r.scene.add(r.markers)
    if (lastSelection.current !== props.selected) {
      const spot = props.spots.find((s) => s.id === props.selected)
      if (spot) r.flyTo(worldPoint(spot.position))
      lastSelection.current = props.selected
    }
    r.invalidate()
  }, [props.spots, props.selected, props.levels, props.dataset, props.quality, ready])

  const selectedName = props.spots.find((s) => s.id === props.selected)?.name || SPOT_FALLBACK

  return (
    <div ref={container} className={'city-canvas ' + (props.adding ? 'is-adding' : '')} data-renderer-state={ready ? 'ready' : 'loading'}>
      {ready ? null : (
        <div className="scene-loading">
          <span />
          3Dの街並みを準備しています
        </div>
      )}
      <div ref={sunLabel} className="scene-sun-label">
        <span>{formatTime(props.minutes)}</span>
        <small>太陽の位置</small>
      </div>
      <div ref={selectedLabel} className="scene-selected-label">
        <span>{selectedName}</span>
      </div>
      <div className="scene-landmarks" aria-hidden="true">
        {LANDMARKS.map((landmark, i) => (
          <div key={landmark.label} className={'landmark-label rank-' + landmark.rank} ref={(el) => { landmarkEls.current[i] = el }}>
            <span>{landmark.label}</span>
          </div>
        ))}
      </div>
      <div className="scene-bubbles">
        {props.bubbles?.map((b) => (
          <div
            key={b.id}
            className="bubble-anchor"
            ref={(el) => {
              if (el) bubbleEls.current.set(b.id, el)
              else bubbleEls.current.delete(b.id)
            }}
          >
            <button
              className={'spot-bubble bubble-' + b.kind + (b.active ? ' is-active' : '') + (b.level ? ' level-' + b.level : '')}
              aria-label={b.kind === 'pick' ? `おすすめ: ${b.label}` : `候補${b.rank}: ${b.label}`}
              aria-pressed={b.active}
              onClick={() => props.onBubble?.(b.id)}
            >
              {b.kind === 'pick' ? (
                <span className="bubble-bang">!</span>
              ) : (
                <>
                  <Armchair size={17} strokeWidth={2.2} />
                  <i className="bubble-rank">{b.rank}</i>
                </>
              )}
            </button>
          </div>
        ))}
      </div>
      <div className="scene-keyboard-spots">
        {props.spots.slice(0, 12).map((s) => (
          <button key={s.id} onClick={() => props.onSelect(s.id)}>
            {s.name || SPOT_FALLBACK}を選択
          </button>
        ))}
      </div>
    </div>
  )
})

export default CityMap
