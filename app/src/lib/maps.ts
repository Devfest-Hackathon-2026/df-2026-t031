import { AREA_CENTER } from '../domain/area.ts'
import type { Spot } from '../domain/types.ts'

// 2026-11-10 期間内に書き直し。
// Google Maps（2D の地図と 3D の Photorealistic 表示）にスポットのピンを立てる。

/** 表示中の Google 地図を操作する口 */
export interface ConnectedMap {
  update: (spots: Spot[], selected: string) => void
  destroy: () => void
}

const SCRIPT_TIMEOUT_MS = 20_000
const LOAD_ERROR = 'Google Mapsを読み込めませんでした。APIキーと利用制限をご確認ください。'
const DEFAULT_TITLE = '休憩スポット'

/** maps3d ライブラリのうち使う部分（型定義が beta に追いついていないため自前で書く） */
interface Maps3dLibrary {
  Map3DElement: new (options: unknown) => HTMLElement & { center: unknown }
  Marker3DInteractiveElement: new (options: unknown) => HTMLElement
}

/** Maps JavaScript API がスクリプトから呼ぶグローバル関数 */
interface MapsCallbacks {
  epokuGoogleReady: () => void
  gm_authFailure: () => void
}

let scriptLoading: Promise<void> | null = null

const mapsReady = () => typeof google !== 'undefined' && typeof google.maps?.importLibrary === 'function'

/** Maps JavaScript API のスクリプトを 1 回だけ読み込む。失敗したら次の呼び出しでやり直せるようにする */
function loadMapsScript(apiKey: string): Promise<void> {
  if (mapsReady()) return Promise.resolve()
  if (scriptLoading) return scriptLoading

  scriptLoading = new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script')
    const callbacks = window as unknown as MapsCallbacks

    const succeed = () => {
      clearTimeout(timeout)
      resolve()
    }
    const abort = () => {
      clearTimeout(timeout)
      tag.remove()
      scriptLoading = null
      reject(new Error(LOAD_ERROR))
    }
    const timeout = setTimeout(abort, SCRIPT_TIMEOUT_MS)

    callbacks.epokuGoogleReady = succeed
    // キーが無効・リファラ制限に引っかかったときに API が呼ぶ。画面側にも知らせる
    callbacks.gm_authFailure = () => {
      abort()
      window.dispatchEvent(new Event('epoku-map-auth-error'))
    }
    tag.onerror = abort

    const params = new URLSearchParams({ key: apiKey, v: 'beta', loading: 'async', callback: 'epokuGoogleReady', language: 'ja' })
    tag.src = `https://maps.googleapis.com/maps/api/js?${params}`
    tag.async = true
    document.head.append(tag)
  })
  return scriptLoading
}

/** 2D 地図のピンの中身。トイレは WC、ごみ箱は ♲、ほかは ● */
function pinLabel(kind: Spot['kind']): string {
  if (kind === 'toilet') return 'WC'
  if (kind === 'trash') return '♲'
  return '●'
}

async function connect3d(container: HTMLDivElement, onSelect: (id: string) => void): Promise<ConnectedMap> {
  const lib = (await google.maps.importLibrary('maps3d')) as unknown as Maps3dLibrary
  const scene = new lib.Map3DElement({ center: { ...AREA_CENTER, altitude: 0 }, range: 2300, tilt: 58, heading: 25, mode: 'HYBRID' })
  scene.style.height = '100%'
  container.replaceChildren(scene)

  let pins: HTMLElement[] = []
  return {
    update(spots) {
      for (const pin of pins) pin.remove()
      pins = spots.map((spot) => {
        const pin = new lib.Marker3DInteractiveElement({ position: { ...spot.position, altitude: 3 }, label: spot.name || DEFAULT_TITLE })
        pin.addEventListener('gmp-click', () => onSelect(spot.id))
        scene.append(pin)
        return pin
      })
    },
    destroy() {
      scene.remove()
    },
  }
}

async function connect2d(container: HTMLDivElement, onSelect: (id: string) => void): Promise<ConnectedMap> {
  const [mapsLib, markerLib] = await Promise.all([
    google.maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>,
    google.maps.importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
  ])
  const map = new mapsLib.Map(container, {
    center: AREA_CENTER,
    zoom: 16,
    mapId: 'DEMO_MAP_ID',
    streetViewControl: false,
    mapTypeControl: false,
  })

  let pins: google.maps.marker.AdvancedMarkerElement[] = []
  const clearPins = () => {
    for (const pin of pins) pin.map = null
  }
  return {
    update(spots, selected) {
      clearPins()
      pins = spots.map((spot) => {
        const badge = document.createElement('span')
        badge.className = spot.id === selected ? 'google-pin active' : 'google-pin'
        badge.textContent = pinLabel(spot.kind)
        const pin = new markerLib.AdvancedMarkerElement({ map, position: spot.position, title: spot.name || DEFAULT_TITLE, content: badge })
        pin.addListener('click', () => onSelect(spot.id))
        return pin
      })
    },
    destroy() {
      clearPins()
      container.replaceChildren()
    },
  }
}

/** container に Google の地図を出す。mode で 2D と 3D を切り替える */
export async function connectGoogle(
  container: HTMLDivElement,
  apiKey: string,
  mode: 'google2d' | 'google3d',
  onSelect: (id: string) => void,
): Promise<ConnectedMap> {
  await loadMapsScript(apiKey)
  return mode === 'google3d' ? connect3d(container, onSelect) : connect2d(container, onSelect)
}
