import type { Bounds, LatLng } from './types.ts'

// 2026-11-10 期間内に書き直し。
// 対象エリアの定数。scripts/ と server/（Node）からも読み込むので、ブラウザー専用の API は使わない。

export const AREA_NAME = '横浜・みなとみらい'

/** 桜木町〜新港〜みなとみらい中央をおおう範囲 */
export const AREA_BOUNDS: Bounds = { south: 35.4485, north: 35.4668, west: 139.6262, east: 139.645 }

export const AREA_CENTER: LatLng = {
  lat: 0.5 * (AREA_BOUNDS.south + AREA_BOUNDS.north),
  lng: 0.5 * (AREA_BOUNDS.west + AREA_BOUNDS.east),
}

/** 位置情報なし・エリア外のときに使う現在地（桜木町駅前） */
export const DEMO_USER_LOCATION: LatLng = { lat: 35.4508, lng: 139.6316 }

/** 3D 探索を開くときの注視点（新港中央広場の緑地） */
export const EXPLORER_FOCUS: LatLng = { lat: 35.45285, lng: 139.64065 }

/** 端末の位置がエリア中心からこの距離（m）を超えたらデモの現在地に切り替える */
export const AREA_RADIUS_M = 2500

export function inBounds({ lat, lng }: LatLng, b: Bounds = AREA_BOUNDS): boolean {
  const latOk = b.south <= lat && lat <= b.north
  const lngOk = b.west <= lng && lng <= b.east
  return latOk && lngOk
}
