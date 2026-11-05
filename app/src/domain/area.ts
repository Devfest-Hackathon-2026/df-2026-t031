import type { Bounds, LatLng } from './types.ts'

/**
 * 対象エリア（横浜・みなとみらい）。
 * ここは Node（scripts/・server/）からも読むため、ブラウザー専用の機能（import.meta.env など）を使わない。
 */
export const AREA_NAME = '横浜・みなとみらい'

export const AREA_BOUNDS: Bounds = {
  south: 35.4485,
  west: 139.6262,
  north: 35.4668,
  east: 139.645,
}

export const AREA_CENTER: LatLng = {
  lat: (AREA_BOUNDS.south + AREA_BOUNDS.north) / 2,
  lng: (AREA_BOUNDS.west + AREA_BOUNDS.east) / 2,
}

/** 位置情報を使わないときの「デモの現在地」（桜木町駅前あたり） */
export const DEMO_USER_LOCATION: LatLng = { lat: 35.4508, lng: 139.6316 }
/** 3D探索の初期視点。新港中央広場の緑地を中心に街並みを見渡す。 */
export const EXPLORER_FOCUS: LatLng = {lat:35.45285,lng:139.64065}

/** 端末の現在地がエリア中心からこれより遠いときは、デモの現在地を使う（m） */
export const AREA_RADIUS_M = 2500

export function inBounds(p: LatLng, b: Bounds = AREA_BOUNDS): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east
}
